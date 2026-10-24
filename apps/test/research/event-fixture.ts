import {expect,vi} from 'vitest';
import {createHmac} from 'node:crypto';
const secret='whsec_'+Buffer.alloc(32,7).toString('base64');
export const subscription={name:'research.job_ready',arguments:{},delivery:{mode:'webhook',url:'https://chatgpt.com/mcp-events/synthetic',secret},cursor:null};
export function receiver(callback?:(event:any)=>Response|Promise<Response>){
 const original=globalThis.fetch;
 return vi.fn(async(input:any,init?:RequestInit)=>{
  if(String(input)!==subscription.delivery.url)return original(input,init);
  expect(init?.redirect).toBe('error');
  const headers=new Headers(init?.headers),body=String(init?.body),id=headers.get('webhook-id')!,timestamp=headers.get('webhook-timestamp')!;
  const signature='v1,'+createHmac('sha256',Buffer.alloc(32,7)).update(`${id}.${timestamp}.${body}`).digest('base64');
  expect(headers.get('webhook-signature')!.split(' ')).toContain(signature);
  expect(headers.get('X-MCP-Subscription-Id')).toMatch(/^sub_/);
  const event=JSON.parse(body);
  if(event.type==='verification')return Response.json({challenge:event.challenge});
  expect(event.eventId).toBe(id);return callback?callback(event):new Response(null,{status:204});
 });
}
