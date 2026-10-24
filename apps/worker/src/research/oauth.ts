import OAuthProvider,{AuthorizationError,getOAuthApi,type OAuthHelpers,type OAuthResourceContext,type OAuthProviderOptions} from '@cloudflare/workers-oauth-provider';
import {readRequestBody} from '@modelcontextprotocol/server';
import type {Env} from '../types';
import {ApiError,requireValue} from '../lib/errors';
import {credentialVersion,equalSecret} from './credentials';
import {researchMcp} from './mcp';
import {connection} from './repository';
import {recoverResearchConnection} from './runner';

export const researchScope='research:execute';
type DotsProps={connectionId:string;credentialVersion:string};
type OAuthEnv=Env&{OAUTH_PROVIDER:OAuthHelpers};
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>`&#${c.charCodeAt(0)};`);
function allowedRedirect(value:unknown){try{const u=new URL(String(value));return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['chatgpt.com','chat.openai.com'].includes(u.hostname)}catch{return false}}
async function authorize(request:Request,env:OAuthEnv){
 const oauth=env.OAUTH_PROVIDER;
 if(request.method==='GET'){
  const auth=await oauth.parseAuthRequest(request);
  requireValue(allowedRedirect(auth.redirectUri)&&auth.scope.every(s=>[researchScope,'offline_access'].includes(s)),400,'INVALID_CLIENT','허용된 Dots 연결 요청이 아닙니다.');
  const details=await oauth.describeConsent(auth),consent=await oauth.beginConsent(auth),company=await connection(env);
  const recovery=company.state==='held'?'<p>연결이 보류되어 있습니다. 기존 Dots 조사가 종료되었는지 확인한 뒤 재연결하세요.</p><label><input type="checkbox" name="external_stopped" value="yes" required>기존 Dots 실행이 모두 종료되었음을 확인했습니다. 이전 실행권을 닫고 재연결합니다.</label>':'';
  consent.headers.set('Content-Type','text/html; charset=utf-8');consent.headers.set('Referrer-Policy','no-referrer');
  return new Response(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>회사 Dots 연결</title><body><main><h1>회사 Dots 연결 승인</h1><p>${escape(details.clientName)} → ${escape(details.redirectHost)}</p><p>허용: 조사 작업 조회·진행 보고·결과 제출. 공식 기록 승인 권한은 부여하지 않습니다.</p><p>ERP 로그인은 필요하지 않습니다. 서버 운영자가 준비한 연결 코드를 입력하세요.</p><form method="post"><input type="hidden" name="handle" value="${escape(consent.handle)}"><label>연결 코드 <input type="password" name="pairing_code" autocomplete="off" maxlength="512" required></label>${recovery}<button name="decision" value="approve">연결 승인</button><button name="decision" value="deny" formnovalidate>취소</button></form></main></body></html>`,{headers:consent.headers});
 }
 requireValue(request.method==='POST',405,'METHOD_NOT_ALLOWED','허용되지 않은 요청입니다.');
 requireValue(request.headers.get('Origin')===env.DOTS_ORIGIN,403,'ORIGIN_REJECTED','연결 승인 화면에서 요청해 주세요.');
 const form=await request.formData(),handle=String(form.get('handle')??'');
 if(form.get('decision')!=='approve'){const denied=await oauth.denyConsent(request,handle);return new Response(null,{status:302,headers:denied.headers})}
 requireValue(equalSecret(String(form.get('pairing_code')??''),env.DOTS_PAIRING_SECRET!),403,'PAIRING_REJECTED','연결 코드를 확인해 주세요.');
 const company=await connection(env);requireValue(company.state!=='held'||form.get('external_stopped')==='yes',409,'EXTERNAL_STOP_REQUIRED','기존 Dots 실행 종료를 확인한 후 재연결해 주세요.');
 const approved=await oauth.approveConsent(request,handle,{scope:[researchScope,'offline_access']});
 requireValue(allowedRedirect(approved.request.redirectUri),400,'INVALID_CLIENT','허용된 Dots 연결 요청이 아닙니다.');
 if(company.state==='held')await recoverResearchConnection(env,company.version);
 const {redirectTo}=await oauth.completeAuthorization({request:approved.request,userId:'company-dots',metadata:{name:'회사 Dots 조사 연결'},scope:approved.request.scope,props:{connectionId:'company-dots',credentialVersion:await credentialVersion(env)} satisfies DotsProps});
 approved.headers.set('Location',redirectTo);return new Response(null,{status:302,headers:approved.headers});
}
export async function dotsFetch(request:Request,env:Env,ctx:ExecutionContext){
 try{
  requireValue(env.DOTS_ENABLED==='true'&&env.OAUTH_KV&&env.DOTS_PAIRING_SECRET&&env.DOTS_PAIRING_SECRET.length>=43&&env.DOTS_PAIRING_SECRET.length<=512&&env.DOTS_ORIGIN,503,'DOTS_NOT_CONFIGURED','Dots 연결 설정이 필요합니다.');
  const url=new URL(request.url),origin=new URL(env.DOTS_ORIGIN!);
  requireValue(origin.protocol==='https:'&&origin.origin===env.DOTS_ORIGIN&&url.origin===origin.origin,403,'ORIGIN_REJECTED','등록된 연결 주소를 사용해 주세요.');
  if(request.method==='POST'&&url.pathname.startsWith('/oauth/')){
   const body=await readRequestBody(request,32768);requireValue(!body.tooLarge,413,'REQUEST_TOO_LARGE','연결 요청이 너무 큽니다.');
   request=new Request(request,{body:body.text});
  }
  const provider=new OAuthProvider(dotsOptions(env));
  const response=await provider.fetch(request,env,ctx);const headers=new Headers(response.headers);headers.set('Cache-Control','no-store');return new Response(response.body,{status:response.status,headers});
 }catch(error){
  if(error instanceof ApiError)return Response.json({error:{code:error.code,message:error.message}},{status:error.status,headers:{'Cache-Control':'no-store'}});
  if(error instanceof AuthorizationError)return Response.json({error:{code:error.code,message:error.description}},{status:400,headers:{'Cache-Control':'no-store'}});
  throw error;
 }
}

function dotsOptions(env:Env):OAuthProviderOptions<Env>{
 return {
   apiRoute:'/mcp',authorizeEndpoint:'/oauth/authorize',tokenEndpoint:'/oauth/token',clientRegistrationEndpoint:'/oauth/register',
   scopesSupported:[researchScope,'offline_access'],requiredScopes:[researchScope],accessTokenTTL:3600,refreshTokenTTL:2592000,
   resourceMetadata:{resource:env.DOTS_ORIGIN!+'/mcp',authorization_servers:[env.DOTS_ORIGIN!]},
   clientIdMetadataDocumentEnabled:false,
   clientRegistrationCallback:({clientMetadata})=>{
    const uris=clientMetadata.redirect_uris;
    if(!Array.isArray(uris)||uris.length===0||uris.length>10||!uris.every(allowedRedirect))return {description:'Only ChatGPT callback URLs are allowed.'};
   },
   apiHandler:{async fetch(req,e,context){
    const c=context as OAuthResourceContext<DotsProps>;
    if(c.props?.connectionId!=='company-dots'||c.props.credentialVersion!==await credentialVersion(e))return new Response('Connection authorization was revoked.',{status:401,headers:{'WWW-Authenticate':'Bearer error="invalid_token"'}});
    requireValue(c.auth.scope.includes(researchScope),403,'SCOPE_REQUIRED','조사 실행 범위가 필요합니다.');
    const originHeader=req.headers.get('Origin');requireValue(!originHeader||originHeader===e.DOTS_ORIGIN,403,'ORIGIN_REJECTED','허용되지 않은 호출 출처입니다.');
    const token=await (e as OAuthEnv).OAUTH_PROVIDER.unwrapToken(c.auth.token);
    requireValue(token,401,'TOKEN_REJECTED','유효한 연결 권한이 필요합니다.');
    return researchMcp(req,e,token.grantId);
   }},
   defaultHandler:{async fetch(req,e){return new URL(req.url).pathname==='/oauth/authorize'?authorize(req,e as OAuthEnv):new Response('Not found',{status:404})}}
 };
}
export const dotsAuthorization=(env:Env)=>getOAuthApi(dotsOptions(env),env);
