import {AsyncLocalStorage} from 'node:async_hooks';
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
// Per-request memo scope; code called outside a request (CLI, tests) simply computes again.
export const requestScope=new AsyncLocalStorage<Map<string,unknown>>();
export function requestMemo<T>(key:string,compute:()=>Promise<T>):Promise<T> {
 const store=requestScope.getStore();if(!store)return compute();
 if(!store.has(key))store.set(key,compute().catch(error=>{store.delete(key);throw error}));
 return store.get(key) as Promise<T>;
}
function deepFreeze<T>(value:T):T {
 if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const item of Object.values(value))deepFreeze(item)}
 return value;
}
// Verified bundles are immutable; a cheap HEAD etag check still detects a replaced R2 object.
const verifiedReleases=new Map<string,{etag:string;bundle:KnowledgeBundle}>();
export async function loadRelease(env:Env,releaseId:string):Promise<KnowledgeBundle> {
 const row=await env.DB.prepare('SELECT object_key,body FROM releases WHERE id=?').bind(releaseId).first<{object_key:string;body:string}>();
 if(!row) throw new ApiError(503,'KNOWLEDGE_UNAVAILABLE','릴리스가 없습니다.');
 const expected=JSON.parse(row.body).manifestHash,cacheKey=`${releaseId}:${row.object_key}:${expected}`;
 const cached=verifiedReleases.get(cacheKey);
 if(cached){const head=await env.SOURCES.head(row.object_key);if(head?.etag===cached.etag)return cached.bundle}
 const object=await env.SOURCES.get(row.object_key); if(!object) throw new ApiError(503,'KNOWLEDGE_UNAVAILABLE','릴리스 원본이 없습니다.');
 const bundle=await object.json<KnowledgeBundle>();
 requireValue(bundle.manifest.releaseId===releaseId,503,'KNOWLEDGE_UNAVAILABLE','릴리스 식별자가 일치하지 않습니다.');
 const copy=structuredClone(bundle);copy.manifest.manifestHash='';
 requireValue(bundle.manifest.manifestHash===expected&&await sha256(canonical(copy))===expected,503,'KNOWLEDGE_CHANGED','지식 릴리스의 내용이 설치된 해시와 다릅니다.');
 verifiedReleases.set(cacheKey,{etag:object.etag,bundle:deepFreeze(bundle)});
 return bundle;
}
export async function getBundle(env:Env,context:KnowledgeContext):Promise<KnowledgeBundle> {
 const bundle=await loadRelease(env,context.releaseId);
 requireValue(bundle.manifest.rulesHash===context.rulesHash,503,'KNOWLEDGE_UNAVAILABLE','릴리스 기준이 일치하지 않습니다.');
 return bundle;
}
export function assertContext(expected:unknown,actual:KnowledgeContext):asserts expected is KnowledgeContext {
 requireValue(!!expected && typeof expected==='object',422,'EXPECTED_CONTEXT_REQUIRED','현재 조회 기준이 필요합니다.');
 const e=expected as KnowledgeContext;
 requireValue(e.releaseId===actual.releaseId && e.dataRevision===actual.dataRevision && e.authorityRevision===actual.authorityRevision && e.rulesHash===actual.rulesHash,409,'CONTEXT_CONFLICT','자료 또는 권한이 변경되었습니다. 다시 확인해 주세요.');
}
/** Client screens fence on release and authority only. Each mutation re-checks its own target
 * (working revision, state, candidate hash), and commitMutation fences the server-read dataRevision. */
export function assertExpectedContext(expected:unknown,actual:KnowledgeContext):asserts expected is KnowledgeContext {
 requireValue(!!expected && typeof expected==='object',422,'EXPECTED_CONTEXT_REQUIRED','현재 조회 기준이 필요합니다.');
 const e=expected as KnowledgeContext;
 requireValue(e.releaseId===actual.releaseId && e.authorityRevision===actual.authorityRevision && e.rulesHash===actual.rulesHash,409,'CONTEXT_CONFLICT','규정 릴리스 또는 권한이 변경되었습니다. 다시 확인해 주세요.');
}
export type JsonPayloadReference={__r2Json:{key:string;sha256:string}};
export async function storeLargeJson<T>(env:Env,value:T,prefix:'mutation-results'|'regulation-diffs'):Promise<T|JsonPayloadReference> {
 const body=JSON.stringify(value);if(new TextEncoder().encode(body).byteLength<=1024*1024)return value;
 const digest=await sha256(body),key=`${prefix}/${digest}.json`;await env.SOURCES.put(key,body);
 return {__r2Json:{key,sha256:digest}};
}
export async function readLargeJson<T>(env:Env,value:T|JsonPayloadReference):Promise<T> {
 if(!value||typeof value!=='object'||!('__r2Json' in value))return value as T;
 const ref=(value as JsonPayloadReference).__r2Json;
 requireValue(ref&&typeof ref.key==='string'&&/^(mutation-results|regulation-diffs)\/[a-f\d]{64}\.json$/.test(ref.key)&&ref.key.endsWith(`/${ref.sha256}.json`),503,'JSON_PAYLOAD_CHANGED','저장된 응답·비교 자료의 참조가 올바르지 않습니다.');
 const object=await env.SOURCES.get(ref.key);requireValue(object,503,'JSON_PAYLOAD_UNAVAILABLE','저장된 응답·비교 자료가 없습니다.');
 const body=await object.text();requireValue(await sha256(body)===ref.sha256,503,'JSON_PAYLOAD_CHANGED','저장된 응답·비교 자료의 해시가 다릅니다.');
 try{return JSON.parse(body) as T;}catch{throw new ApiError(503,'JSON_PAYLOAD_CHANGED','저장된 응답·비교 자료를 읽을 수 없습니다.');}
}
export async function replay(env:Env,actor:ActorContext,key:string,hash:string) {
 const row=await env.DB.prepare('SELECT payload_hash,result FROM mutation_requests WHERE actor_id=? AND request_key=?').bind(actor.personId,key).first<{payload_hash:string;result:string}>();
 if(!row) return undefined;
 requireValue(row.payload_hash===hash,409,'REQUEST_KEY_CONFLICT','같은 요청 키에 다른 내용이 사용되었습니다.'); return readLargeJson(env,JSON.parse(row.result));
}
export async function commitMutation(env:Env,actor:ActorContext,key:string,hash:string,context:KnowledgeContext,result:unknown,statements:D1PreparedStatement[],next?:Partial<KnowledgeContext>) {
 const prior=await replay(env,actor,key,hash);if(prior!==undefined) return prior;
 const updated={...context,dataRevision:context.dataRevision+1,...next};
 // A failed D1 batch may leave an immutable orphan; deleting a shared hash key could break a concurrent successful request.
 const storedResult=await storeLargeJson(env,result,'mutation-results');
 const fence=env.DB.prepare('INSERT INTO mutation_requests(actor_id,request_key,payload_hash,result,session_id,session_version,release_id,data_revision,authority_revision,rules_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(actor.personId,key,hash,JSON.stringify(storedResult),actor.sessionId,actor.sessionVersion,context.releaseId,context.dataRevision,context.authorityRevision,context.rulesHash,new Date().toISOString());
 try {
  const results=await env.DB.batch([fence,...statements,env.DB.prepare('UPDATE context SET release_id=?,data_revision=?,authority_revision=?,rules_hash=? WHERE id=1').bind(updated.releaseId,updated.dataRevision,updated.authorityRevision,updated.rulesHash)]);
  if(results.some(r=>!r.success) || results[0].meta.changes!==1 || results.at(-1)?.meta.changes!==1) throw new Error('Mutation batch failed');
 } catch(error) {
  const retried=await replay(env,actor,key,hash);if(retried!==undefined) return retried;
  if(/SESSION_CONFLICT/.test(String(error))) throw new ApiError(409,'SESSION_CONFLICT','선택 직원이 변경되었습니다. 다시 확인해 주세요.');
  if(/CONTEXT_CONFLICT/.test(String(error))) throw new ApiError(409,'CONTEXT_CONFLICT','자료 또는 권한이 변경되었습니다. 다시 확인해 주세요.');
  throw error;
 }
 return result;
}
