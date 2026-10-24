import {McpServer,createMcpHandler,ProtocolError} from '@modelcontextprotocol/server';
import {z} from 'zod';
import type {Env} from '../types';
import {connection} from './repository';
import {eventDefinition,subscribeSchema,unsubscribeSchema,subscribeResearch,unsubscribeResearch,checkResearchConnection} from './events';
import {registerResearchTools} from './tools';
export async function researchMcp(request:Request,env:Env,grantId:string){
 const handler=createMcpHandler(()=>{
  const server=new McpServer({name:'iso-agent-research',version:'1.0.0'});
  // Events is the ChatGPT MCP extension; SDK capability types do not include it yet.
  const capabilities={events:{}};server.server.registerCapabilities(capabilities as Parameters<typeof server.server.registerCapabilities>[0]);
  server.server.setRequestHandler('events/list',{params:z.object({cursor:z.string().optional()})},async()=>({events:[eventDefinition]}));
  server.server.setRequestHandler('events/subscribe',{params:subscribeSchema},async input=>{
   console.info('research.subscription_requested',{callbackHost:URL.canParse(input.delivery.url)?new URL(input.delivery.url).hostname:'invalid',secretLength:input.delivery.secret.length});
   try{const result=await subscribeResearch(env,grantId,input);console.info('research.subscription_verified');return result}
   catch(error){console.warn('research.subscription_failed',{code:error instanceof ProtocolError?error.code:null,reason:error instanceof ProtocolError?error.message:'internal_error'});throw error}
  });
  server.server.setRequestHandler('events/unsubscribe',{params:unsubscribeSchema},async input=>unsubscribeResearch(env,input));
  server.registerTool('get_research_connection',{title:'조사 연결 상태',description:'회사 ERP 조사 연결 상태를 확인합니다.',inputSchema:z.object({}),annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}},async()=>{
   await checkResearchConnection(env);const c=await connection(env);const result={connectionId:c.id,state:c.state,reason:c.reason};
   return {content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result};
  });
  registerResearchTools(server,env);
  return server;
 },{maxRequestBodySize:300*1024,onerror:error=>console.warn('research.mcp_error',{code:error instanceof ProtocolError?error.code:null})});
 try{return await handler.fetch(request)}finally{await handler.close()}
}
