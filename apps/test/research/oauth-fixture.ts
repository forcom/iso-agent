import worker from '../../worker/src/index';
import {vi} from 'vitest';
import type {TestEnvironment} from '../support/environment';
// The provider only uses this class for the unused WorkerEntrypoint-handler alternative.
vi.mock('cloudflare:workers',()=>({WorkerEntrypoint:class{}}));
export const origin='https://erp.example.org',pairing='synthetic-pairing-secret-for-isolated-tests-only-123456789';
export function enableDots(t:TestEnvironment){Object.assign(t.bindings,{DOTS_ENABLED:'true',DOTS_ORIGIN:origin,DOTS_PAIRING_SECRET:pairing})}
export async function fetchDots(t:TestEnvironment,path:string,init:RequestInit={}){
 const pending:Promise<unknown>[]=[];const ctx={waitUntil(p:Promise<unknown>){pending.push(p)},passThroughOnException(){},props:{}} as unknown as ExecutionContext;
 const response=await worker.fetch(new Request(origin+path,init),t.bindings,ctx);await Promise.all(pending);return response;
}
export async function startConsent(t:TestEnvironment){
 const redirect='https://chatgpt.com/connector_platform/oauth/callback';
 const response=await fetchDots(t,'/oauth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'Synthetic Dots',redirect_uris:[redirect],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']})});
 if(!response.ok)throw new Error(`Registration status ${response.status}`);
 const {client_id}=await response.json() as {client_id:string};
 const verifier='a-synthetic-pkce-verifier-that-is-longer-than-forty-three-characters';
 const challenge=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))).toString('base64url');
 const params=new URLSearchParams({client_id,redirect_uri:redirect,response_type:'code',scope:'research:execute offline_access',resource:origin+'/mcp',state:'synthetic-state',code_challenge:challenge,code_challenge_method:'S256'});
 const page=await fetchDots(t,'/oauth/authorize?'+params);const html=await page.text(),handle=html.match(/name="handle" value="([^"]+)"/)?.[1];
 if(!handle)throw new Error(`Consent page missing handle (${page.status})`);
 return {handle,cookie:page.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),client_id,redirect,verifier};
}
export async function grantDots(t:TestEnvironment){
 const c=await startConsent(t),response=await fetchDots(t,'/oauth/authorize',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Origin:origin,Cookie:c.cookie},body:new URLSearchParams({handle:c.handle,decision:'approve',pairing_code:pairing})});
 const location=response.headers.get('Location');if(!location)throw new Error(`Consent rejected ${response.status}`);
 const code=new URL(location).searchParams.get('code')!;
 const token=await fetchDots(t,'/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:c.client_id,redirect_uri:c.redirect,code,code_verifier:c.verifier,resource:origin+'/mcp'})});
 if(!token.ok)throw new Error(`Token exchange status ${token.status}`);
 return await token.json() as {access_token:string;refresh_token:string};
}
export function rpc(t:TestEnvironment,token:string,method:string,params:Record<string,unknown>={}){
 return fetchDots(t,'/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2026-07-28','Mcp-Method':method,...(method==='tools/call'?{'Mcp-Name':String(params.name)}:{}),Authorization:'Bearer '+token},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:{...params,_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}}}})});
}
