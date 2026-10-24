import {afterEach,expect,it} from 'vitest';
import {createTestEnvironment,type TestEnvironment} from '../support/environment';
import {enableDots,fetchDots,grantDots,origin,pairing,rpc,startConsent} from './oauth-fixture';
let t:TestEnvironment;afterEach(async()=>{await t?.cleanup()});
it('requires machine OAuth even with a valid ERP administrator session',async()=>{
 t=await createTestEnvironment();enableDots(t);const actor=await t.select('admin');
 const response=await fetchDots(t,'/mcp',{method:'POST',headers:{Cookie:`iso_session=${actor.sessionId}`,'Content-Type':'application/json'},body:'{}'});
 expect(response.status).toBe(401);expect(response.headers.get('WWW-Authenticate')).toContain('resource_metadata');
 expect((await fetchDots(t,'/.well-known/oauth-protected-resource/mcp')).status).toBe(200);
});
it('requires an operator pairing code and rejects untrusted OAuth callbacks',async()=>{
 t=await createTestEnvironment();enableDots(t);const c=await startConsent(t);
 const wrong=await fetchDots(t,'/oauth/authorize',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Origin:origin,Cookie:c.cookie},body:new URLSearchParams({handle:c.handle,decision:'approve',pairing_code:'wrong'})});
 expect(wrong.status).toBe(403);expect(await wrong.text()).not.toContain(pairing);
 const foreign=await fetchDots(t,'/oauth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'Foreign',redirect_uris:['https://attacker.example/callback'],token_endpoint_auth_method:'none'})});expect(foreign.status).toBe(400);
});
it('connects through PKCE and revokes machine access on pairing-code rotation without changing ERP sessions',async()=>{
 t=await createTestEnvironment();enableDots(t);const token=await grantDots(t);
 const tools=await (await rpc(t,token.access_token,'tools/list')).json() as any;
 expect(tools.error).toBeUndefined();
 expect(tools.result.tools.map((tool:any)=>tool.name)).toContain('get_research_connection');
 expect(tools.result.tools.map((tool:any)=>tool.name)).not.toContain('approve_record');
 const status=await (await rpc(t,token.access_token,'tools/call',{name:'get_research_connection',arguments:{}})).json() as any;
 expect(status.result.structuredContent.connectionId).toBe('company-dots');
 const actor=await t.select('author');Object.assign(t.bindings,{DOTS_PAIRING_SECRET:pairing+'-rotated'});
 expect((await rpc(t,token.access_token,'tools/list')).status).toBe(401);
 expect((await fetchDots(t,'/api/me',{headers:{Cookie:`iso_session=${actor.sessionId}`}})).status).toBe(200);
});
it('binds consent to its browser and rejects a stolen authorization code without its PKCE verifier',async()=>{
 t=await createTestEnvironment();enableDots(t);const c=await startConsent(t);
 const body=new URLSearchParams({handle:c.handle,decision:'approve',pairing_code:pairing});
 const noCookie=await fetchDots(t,'/oauth/authorize',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Origin:origin},body});expect(noCookie.status).toBe(400);
 const foreign=await fetchDots(t,'/oauth/authorize',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Origin:'https://attacker.example',Cookie:c.cookie},body});expect(foreign.status).toBe(403);
 const consent=await fetchDots(t,'/oauth/authorize',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Origin:origin,Cookie:c.cookie},body});expect(consent.status).toBe(302);
 const code=new URL(consent.headers.get('Location')!).searchParams.get('code')!;
 const stolen=await fetchDots(t,'/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:c.client_id,redirect_uri:c.redirect,code,code_verifier:'a-wrong-verifier-that-is-at-least-forty-three-characters',resource:origin+'/mcp'})});expect(stolen.status).toBe(400);
});
