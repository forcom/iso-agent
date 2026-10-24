import {afterEach,expect,it,vi} from 'vitest';
import {Miniflare} from 'miniflare';
import {createTestEnvironment,type TestEnvironment} from '../support/environment';
import {enableDots,grantDots,rpc,fetchDots} from './oauth-fixture';
let t:TestEnvironment;afterEach(async()=>{vi.unstubAllGlobals();await t?.cleanup()});
import {subscription,receiver} from './event-fixture';
it('constructs callback requests in the Workers runtime without following redirects',async()=>{
 const runtime=new Miniflare({name:'iso-test-callback-runtime',modules:true,compatibilityDate:'2025-10-01',script:'export default {async fetch(request){try{const options=await request.json();new Request("https://callback.invalid",options);return new Response("ok")}catch(error){return new Response(error.message,{status:400})}}}'});
 try{
  t=await createTestEnvironment();enableDots(t);const token=await grantDots(t),fetch=receiver();
  vi.stubGlobal('fetch',async(input:any,init?:RequestInit)=>{
   const response=await runtime.dispatchFetch('http://runtime.invalid',{method:'POST',body:JSON.stringify({redirect:init?.redirect})});
   if(!response.ok)throw new TypeError(await response.text());
   return fetch(input,init);
  });
  const response=await (await rpc(t,token.access_token,'events/subscribe',subscription)).json() as any;
  expect(response.error).toBeUndefined();expect(fetch).toHaveBeenCalledTimes(1);
 }finally{await runtime.dispose()}
});
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
 const diagnostics=vi.spyOn(console,'warn').mockImplementation(()=>{});
 t=await createTestEnvironment();enableDots(t);const token=await grantDots(t),fetch=vi.fn(async()=>Response.json({challenge:'wrong'}));vi.stubGlobal('fetch',fetch);
 for(const delivery of [{...subscription.delivery,url:'https://127.0.0.1/private'},{...subscription.delivery,url:'https://chatgpt.com.attacker.example/callback'},{...subscription.delivery,url:'https://connectors.api.openai.com.attacker.example/callback'},{...subscription.delivery,secret:'whsec_bad'}]){
  const response=await (await rpc(t,token.access_token,'events/subscribe',{...subscription,delivery})).json() as any;expect(response.error).toBeDefined();
 }
 expect(fetch).not.toHaveBeenCalled();
 const response=await (await rpc(t,token.access_token,'events/subscribe',subscription)).json() as any;
 expect(response.error.code).toBe(-32015);
 expect(await t.bindings.DB.prepare('SELECT COUNT(*) n FROM research_subscriptions').first('n')).toBe(0);
 expect(diagnostics).toHaveBeenCalledWith('research.subscription_failed',{code:-32015,reason:expect.stringContaining('Callback verification failed')});
 expect(JSON.stringify(diagnostics.mock.calls)).not.toContain(subscription.delivery.secret);
 expect(JSON.stringify(diagnostics.mock.calls)).not.toContain(subscription.delivery.url);
 diagnostics.mockRestore();
});
it('bounds OAuth request bodies before registration',async()=>{
 t=await createTestEnvironment();enableDots(t);
 const response=await fetchDots(t,'/oauth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'x'.repeat(40000)})});expect(response.status).toBe(413);
});
it('rejects a callback redirect without following its destination',async()=>{
 t=await createTestEnvironment();enableDots(t);const token=await grantDots(t);
 const fetch=vi.fn(async(_input:any,init?:RequestInit)=>{expect(init?.redirect).toBe('manual');return new Response(null,{status:302,headers:{Location:'https://attacker.example/callback'}})});vi.stubGlobal('fetch',fetch);
 const response=await (await rpc(t,token.access_token,'events/subscribe',subscription)).json() as any;
 expect(response.error.code).toBe(-32015);expect(fetch).toHaveBeenCalledTimes(1);
 expect(await t.bindings.DB.prepare('SELECT COUNT(*) n FROM research_subscriptions').first('n')).toBe(0);
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
