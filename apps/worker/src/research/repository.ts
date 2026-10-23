import type {Env} from '../types';
import {ApiError,requireValue} from '../lib/errors';
import {event} from '../lib/storage';
import type {ResearchConnection,ResearchJob,ResearchSchedule} from './types';
type ResearchTable='research_connection'|'research_schedules'|'research_jobs'|'research_attempts'|'research_results'|'research_proposals'|'research_adoptions';
export async function researchGet<T>(env:Env,table:ResearchTable,id:string):Promise<T> {
 const row=await env.DB.prepare(`SELECT body FROM ${table} WHERE id=?`).bind(id).first<{body:string}>();
 requireValue(row,404,'NOT_FOUND','조사 대상을 찾을 수 없습니다.');return JSON.parse(row.body);
}
export async function researchList<T>(env:Env,table:ResearchTable):Promise<T[]> {
 return (await env.DB.prepare(`SELECT body FROM ${table} ORDER BY rowid DESC LIMIT 200`).all<{body:string}>()).results.map(r=>JSON.parse(r.body));
}
export const connection=(env:Env)=>researchGet<ResearchConnection>(env,'research_connection','company-dots');
export function updateJob(env:Env,job:ResearchJob) {return env.DB.prepare('UPDATE research_jobs SET version=?,state=?,body=? WHERE id=?').bind(job.version,job.state,JSON.stringify(job),job.id)}
export function updateSchedule(env:Env,s:ResearchSchedule){return env.DB.prepare('UPDATE research_schedules SET version=?,next_at=?,enabled=?,body=? WHERE id=?').bind(s.version,s.nextAt,s.enabled?1:0,JSON.stringify(s),s.id)}
export function insertJob(env:Env,job:ResearchJob){return [env.DB.prepare('INSERT INTO research_jobs VALUES(?,?,?,?,?,?,?)').bind(job.id,job.version,job.state,job.createdAt,job.scheduleId,job.slot,JSON.stringify(job)),env.DB.prepare('INSERT INTO research_outbox VALUES(?,?,NULL,?)').bind(job.id,'waiting',JSON.stringify({jobId:job.id,createdAt:job.createdAt}))]}
export function researchEvent(env:Env,kind:string,subject:{jobId?:string;scheduleId?:string},actorId:string,details:Record<string,unknown>={}){return event(env,null,{kind:`research.${kind}`,...subject,actorId,...details})}
export function researchConflict(error:unknown):never {
 if(/RESEARCH_CONFLICT|research_one_active_attempt|UNIQUE constraint failed: research_jobs/.test(String(error)))throw new ApiError(409,'RESEARCH_CONFLICT','조사 상태가 변경되었습니다. 다시 확인해 주세요.');
 throw error;
}
