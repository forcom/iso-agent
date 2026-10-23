import assert from 'node:assert/strict';
import {mkdir,rename,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';

export type Client = {personId:string;cookie:string;version:number};
export type Json = Record<string,any>;
export type HttpResult<T=Json> = {status:number;body:T;headers:Headers;durationMs:number};
export type RequestEntry = {method:string;path:string;status:number;durationMs:number;providerCalls:string|null};
export type HttpOptions = {client?:Client;method?:string;json?:unknown;form?:FormData;expected?:number|null;errorCode?:string};
export type Http = <T=Json>(path:string,options?:HttpOptions)=>Promise<HttpResult<T>>;
export function stable(value:any):string {
 if(Array.isArray(value))return `[${value.map(stable).join(',')}]`;
 if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
 return JSON.stringify(value);
}
export function message(error:unknown,secrets:string[]=[]):string {
 let result=error instanceof Error?error.message:String(error);
 for(const secret of secrets.filter(Boolean))result=result.replaceAll(secret,'[redacted]');
 return result.replace(/(iso_session=)[^;\s]+/gi,'$1[redacted]').replace(/(Bearer\s+)[^\s]+/gi,'$1[redacted]');
}
export async function saveJson(path:string,value:unknown) {
 await mkdir(dirname(path),{recursive:true});await writeFile(`${path}.tmp`,JSON.stringify(value,null,2)+'\n',{mode:0o600});await rename(`${path}.tmp`,path);
}
export function createHttp(config:{baseUrl:string;headers?:HeadersInit;onRequest?:(entry:RequestEntry)=>void|Promise<void>;fetch?:typeof fetch}):Http {
 return async<T=Json>(path:string,options:HttpOptions={}):Promise<HttpResult<T>>=>{
  assert.ok(path.startsWith('/')&&!path.startsWith('//'),'Only same-target relative paths are permitted');
  const {client,json,form,expected=200,errorCode}=options;
  const method=options.method??(json!==undefined||form?'POST':'GET'),headers=new Headers(config.headers);
  if(client){headers.set('Cookie',client.cookie);headers.set('X-Session-Version',String(client.version));}
  if(json!==undefined)headers.set('Content-Type','application/json');
  const start=Date.now(),response=await (config.fetch??fetch)(config.baseUrl+path,{method,headers,body:form??(json===undefined?undefined:JSON.stringify(json)),redirect:'error',signal:AbortSignal.timeout(180_000)});
  const raw=await response.text(),durationMs=Date.now()-start;
  let body:any;try{body=JSON.parse(raw);}catch{body={nonJson:true};}
  await config.onRequest?.({method,path,status:response.status,durationMs,providerCalls:response.headers.get('X-G10-Llm-Provider-Calls')});
  if(expected!==null)assert.equal(response.status,expected,`${method} ${path}: expected ${expected}; received ${response.status} (${body?.error?.code??'no JSON error code'})`);
  if(errorCode)assert.equal(body?.error?.code,errorCode,`${method} ${path}: expected ${errorCode}`);
  return {status:response.status,body,headers:response.headers,durationMs};
 };
}
