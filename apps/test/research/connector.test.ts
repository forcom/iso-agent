import {afterEach,expect,it,vi} from 'vitest';
import {createTestEnvironment,type TestEnvironment} from '../support/environment';
import {enableDots,grantDots,rpc,fetchDots} from './oauth-fixture';
let t:TestEnvironment;afterEach(async()=>{vi.unstubAllGlobals();await t?.cleanup()});
import {subscription,receiver} from './event-fixture';
it('discovers Events and persists one verified encrypted subscription across requests',async()=>{
 t=await createTestEnvironment();enableDots(t);const token=await grantDots(t),fetch=receiver();vi.stubGlobal('fetch',fetch);
 const discover=await (await rpc(t,token.access_token,'server/discover')).json() as any;
 expect(discover.result.capabilities.events).toEqual({});
 const list=await (await rpc(t,token.access_token,'events/list')).json() as any;
 expect(list.result.events[0].name).toBe('research.job_ready');
 const first=await (await rpc(t,token.access_token,'events/subscribe',subscription)).json() as any;
 expect(first.error).toBeUndefined();expect(first.result.id).toMatch(/^sub_/);
 const second=await (await rpc(t,token.access_token,'events/subscribe',subscription)).json() as any;
 expect(second.result.id).toBe(first.result.id);expect(fetch).toHaveBeenCalledTimes(1);
 expect(await t.bindings.DB.prepare('SELECT COUNT(*) n FROM research_subscriptions').first('n')).toBe(1);
 const stored=String(await t.bindings.DB.prepare('SELECT body FROM research_subscriptions').first('body'));
 expect(stored).not.toContain(subscription.delivery.secret);
 expect(JSON.parse(String(await t.bindings.DB.prepare('SELECT body FROM research_connection').first('body'))).state).toBe('ready');
});
it('rejects untrusted callbacks, bad secrets and failed challenges before activation',async()=>{
 t=await createTestEnvironment();enableDots(t);const token=await grantDots(t),fetch=vi.fn(async()=>Response.json({challenge:'wrong'}));vi.stubGlobal('fetch',fetch);
 for(const delivery of [{...subscription.delivery,url:'https://127.0.0.1/private'},{...subscription.delivery,url:'https://chatgpt.com.attacker.example/callback'},{...subscription.delivery,secret:'whsec_bad'}]){
  const response=await (await rpc(t,token.access_token,'events/subscribe',{...subscription,delivery})).json() as any;expect(response.error).toBeDefined();
 }
 expect(fetch).not.toHaveBeenCalled();
 const response=await (await rpc(t,token.access_token,'events/subscribe',subscription)).json() as any;
 expect(response.error.code).toBe(-32015);
 expect(await t.bindings.DB.prepare('SELECT COUNT(*) n FROM research_subscriptions').first('n')).toBe(0);
});
it('bounds OAuth request bodies before registration',async()=>{
 t=await createTestEnvironment();enableDots(t);
 const response=await fetchDots(t,'/oauth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'x'.repeat(40000)})});expect(response.status).toBe(413);
});
it('does not acknowledge a refresh if unsubscribe deletes its snapshotted subscription',async()=>{
 t=await createTestEnvironment();enableDots(t);const token=await grantDots(t),normal=receiver();vi.stubGlobal('fetch',normal);
 expect((await (await rpc(t,token.access_token,'events/subscribe',subscription)).json() as any).error).toBeUndefined();
 await t.bindings.DB.prepare("UPDATE research_subscriptions SET version=version+1,body=json_set(body,'$.version',version+1,'$.verifiedAt',?)").bind(new Date(Date.now()-600000).toISOString()).run();
 vi.stubGlobal('fetch',async(input:any,init?:RequestInit)=>{
  expect((await (await rpc(t,token.access_token,'events/unsubscribe',subscription)).json() as any).error).toBeUndefined();return normal(input,init);
 });
 const refreshed=await (await rpc(t,token.access_token,'events/subscribe',subscription)).json() as any;
 expect(refreshed.error).toBeDefined();expect(await t.bindings.DB.prepare('SELECT COUNT(*) n FROM research_subscriptions').first('n')).toBe(0);
});
