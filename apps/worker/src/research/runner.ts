import type {Env} from '../types';
import {getKnowledgeContext} from '../lib/storage';
import {requireValue,textField} from '../lib/errors';
import {canonical} from '../../../packages/knowledge/src/index';
import {sha256} from '../lib/markdown';
import {nextOccurrence} from './schedule';
import {newResearchJob} from './service';
import {connection,insertJob,researchConflict,researchEvent,researchGet,updateJob,updateSchedule} from './repository';
import {parseResearchResult} from './results';
import type {ResearchAttempt,ResearchJob,ResearchProposal,ResearchSchedule} from './types';

const minutes=(now:string,n:number)=>new Date(Date.parse(now)+n*60000).toISOString();
const fenceConnection=(env:Env,version:number)=>env.DB.prepare("INSERT INTO research_connection SELECT * FROM research_connection WHERE id='company-dots' AND (version<>? OR json_extract(body,'$.state')<>'ready')").bind(version);
const saveAttempt=(env:Env,a:ResearchAttempt)=>env.DB.prepare('UPDATE research_attempts SET state=?,expires_at=?,body=? WHERE id=?').bind(a.state,a.expiresAt,JSON.stringify(a),a.id);
export async function tickResearch(env:Env,now=new Date().toISOString()) {
 await expireResearchAttempts(env,now);
 const due=await env.DB.prepare('SELECT body FROM research_schedules WHERE enabled=1 AND next_at<=? ORDER BY next_at LIMIT 100').bind(now).all<{body:string}>();
 for(const row of due.results){
  const s=JSON.parse(row.body) as ResearchSchedule,context=await getKnowledgeContext(env);
  const job=await newResearchJob(env,s.definition,context,'system:erp-scheduler',now,s,s.nextAt!);
  job.message=s.nextAt!<now?'예정 시각 이후 누락 기간을 포함한 조사 대기':'정기 조사 대기';
  const next={...s,version:s.version+1,nextAt:nextOccurrence(s.definition.timing,now),updatedAt:now};
  try{await env.DB.batch([updateSchedule(env,next),...insertJob(env,job),researchEvent(env,'scheduled',{jobId:job.id,scheduleId:s.id},'system:erp-scheduler',{slot:s.nextAt,observedAt:now})])}
  catch(error){if(!/RESEARCH_CONFLICT|UNIQUE constraint failed: research_jobs/.test(String(error)))throw error}
 }
}
/** Internal connector contract only; no human-session or unauthenticated machine route exposes these operations. */
export async function reserveResearchJob(env:Env,now=new Date().toISOString()):Promise<ResearchAttempt|null> {
 const company=await connection(env);if(company.state!=='ready')return null;
 if(await env.DB.prepare("SELECT id FROM research_attempts WHERE state IN ('reserved','running')").first())return null;
 const row=await env.DB.prepare("SELECT body FROM research_jobs WHERE state='queued' ORDER BY created_at,rowid LIMIT 1").first<{body:string}>();if(!row)return null;
 const old=JSON.parse(row.body) as ResearchJob,id=crypto.randomUUID();
 const job={...old,version:old.version+1,state:'reserved' as const,attemptId:id,updatedAt:now,message:'전달 예약 · 조사 시작 미확인'};
 const attempt:ResearchAttempt={id,jobId:job.id,state:'reserved',createdAt:now,expiresAt:minutes(now,15),connectionVersion:company.version,input:structuredClone(old)};
 try{await env.DB.batch([fenceConnection(env,company.version),updateJob(env,job),env.DB.prepare('INSERT INTO research_attempts VALUES(?,?,?,?,?)').bind(id,job.id,attempt.state,attempt.expiresAt,JSON.stringify(attempt)),env.DB.prepare("UPDATE research_outbox SET state='reserved',event_id=?,body=? WHERE id=?").bind(crypto.randomUUID(),JSON.stringify({jobId:job.id,attemptId:id,createdAt:now}),job.id),researchEvent(env,'reserved',{jobId:job.id},company.id,{attemptId:id})]);return attempt}
 catch(error){if(/RESEARCH_CONFLICT|UNIQUE constraint failed/.test(String(error)))return null;throw error}
}
async function active(env:Env,id:string,now:string){
 const attempt=await researchGet<ResearchAttempt>(env,'research_attempts',id),job=await researchGet<ResearchJob>(env,'research_jobs',attempt.jobId),company=await connection(env);
 requireValue(company.state==='ready'&&company.version===attempt.connectionVersion&&job.attemptId===id&&['reserved','running'].includes(job.state)&&attempt.state!=='closed'&&Date.parse(attempt.expiresAt)>Date.parse(now),409,'RESEARCH_LEASE_EXPIRED','유효한 조사 실행권이 없습니다.');
 return {attempt,job,company};
}
export async function beginResearchJob(env:Env,id:string,now=new Date().toISOString()):Promise<ResearchJob> {
 const {attempt,job,company}=await active(env,id,now);if(attempt.state==='running')return attempt.input;
 const next={...attempt,state:'running' as const,expiresAt:minutes(now,60)};
 try{await env.DB.batch([fenceConnection(env,company.version),updateJob(env,{...job,version:job.version+1,state:'running',updatedAt:now,message:'조사 중'}),saveAttempt(env,next),env.DB.prepare("UPDATE research_outbox SET state='claimed' WHERE id=?").bind(job.id),researchEvent(env,'started',{jobId:job.id},company.id,{attemptId:id})])}catch(error){return researchConflict(error)}
 return next.input;
}
export async function finishResearchAttempt(env:Env,id:string,input:unknown,now=new Date().toISOString()) {
 requireValue(input&&typeof input==='object'&&!Array.isArray(input),422,'INVALID_RESULT','결과 객체가 필요합니다.');
 const encoded=canonical(input);requireValue(new TextEncoder().encode(encoded).length<=256*1024,413,'RESULT_TOO_LARGE','조사 결과는 256 KiB 이하로 제출해 주세요.');
 const hash=await sha256(encoded),attempt=await researchGet<ResearchAttempt>(env,'research_attempts',id);
 if(attempt.resultHash){requireValue(attempt.resultHash===hash,409,'RESULT_CONFLICT','이미 접수된 결과와 다릅니다.');return {received:true,duplicate:true}}
 const job=await researchGet<ResearchJob>(env,'research_jobs',attempt.jobId),company=await connection(env);
 const live=company.state==='ready'&&company.version===attempt.connectionVersion&&attempt.state==='running'&&job.state==='running'&&job.attemptId===id&&Date.parse(attempt.expiresAt)>Date.parse(now);
 if(!live){
  const prior=await env.DB.prepare('SELECT body FROM research_results WHERE attempt_id=?').bind(id).first<{body:string}>();
  if(prior){const saved=JSON.parse(prior.body);requireValue(saved.hash===hash,409,'RESULT_CONFLICT','이미 접수된 결과와 다릅니다.');return saved.quarantined?{quarantined:true}:{received:true,duplicate:true}}
  await env.DB.batch([env.DB.prepare('INSERT INTO research_results VALUES(?,?,?,?)').bind(id,job.id,id,JSON.stringify({id,jobId:job.id,attemptId:id,quarantined:true,receivedAt:now,hash,payload:input})),researchEvent(env,'late_result',{jobId:job.id},company.id,{attemptId:id,hash})]);
  return {quarantined:true};
 }
 const v=input as Record<string,unknown>,statements:D1PreparedStatement[]=[];
 let state:ResearchJob['state'],message:string;
 if(v.kind==='needs_input'){state='needs_input';message=textField(v.message,'확인 질문',4000)}
 else{
  requireValue(v.kind==='result',422,'INVALID_RESULT','결과 또는 추가 정보 요청을 제출해 주세요.');
  const result=await parseResearchResult(env,attempt.input,v.result);state=result.coverage==='partial'?'partial':'received';message=result.summary;
  const stored={id,jobId:job.id,attemptId:id,receivedAt:now,hash,quarantined:false,result};
  statements.push(env.DB.prepare('INSERT INTO research_results VALUES(?,?,?,?)').bind(id,job.id,id,JSON.stringify(stored)));
  for(const draft of result.drafts){
   const proposal:ResearchProposal={id:crypto.randomUUID(),jobId:job.id,attemptId:id,resultId:id,...draft,sha256:await sha256(draft.markdown),context:attempt.input.context,baseRevisionId:attempt.input.baseRevisionId};
   statements.push(env.DB.prepare('INSERT INTO research_proposals VALUES(?,?,?,?)').bind(proposal.id,job.id,id,JSON.stringify(proposal)));
  }
 }
 try{await env.DB.batch([fenceConnection(env,company.version),updateJob(env,{...job,version:job.version+1,state,message,updatedAt:now}),saveAttempt(env,{...attempt,state:'closed',resultHash:hash}),...statements,env.DB.prepare("UPDATE research_outbox SET state='done' WHERE id=?").bind(job.id),researchEvent(env,'attempt_finished',{jobId:job.id},company.id,{attemptId:id,state,hash})])}catch(error){
  if((await researchGet<ResearchAttempt>(env,'research_attempts',id)).resultHash===hash)return {received:true,duplicate:true};
  return researchConflict(error);
 }
 return {received:true,state};
}
export async function expireResearchAttempts(env:Env,now=new Date().toISOString()) {
 const rows=await env.DB.prepare("SELECT body FROM research_attempts WHERE state IN ('reserved','running') AND expires_at<=?").bind(now).all<{body:string}>();
 for(const row of rows.results){
  const a=JSON.parse(row.body) as ResearchAttempt,job=await researchGet<ResearchJob>(env,'research_jobs',a.jobId),company=await connection(env);
  const next={...company,version:company.version+1,state:'held',reason:'응답 미확인 · 외부 실행 상태를 확인한 후 전달 재개 필요'};
  try{await env.DB.batch([updateJob(env,{...job,version:job.version+1,state:'uncertain',message:next.reason,updatedAt:now}),saveAttempt(env,{...a,state:'closed'}),env.DB.prepare('UPDATE research_connection SET version=?,body=? WHERE id=?').bind(next.version,JSON.stringify(next),company.id),env.DB.prepare("UPDATE research_outbox SET state='held' WHERE id=?").bind(job.id),researchEvent(env,'timeout',{jobId:job.id},'system:erp-scheduler',{attemptId:a.id})])}catch(error){if(!/RESEARCH_CONFLICT/.test(String(error)))throw error}
 }
}
