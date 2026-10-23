import app from '../../worker/src/index';
import {PyreWireEngine} from '../../worker/src/containers';
import type {Env} from '../../worker/src/types';

// This entrypoint is deployed only to guarded synthetic staging, never the product bundle.
export class G10Engine extends PyreWireEngine {
 async fetch(request:Request):Promise<Response>{
  const path=new URL(request.url).pathname;
  if(path==='/__g10/stop'){
   await this.ctx.storage.put('heldStopped',true);await this.stop('SIGKILL');
   for(let attempt=0;this.ctx.container!.running&&attempt<50;attempt++)await new Promise(resolve=>setTimeout(resolve,100));
   return Response.json({...await this.getState(),running:this.ctx.container!.running});
  }
  if(path==='/__g10/resume'){
   await this.ctx.storage.delete('heldStopped');
   return super.fetch(new Request('http://engine/health'));
  }
  // Bypass automatic restart during fault injection: fetch the actual stopped TCP port.
  if(await this.ctx.storage.get('heldStopped'))return this.ctx.container!.getTcpPort(8080).fetch(request);
  return super.fetch(request);
 }
}
export default {
 async fetch(request:Request,env:Env&{G10_TOKEN:string},ctx:ExecutionContext){
  if(!/^iso-test-g10-[a-z0-9-]+$/.test(env.APP_NAME??'')||!env.G10_TOKEN||request.headers.get('X-G10-Token')!==env.G10_TOKEN)return new Response('Not found',{status:404});
  const path=new URL(request.url).pathname;
  if(['/__g10/stop','/__g10/resume','/__g10/health'].includes(path)){
   if(request.method!=='POST')return new Response('Method not allowed',{status:405});
   return env.ENGINE!.get(env.ENGINE!.idFromName('iso-knowledge-engine')).fetch(`http://engine${path==='/__g10/health'?'/health':path}`,{method:path==='/__g10/health'?'GET':'POST'});
  }
  let providerCalls=0;
  const observed=new Proxy(env,{get(target,key){if(key==='OPENAI_API_KEY')providerCalls++;return Reflect.get(target,key)}});
  const original=await app.fetch(request,observed,ctx);const response=new Response(original.body,original);
  response.headers.set('X-G10-Llm-Provider-Calls',String(providerCalls));return response;
 }
};
