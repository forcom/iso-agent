import type { ActorContext, KnowledgeBundle, KnowledgeContext } from '../../../packages/contracts/src/index';
import type { Env } from '../types';
import { ApiError, requireValue } from './errors';
import {canonical} from '../../../packages/knowledge/src/index';
import {sha256} from './markdown';
export async function getKnowledgeContext(env:Env):Promise<KnowledgeContext> {
 const row=await env.DB.prepare('SELECT release_id AS releaseId,data_revision AS dataRevision,authority_revision AS authorityRevision,rules_hash AS rulesHash FROM context WHERE id=1').first<KnowledgeContext>();
 if(!row) throw new ApiError(503,'KNOWLEDGE_UNAVAILABLE','초기 지식 릴리스가 설치되지 않았습니다.');
 return row;
}
type Table='artifacts'|'revisions'|'relations'|'decisions'|'circulations'|'receipts'|'events'|'assignments'|'persons'|'releases'|'regulation_changes';
export async function all<T>(env:Env,table:Table):Promise<T[]> {
 return (await env.DB.prepare(`SELECT body FROM ${table}`).all<{body:string}>()).results.map(r=>JSON.parse(r.body));
}
export async function get<T>(env:Env,table:Table,id:string):Promise<T> {
 const row=await env.DB.prepare(`SELECT body FROM ${table} WHERE id=?`).bind(id).first<{body:string}>();
 if(!row) throw new ApiError(404,'NOT_FOUND','대상을 찾을 수 없습니다.'); return JSON.parse(row.body);
}
export function update(env:Env,table:Table,id:string,body:unknown) { return env.DB.prepare(`UPDATE ${table} SET body=? WHERE id=?`).bind(JSON.stringify(body),id); }
export function event(env:Env,artifactId:string|null,body:Record<string,unknown>) {
 const id=crypto.randomUUID(); return env.DB.prepare('INSERT INTO events(id,artifact_id,body) VALUES (?,?,?)').bind(id,artifactId,JSON.stringify({id,artifactId,at:new Date().toISOString(),...body}));
}
export async function getBundle(env:Env,context:KnowledgeContext):Promise<KnowledgeBundle> {
 const row=await env.DB.prepare('SELECT object_key,body FROM releases WHERE id=?').bind(context.releaseId).first<{object_key:string;body:string}>();
 if(!row) throw new ApiError(503,'KNOWLEDGE_UNAVAILABLE','릴리스가 없습니다.');
 const object=await env.SOURCES.get(row.object_key); if(!object) throw new ApiError(503,'KNOWLEDGE_UNAVAILABLE','릴리스 원본이 없습니다.');
 const bundle=await object.json<KnowledgeBundle>();
 requireValue(bundle.manifest.releaseId===context.releaseId && bundle.manifest.rulesHash===context.rulesHash,503,'KNOWLEDGE_UNAVAILABLE','릴리스 기준이 일치하지 않습니다.');
 const expected=JSON.parse(row.body).manifestHash,copy=structuredClone(bundle);copy.manifest.manifestHash='';
 requireValue(bundle.manifest.manifestHash===expected&&await sha256(canonical(copy))===expected,503,'KNOWLEDGE_CHANGED','시행 지식의 내용이 설치된 해시와 다릅니다.');
 return bundle;
}
export function assertContext(expected:unknown,actual:KnowledgeContext):asserts expected is KnowledgeContext {
 requireValue(!!expected && typeof expected==='object',422,'EXPECTED_CONTEXT_REQUIRED','현재 조회 기준이 필요합니다.');
 const e=expected as KnowledgeContext;
 requireValue(e.releaseId===actual.releaseId && e.dataRevision===actual.dataRevision && e.authorityRevision===actual.authorityRevision && e.rulesHash===actual.rulesHash,409,'CONTEXT_CONFLICT','자료 또는 권한이 변경되었습니다. 다시 확인해 주세요.');
}
export async function replay(env:Env,actor:ActorContext,key:string,hash:string) {
 const row=await env.DB.prepare('SELECT payload_hash,result FROM mutation_requests WHERE actor_id=? AND request_key=?').bind(actor.personId,key).first<{payload_hash:string;result:string}>();
 if(!row) return undefined;
 requireValue(row.payload_hash===hash,409,'REQUEST_KEY_CONFLICT','같은 요청 키에 다른 내용이 사용되었습니다.'); return JSON.parse(row.result);
}
export async function commitMutation(env:Env,actor:ActorContext,key:string,hash:string,context:KnowledgeContext,result:unknown,statements:D1PreparedStatement[],next?:Partial<KnowledgeContext>) {
 const prior=await replay(env,actor,key,hash);if(prior!==undefined) return prior;
 const updated={...context,dataRevision:context.dataRevision+1,...next};
 const fence=env.DB.prepare('INSERT INTO mutation_requests(actor_id,request_key,payload_hash,result,session_id,session_version,release_id,data_revision,authority_revision,rules_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(actor.personId,key,hash,JSON.stringify(result),actor.sessionId,actor.sessionVersion,context.releaseId,context.dataRevision,context.authorityRevision,context.rulesHash,new Date().toISOString());
 try {
  const results=await env.DB.batch([fence,...statements,env.DB.prepare('UPDATE context SET release_id=?,data_revision=?,authority_revision=?,rules_hash=? WHERE id=1').bind(updated.releaseId,updated.dataRevision,updated.authorityRevision,updated.rulesHash)]);
  if(results.some(r=>!r.success) || results[0].meta.changes!==1 || results.at(-1)?.meta.changes!==1) throw new Error('Mutation batch failed');
 } catch(error) {
  const retried=await replay(env,actor,key,hash);if(retried!==undefined) return retried;
  if(/CONTEXT_CONFLICT|SESSION_CONFLICT/.test(String(error))) throw new ApiError(409,'CONTEXT_CONFLICT','자료·권한 또는 선택 직원이 변경되었습니다.');
  throw error;
 }
 return result;
}
