import {afterEach,expect,it,vi} from 'vitest';
import {createTestEnvironment,type TestEnvironment} from '../support/environment';
import {enableDots,grantDots,rpc,pairing,fetchDots,startConsent,origin} from './oauth-fixture';
import {receiver,subscription} from './event-fixture';
import {researchDefinition,requestResearch,resultInput} from './fixture';
import {dispatchResearchJobs} from '../../worker/src/research/events';
import {dotsAuthorization} from '../../worker/src/research/oauth';
let t:TestEnvironment;afterEach(async()=>{vi.unstubAllGlobals();await t?.cleanup()});
async function setup(callback?:(event:any)=>Response|Promise<Response>){
 t=await createTestEnvironment();enableDots(t);const token=await grantDots(t);vi.stubGlobal('fetch',receiver(callback));
 expect((await (await rpc(t,token.access_token,'events/subscribe',subscription)).json() as any).error).toBeUndefined();
 const actor=await t.select('author'),job=await (await requestResearch(t,actor,'/research/jobs',{definition:researchDefinition})).json() as any;
 return {token:token.access_token,job,actor};
}
async function call(token:string,name:string,args:object){const body=await (await rpc(t,token,'tools/call',{name,arguments:args})).json() as any;expect(body.error).toBeUndefined();return body.result}
it('dispatches once, enforces job source scope and stores only draft proposals',async()=>{
 let data:any;const {token,job}=await setup(event=>{data=event.data;return new Response(null,{status:204})});
 await Promise.all([dispatchResearchJobs(t.bindings),dispatchResearchJobs(t.bindings)]);
 expect(data.jobId).toBe(job.id);expect(await t.bindings.DB.prepare('SELECT COUNT(*) n FROM research_attempts').first('n')).toBe(1);
 const begin=await call(token,'begin_research_job',data);expect(begin.isError).not.toBe(true);expect(begin.structuredContent.definition.title).toBe(researchDefinition.title);
 const duplicate=await call(token,'begin_research_job',data);expect(duplicate.structuredContent.alreadyStarted).toBe(true);
 const sources=await call(token,'search_research_context',{...data,query:''});expect(sources.structuredContent.sources.some((s:any)=>s.revisionId==='test-tpl-rev-1')).toBe(true);
 const denied=await call(token,'read_research_source',{...data,revisionId:'unrelated-private-record',lineStart:1,lineCount:20});expect(denied.isError).toBe(true);
 const source=await call(token,'read_research_source',{...data,revisionId:'test-tpl-rev-1',lineStart:1,lineCount:20});expect(source.structuredContent.sourceSha256).toHaveLength(64);
 expect((await call(token,'report_research_progress',{...data,message:'합성 조회 완료'})).isError).not.toBe(true);
 expect((await call(token,'submit_research_result',{...data,payload:resultInput})).structuredContent.received).toBe(true);
 expect((await call(token,'submit_research_result',{...data,payload:resultInput})).structuredContent.duplicate).toBe(true);
 expect(await t.bindings.DB.prepare('SELECT COUNT(*) n FROM research_proposals').first('n')).toBe(1);
 expect(await t.bindings.DB.prepare("SELECT COUNT(*) n FROM artifacts WHERE kind='record'").first('n')).toBe(0);
});
it('retries a stable event without replacing a claim made during delivery',async()=>{
 let eventId='',calls=0,token='';({token}=await setup(async event=>{
  calls++;if(eventId)expect(event.eventId).toBe(eventId);eventId=event.eventId;
  if(calls===1)return new Response(null,{status:503});
  expect((await call(token,'begin_research_job',event.data)).isError).not.toBe(true);return new Response(null,{status:204});
 }));
 const now=new Date().toISOString();await dispatchResearchJobs(t.bindings,now);await dispatchResearchJobs(t.bindings,now);expect(calls).toBe(1);
 await dispatchResearchJobs(t.bindings,new Date(Date.parse(now)+300001).toISOString());expect(calls).toBe(2);
 expect(await t.bindings.DB.prepare('SELECT state FROM research_outbox').first('state')).toBe('claimed');
});
it.each(['unsubscribe','expired','rotation','revoked'])('stops delivery after %s',async kind=>{
 let calls=0;const {token}=await setup(()=>{calls++;return new Response(null,{status:204})});let now=new Date().toISOString();
 if(kind==='unsubscribe')for(let i=0;i<2;i++)expect((await (await rpc(t,token,'events/unsubscribe',subscription)).json() as any).error).toBeUndefined();
 if(kind==='expired')now=new Date(Date.now()+86400001).toISOString();
 if(kind==='rotation')t.bindings.DOTS_PAIRING_SECRET=pairing+'-rotated';
 if(kind==='revoked'){const api=dotsAuthorization(t.bindings),grant=(await api.listUserGrants('company-dots')).items[0];await api.revokeGrant(grant.id,'company-dots')}
 await dispatchResearchJobs(t.bindings,now);expect(calls).toBe(0);expect(await t.bindings.DB.prepare('SELECT COUNT(*) n FROM research_attempts').first('n')).toBe(0);
 expect(JSON.parse(String(await t.bindings.DB.prepare('SELECT body FROM research_connection').first('body'))).state).toBe('held');
});
it('requires operator stop confirmation to recover a held connection and closes old leases',async()=>{
 const {token}=await setup();await dispatchResearchJobs(t.bindings);
 expect((await (await rpc(t,token,'events/unsubscribe',subscription)).json() as any).error).toBeUndefined();
 const c=await startConsent(t),headers={'Content-Type':'application/x-www-form-urlencoded',Origin:origin,Cookie:c.cookie};
 const body={handle:c.handle,decision:'approve',pairing_code:pairing};
 expect((await fetchDots(t,'/oauth/authorize',{method:'POST',headers,body:new URLSearchParams(body)})).status).toBe(409);
 expect((await fetchDots(t,'/oauth/authorize',{method:'POST',headers,body:new URLSearchParams({...body,external_stopped:'yes'})})).status).toBe(302);
 expect(await t.bindings.DB.prepare("SELECT COUNT(*) n FROM research_attempts WHERE state IN ('reserved','running')").first('n')).toBe(0);
 expect(await t.bindings.DB.prepare('SELECT state FROM research_jobs').first('state')).toBe('uncertain');
 expect(JSON.parse(String(await t.bindings.DB.prepare('SELECT body FROM research_connection').first('body'))).state).toBe('unconfigured');
 const newToken=await grantDots(t);expect((await (await rpc(t,newToken.access_token,'events/subscribe',subscription)).json() as any).error).toBeUndefined();
 expect(JSON.parse(String(await t.bindings.DB.prepare('SELECT body FROM research_connection').first('body'))).state).toBe('ready');
});
