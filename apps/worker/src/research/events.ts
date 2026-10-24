import {ProtocolError,readRequestBody} from '@modelcontextprotocol/server';
import {Webhook} from 'standardwebhooks';
import {z} from 'zod';
import type {Env} from '../types';
import {requireValue} from '../lib/errors';
import {sha256} from '../lib/markdown';
import {connection,researchEvent,researchGet} from './repository';
import {credentialVersion,equalSecret,sealSecret,openSecret} from './credentials';
import {expireResearchAttempts,reserveResearchJob} from './runner';
import type {ResearchAttempt} from './types';

export const eventName='research.job_ready';
const delivery=z.object({mode:z.literal('webhook'),url:z.string().max(2048)});
export const unsubscribeSchema=z.object({name:z.literal(eventName),arguments:z.object({}).strict(),delivery});
export const subscribeSchema=unsubscribeSchema.extend({delivery:delivery.extend({secret:z.string().max(128)}),cursor:z.null().optional(),ttlMs:z.number().int().positive().nullable().optional()});
type Subscription={id:string;version:number;url:string;secret:string;previousSecret?:string;rotateUntil?:string;verifiedAt:string;expiresAt:string;credentialVersion:string;grantId:string};
export const eventDefinition={name:eventName,description:'ERP에서 예약한 조사 작업이 준비되었습니다. jobId와 attemptId로 begin_research_job을 호출하고 허용된 범위만 조사하여 초안·조치 제안을 제출합니다.',delivery:['webhook'],inputSchema:{type:'object',properties:{},additionalProperties:false},payloadSchema:{type:'object',properties:{jobId:{type:'string'},attemptId:{type:'string'}},required:['jobId','attemptId'],additionalProperties:false}};
function callbackUrl(value:string){
 let u:URL;try{u=new URL(value)}catch{throw new ProtocolError(-32602,'Invalid callback URL')}
 // Only platform-owned destinations; production fetch also uses global_fetch_strictly_public.
 if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash||!['chatgpt.com','api.openai.com','connectors.api.openai.com','chat.openai.com'].includes(u.hostname))throw new ProtocolError(-32602,'Callback destination is not allowed');
 return u.href;
}
const subscriptionId=(url:string)=>sha256(JSON.stringify(['company-dots',eventName,{},url])).then(hash=>'sub_'+hash);
async function currentSubscription(env:Env):Promise<Subscription|null>{const r=await env.DB.prepare("SELECT body FROM research_subscriptions WHERE connection_id='company-dots'").first<{body:string}>();return r?JSON.parse(r.body):null}
async function signedPost(env:Env,s:Subscription,id:string,body:string,now:string){
 const at=new Date(now),keys=[s.secret,...(s.previousSecret&&s.rotateUntil!>now?[s.previousSecret]:[])];
 const signatures=await Promise.all(keys.map(async key=>new Webhook(await openSecret(env,key)).sign(id,at,body)));
 // Workers supports manual redirects; both callers reject non-2xx responses.
 return fetch(callbackUrl(s.url),{method:'POST',redirect:'manual',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json','webhook-id':id,'webhook-timestamp':String(Math.floor(at.getTime()/1000)),'webhook-signature':signatures.join(' '),'X-MCP-Subscription-Id':s.id},body});
}
export async function subscribeResearch(env:Env,grantId:string,input:z.infer<typeof subscribeSchema>,now=new Date().toISOString()){
 const url=callbackUrl(input.delivery.url),secret=input.delivery.secret;
 if(!/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(secret)||Buffer.from(secret.slice(6),'base64').toString('base64')!==secret.slice(6)||Buffer.from(secret.slice(6),'base64').length<24||Buffer.from(secret.slice(6),'base64').length>64)throw new ProtocolError(-32602,'Invalid webhook signing secret');
 const id=await subscriptionId(url),old=await currentSubscription(env),version=await credentialVersion(env);
 requireValue(!old||old.id===id||old.expiresAt<=now,409,'SUBSCRIPTION_EXISTS','회사 Dots의 기존 구독을 먼저 해제해 주세요.');
 const same=old?.id===id&&old.credentialVersion===version&&old.grantId===grantId;
 const changed=!same||!equalSecret(await openSecret(env,old!.secret),secret);
 const lifetime=Math.max(60000,Math.min(input.ttlMs??86400000,86400000));
 const next:Subscription={id,version:(old?.version??0)+1,url,secret:changed?await sealSecret(env,secret):old!.secret,verifiedAt:now,expiresAt:new Date(Date.parse(now)+lifetime).toISOString(),credentialVersion:version,grantId};
 if(same&&changed){next.previousSecret=old!.secret;next.rotateUntil=new Date(Date.parse(now)+300000).toISOString()}
 else if(same&&old!.rotateUntil!>now){next.previousSecret=old!.previousSecret;next.rotateUntil=old!.rotateUntil}
 if(!same||changed||Date.parse(now)-Date.parse(old!.verifiedAt)>=300000){
  const challenge=crypto.randomUUID()+crypto.randomUUID();
  try{
   const response=await signedPost(env,next,'verify_'+crypto.randomUUID(),JSON.stringify({type:'verification',challenge}),now);
   console.info('research.callback_response',{status:response.status,contentType:response.headers.get('content-type')});
   // Challenge responses are tiny; cancel an oversized body before parsing it.
   const value=await readRequestBody(new Request('https://response.invalid',{method:'POST',body:response.body,duplex:'half'} as RequestInit),4096);
   if(!response.ok||value.tooLarge||!equalSecret(String(JSON.parse(value.text).challenge??''),challenge))throw new Error('challenge_failed');
  }catch(error){console.warn('research.callback_failed',{kind:error instanceof Error?error.name:'unknown',message:error instanceof Error?error.message.replaceAll(secret,'[redacted]').replaceAll(url,'[callback]').replace(/https?:\/\/\S+/g,'[url]').slice(0,200):'unknown'});throw new ProtocolError(-32015,'Callback verification failed',{reason:'challenge_failed'})}
 }else next.verifiedAt=old!.verifiedAt;
 const company=await connection(env),statements:D1PreparedStatement[]=[];
 if(old){
  statements.push(env.DB.prepare("INSERT INTO research_connection SELECT * FROM research_connection WHERE id='company-dots' AND NOT EXISTS(SELECT 1 FROM research_subscriptions WHERE id=? AND version=?)").bind(old.id,old.version));
  statements.push(env.DB.prepare('UPDATE research_subscriptions SET id=?,version=?,expires_at=?,body=? WHERE id=?').bind(id,next.version,next.expiresAt,JSON.stringify(next),old.id));
 }else statements.push(env.DB.prepare('INSERT INTO research_subscriptions VALUES(?,?,?, ?,?)').bind(id,next.version,company.id,next.expiresAt,JSON.stringify(next)));
 if(company.state==='unconfigured'){
  const ready={...company,version:company.version+1,state:'ready',reason:'Dots 조사 이벤트 구독 확인됨'};
  statements.push(env.DB.prepare('UPDATE research_connection SET version=?,body=? WHERE id=?').bind(ready.version,JSON.stringify(ready),company.id));
 }
 statements.push(researchEvent(env,'subscribed',{},company.id,{subscriptionId:id,expiresAt:next.expiresAt}));
 await env.DB.batch(statements);return {id,refreshBefore:next.expiresAt,cursor:null,truncated:false};
}
export async function unsubscribeResearch(env:Env,input:z.infer<typeof unsubscribeSchema>){
 const id=await subscriptionId(callbackUrl(input.delivery.url)),old=await currentSubscription(env);if(!old||old.id!==id)return {};
 const company=await connection(env),held={...company,version:company.version+1,state:'held',reason:'Dots 이벤트 구독 해제 · 외부 실행 종료 확인 후 연결 재개 필요'};
 await env.DB.batch([env.DB.prepare('INSERT INTO research_subscriptions SELECT * FROM research_subscriptions WHERE id=? AND version<>?').bind(id,old.version),env.DB.prepare('DELETE FROM research_subscriptions WHERE id=?').bind(id),env.DB.prepare('UPDATE research_connection SET version=?,body=? WHERE id=?').bind(held.version,JSON.stringify(held),company.id),researchEvent(env,'unsubscribed',{},company.id,{subscriptionId:id})]);return {};
}
export async function checkResearchConnection(env:Env,now=new Date().toISOString()):Promise<Subscription|null>{
 if(env.DOTS_ENABLED!=='true'||!env.DOTS_PAIRING_SECRET||!env.OAUTH_KV)return null;
 const company=await connection(env);if(company.state!=='ready')return null;
 const s=await currentSubscription(env);
 let reason=!s?'Dots 이벤트 구독 없음':s.expiresAt<=now?'Dots 이벤트 구독 만료':s.credentialVersion!==await credentialVersion(env)?'Dots 연결 코드 변경':'';
 if(!reason){
  const {dotsAuthorization}=await import('./oauth'),grants=await dotsAuthorization(env).listUserGrants('company-dots',{limit:1000});
  if(!grants.items.some(g=>g.id===s!.grantId&&g.scope.includes('research:execute')&&(!g.expiresAt||g.expiresAt*1000>Date.parse(now))))reason='Dots 연결 권한 만료·해제';
 }
 if(!reason)return s;
 const held={...company,version:company.version+1,state:'held',reason:reason+' · 외부 실행 종료 확인 후 재연결 필요'};
 try{await env.DB.batch([
  env.DB.prepare("INSERT INTO research_connection SELECT * FROM research_connection WHERE id='company-dots' AND (version<>? OR COALESCE((SELECT body FROM research_subscriptions WHERE connection_id='company-dots'),'')<>?)").bind(company.version,s?JSON.stringify(s):''),
  env.DB.prepare('UPDATE research_connection SET version=?,body=? WHERE id=?').bind(held.version,JSON.stringify(held),company.id),researchEvent(env,'connection_expired',{},company.id,{reason})
 ])}catch(error){if(!/RESEARCH_CONFLICT|UNIQUE constraint failed: research_connection/.test(String(error)))throw error}
 return null;
}
export async function dispatchResearchJobs(env:Env,now=new Date().toISOString()){
 if(env.DOTS_ENABLED!=='true')return;
 await expireResearchAttempts(env,now);
 const s=await checkResearchConnection(env,now);if(!s)return;
 await reserveResearchJob(env,now);
 const row=await env.DB.prepare("SELECT id,event_id,body FROM research_outbox WHERE state='reserved' LIMIT 1").first<{id:string;event_id:string;body:string}>();if(!row)return;
 const out=JSON.parse(row.body);if(out.nextAt&&out.nextAt>now)return;
 const attempt=await researchGet<ResearchAttempt>(env,'research_attempts',out.attemptId);if(attempt.state!=='reserved'||attempt.expiresAt<=now)return;
 const claimed={...out,tries:(out.tries??0)+1,nextAt:new Date(Date.parse(now)+60000*2**(out.tries??0)).toISOString()};
 const lock=await env.DB.prepare("UPDATE research_outbox SET body=? WHERE id=? AND state='reserved' AND event_id=? AND body=?").bind(JSON.stringify(claimed),row.id,row.event_id,row.body).run();if(lock.meta.changes!==1)return;
 // Fence the network send after claiming, since unsubscribe/cancel can race a cron tick.
 const latest=await currentSubscription(env);if(!latest||latest.id!==s.id||latest.version!==s.version||(await connection(env)).state!=='ready')return;
 let status=0;try{const response=await signedPost(env,s,row.event_id,JSON.stringify({eventId:row.event_id,name:eventName,timestamp:out.createdAt,data:{jobId:row.id,attemptId:out.attemptId},cursor:null}),now);status=response.status;await response.body?.cancel()}catch{}
 const transient=status===0||status===429||status>=500;
 const state=status>=200&&status<300?'delivered':transient&&claimed.tries<3?'reserved':'held';
 const body={...claimed,lastStatus:status};
 const saved=await env.DB.prepare("UPDATE research_outbox SET state=?,body=? WHERE id=? AND state='reserved' AND event_id=? AND body=?").bind(state,JSON.stringify(body),row.id,row.event_id,JSON.stringify(claimed)).run();
 if(state==='held'&&saved.meta.changes===1){
  const company=await connection(env);if(company.state==='ready'){
   const held={...company,version:company.version+1,state:'held',reason:'Dots 알림 전달 실패 · 외부 실행 상태와 연결 확인 필요'};
   await env.DB.batch([env.DB.prepare('UPDATE research_connection SET version=?,body=? WHERE id=?').bind(held.version,JSON.stringify(held),company.id),researchEvent(env,'delivery_failed',{jobId:row.id},company.id,{status,eventId:row.event_id})]);
  }
 }
}
