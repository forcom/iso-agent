import type {ActorContext,KnowledgeContext,Person} from '../../../packages/contracts/src/index';
import type {Artifact,Env,Revision} from '../types';
import {get,getBundle,getKnowledgeContext,assertExpectedContext,replay,commitMutation} from '../lib/storage';
import {requireAuthorization} from '../lib/engine';
import {resourceFor} from '../lib/artifacts';
import {requireAdmin} from '../lib/releases';
import {requireValue,textField} from '../lib/errors';
import {requestHash} from '../lib/requests';
import {canonical} from '../../../packages/knowledge/src/index';
import {nextOccurrence,parseResearchDefinition} from './schedule';
import {connection,insertJob,researchEvent,researchGet,researchConflict,updateJob,updateSchedule} from './repository';
import type {ResearchDefinition,ResearchJob,ResearchSchedule} from './types';

async function inputContext(env:Env,input:any) {const context=await getKnowledgeContext(env);assertExpectedContext(input.expectedContext,context);return context}
async function definitionContext(env:Env,definition:ResearchDefinition,context:KnowledgeContext,allowInactiveAssignee=false) {
 const bundle=await getBundle(env,context);
 requireValue(definition.recordTypeIds.every(id=>bundle.recordTypes.some(type=>type.id===id)),422,'UNKNOWN_RECORD_TYPE','등록된 기록 유형을 선택해 주세요.');
 requireValue(!definition.systemId||bundle.entities.some(e=>e.id===definition.systemId&&e.type==='AISystem'),422,'UNKNOWN_SYSTEM','등록된 시스템을 선택해 주세요.');
 if(definition.assigneeId&&!allowInactiveAssignee){const person=await get<Person>(env,'persons',definition.assigneeId);requireValue(person.active&&(person.fictional!==true||env.ALLOW_FICTIONAL_PERSONNEL==='true'),422,'PERSON_INACTIVE','유효한 담당자를 선택해 주세요.')}
 return Object.fromEntries(definition.recordTypeIds.map(id=>[id,bundle.recordTypes.find(type=>type.id===id)!.templateRevisionId]));
}
export async function requireResearchWrite(env:Env,actor:ActorContext,definition:Pick<ResearchDefinition,'recordTypeIds'|'systemId'>,context:KnowledgeContext,baseRevisionId?:string){
 if(baseRevisionId){const revision=await get<Revision>(env,'revisions',baseRevisionId),artifact=await get<Artifact>(env,'artifacts',revision.artifactId);
  requireValue(artifact.kind==='record'&&artifact.workingRevisionId===revision.id&&definition.recordTypeIds.every(id=>artifact.recordTypeIds.includes(id)),409,'REVISION_CONFLICT','현행 기록과 조사 유형을 확인해 주세요.');
  await requireAuthorization(env,actor,'revise',resourceFor(artifact,revision),context);
 }else await requireAuthorization(env,actor,'create',{typeIds:definition.recordTypeIds,state:'new',systemIds:definition.systemId?[definition.systemId]:[],conditions:{}},context);
}
async function mutate(env:Env,actor:ActorContext,input:any,operation:string,work:(context:KnowledgeContext)=>Promise<{result:unknown;statements:D1PreparedStatement[]}>) {
 const key=textField(input.requestKey,'requestKey',200),hash=await requestHash(operation,input),prior=await replay(env,actor,key,hash);
 if(prior!==undefined)return prior;
 const context=await inputContext(env,input),{result,statements}=await work(context);
 try{return await commitMutation(env,actor,key,hash,context,result,statements)}catch(error){return researchConflict(error)}
}
export async function createSchedule(env:Env,actor:ActorContext,input:any,now=new Date().toISOString()) {
 requireAdmin(actor);
 return mutate(env,actor,input,'research.schedule.create',async context=>{
  const definition=parseResearchDefinition(input.definition);await definitionContext(env,definition,context);
  requireValue(definition.timing.kind!=='manual',422,'SCHEDULE_REQUIRED','정기 실행 주기를 선택해 주세요.');
  const s:ResearchSchedule={id:crypto.randomUUID(),version:1,definition,enabled:true,nextAt:nextOccurrence(definition.timing,now),createdAt:now,updatedAt:now,createdBy:actor.personId,connectionId:(await connection(env)).id};
  return {result:s,statements:[env.DB.prepare('INSERT INTO research_schedules VALUES(?,?,?,?,?)').bind(s.id,1,s.nextAt,1,JSON.stringify(s)),researchEvent(env,'schedule_created',{scheduleId:s.id},actor.personId,{definition})]};
 });
}
export async function editSchedule(env:Env,actor:ActorContext,id:string,input:any,now=new Date().toISOString()) {
 return mutate(env,actor,input,`research.schedule.edit:${id}`,async context=>{
  const old=await researchGet<ResearchSchedule>(env,'research_schedules',id);requireValue(old.version===input.expectedVersion,409,'RESEARCH_CONFLICT','일정이 변경되었습니다. 다시 확인해 주세요.');
  if(!actor.isAdmin){requireValue(old.definition.assigneeId===actor.personId,403,'ACTION_DENIED','담당 업무만 변경할 수 있습니다.');await requireResearchWrite(env,actor,old.definition,context)}
  const definition=parseResearchDefinition(input.definition);await definitionContext(env,definition,context);
  if(!actor.isAdmin)await requireResearchWrite(env,actor,definition,context);
  requireValue(definition.timing.kind!=='manual'&&typeof input.enabled==='boolean',422,'INVALID_INPUT','일정 주기와 활성 여부를 확인해 주세요.');
  const sameTiming=canonical(old.definition.timing)===canonical(definition.timing);
  const preserveSlot=sameTiming&&(old.enabled===input.enabled||!old.enabled&&old.nextAt!==null);
  const s={...old,definition,enabled:input.enabled,version:old.version+1,updatedAt:now,lastError:undefined,nextAt:preserveSlot?old.nextAt:input.enabled?nextOccurrence(definition.timing,now):null};
  const statements=[updateSchedule(env,s),researchEvent(env,'schedule_changed',{scheduleId:id},actor.personId,{previousVersion:old.version,definition,enabled:s.enabled})];
  if(old.definition.assigneeId!==definition.assigneeId){
   const jobs=(await env.DB.prepare("SELECT body FROM research_jobs WHERE schedule_id=? AND state NOT IN ('received','cancelled','failed')").bind(id).all<{body:string}>()).results;
   for(const row of jobs){const job=JSON.parse(row.body) as ResearchJob;statements.push(updateJob(env,{...job,version:job.version+1,assigneeId:definition.assigneeId,updatedAt:now}),researchEvent(env,'assigned',{jobId:job.id},actor.personId,{from:job.assigneeId,to:definition.assigneeId}))}
  }
  return {result:s,statements};
 });
}
export async function newResearchJob(env:Env,definition:ResearchDefinition,context:KnowledgeContext,requestedBy:string,now:string,schedule?:ResearchSchedule,slot?:string,baseRevisionId?:string):Promise<ResearchJob> {
 const templates=await definitionContext(env,definition,context,Boolean(schedule)),requested=structuredClone(definition);
 // shortcut: repeat from the initial start until source-by-source verified checkpoints exist; never skip unverified periods.
 if(schedule)requested.periodEnd=new Date(Date.parse(now)+9*3600000).toISOString().slice(0,10);
 requireValue(requested.periodStart<=requested.periodEnd,422,'RESEARCH_PERIOD','조사 시작일이 실행일보다 늦습니다.');
 let assigneeId=definition.assigneeId;
 if(schedule&&assigneeId){const row=await env.DB.prepare('SELECT body FROM persons WHERE id=?').bind(assigneeId).first<{body:string}>(),person=row?JSON.parse(row.body) as Person:null;if(!person?.active||person.fictional===true&&env.ALLOW_FICTIONAL_PERSONNEL!=='true')assigneeId=''}
 const from=requested.periodStart,through=requested.periodEnd;
 return {id:crypto.randomUUID(),version:1,state:'queued',scheduleId:schedule?.id??null,scheduleVersion:schedule?.version??null,slot:slot??null,definition:requested,...(schedule?{scheduleDefinition:structuredClone(definition)}:{}),coverage:{from,through,scheduledFrom:slot??null,coalescedThrough:now,verifiedThrough:null,sourceWindows:definition.sources.map(url=>({url,from,through,verifiedThrough:null}))},assigneeId,requestedBy,createdAt:now,updatedAt:now,connectionId:(await connection(env)).id,context,templates,baseRevisionId,attemptId:null,supplements:[],message:'Dots 연결 후 실행 대기'};
}
export async function createResearchJob(env:Env,actor:ActorContext,input:any,scheduleId?:string,now=new Date().toISOString()) {
 return mutate(env,actor,input,`research.job.create:${scheduleId??'manual'}`,async context=>{
  const s=scheduleId?await researchGet<ResearchSchedule>(env,'research_schedules',scheduleId):undefined;
  if(s)requireValue(s.version===input.expectedVersion,409,'RESEARCH_CONFLICT','일정이 변경되었습니다.');
  const definition=s?.definition??parseResearchDefinition(input.definition);
  const job=await newResearchJob(env,definition,context,actor.personId,now,s,undefined,input.baseRevisionId);
  if(s&&actor.isAdmin){/* Company monitoring is an administrative product action, never a record approval. */}
  else {requireValue(!s||s.definition.assigneeId===actor.personId,403,'ACTION_DENIED','담당 일정만 실행할 수 있습니다.');await requireResearchWrite(env,actor,definition,context,input.baseRevisionId)}
  return {result:job,statements:[...insertJob(env,job),researchEvent(env,'job_created',{jobId:job.id,scheduleId:s?.id},actor.personId)]};
 });
}
export async function changeResearchJob(env:Env,actor:ActorContext,id:string,input:any,now=new Date().toISOString()) {
 return mutate(env,actor,input,`research.job.change:${id}`,async context=>{
  const old=await researchGet<ResearchJob>(env,'research_jobs',id);requireValue(old.version===input.expectedVersion,409,'RESEARCH_CONFLICT','작업이 변경되었습니다.');
  if(!actor.isAdmin){requireValue(old.assigneeId===actor.personId||old.requestedBy===actor.personId,403,'ACTION_DENIED','본인의 조사 업무만 변경할 수 있습니다.');await requireResearchWrite(env,actor,old.definition,context,old.baseRevisionId)}
  const job={...old,version:old.version+1,updatedAt:now},statements:D1PreparedStatement[]=[];
  if(input.action==='assign'){
   const personId=typeof input.assigneeId==='string'?input.assigneeId:'';
   await definitionContext(env,{...old.definition,assigneeId:personId},context);job.assigneeId=personId;
  }else if(input.action==='cancel'){
   requireValue(!['received','cancelled'].includes(old.state),409,'RESEARCH_STATE','이미 종료된 작업입니다.');job.state='cancelled';job.message='ERP 접수 중지';
   if(['reserved','running','uncertain'].includes(old.state)){
    const c=await connection(env);const next={...c,version:c.version+1,state:'held',reason:'외부 실행 종료를 확인한 후 전달을 재개해야 합니다.'};
    statements.push(env.DB.prepare('UPDATE research_connection SET version=?,body=? WHERE id=?').bind(next.version,JSON.stringify(next),c.id));job.message='ERP 접수 중지 · 외부 실행 중지 미확인';
   }
   statements.push(env.DB.prepare("UPDATE research_attempts SET state='closed',body=json_set(body,'$.state','closed') WHERE job_id=? AND state IN ('reserved','running')").bind(id),env.DB.prepare("UPDATE research_outbox SET state='cancelled' WHERE id=?").bind(id));
  }else if(input.action==='resume'){
   requireValue(['needs_input','partial','failed','uncertain'].includes(old.state),409,'RESEARCH_STATE','보완·재실행 가능한 상태가 아닙니다.');
   const text=textField(input.supplement,'보완 내용',4000);job.supplements=[...old.supplements,{text,personId:actor.personId,at:now}];
   requireValue(job.supplements.length<=50,422,'LIMIT_EXCEEDED','보완 이력이 많습니다. 새 조사 작업을 생성해 주세요.');
   job.state='queued';job.attemptId=null;job.message='보완 후 실행 대기';
   statements.push(env.DB.prepare("UPDATE research_outbox SET state='waiting',event_id=NULL WHERE id=?").bind(id));
  }else requireValue(false,422,'INVALID_INPUT','허용된 작업 동작이 아닙니다.');
  return {result:job,statements:[updateJob(env,job),...statements,researchEvent(env,String(input.action),{jobId:id},actor.personId,{previousVersion:old.version,assigneeId:job.assigneeId,message:job.message})]};
 });
}
