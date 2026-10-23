import {expect,it} from 'vitest';
import {createHttp,message,stable} from './client';

it('keeps session fencing, multipart, timing and response validation without logging secrets',async()=>{
 const requests:any[]=[];let sent:Request|undefined;
 const http=createHttp({baseUrl:'https://synthetic.invalid',headers:{'X-G10-Token':'staging-secret'},onRequest:entry=>{requests.push(entry)},fetch:async(input,init)=>{
  sent=new Request(input,init);return Response.json({context:{releaseId:'synthetic'},ok:true},{status:201,headers:{'X-G10-Llm-Provider-Calls':'2'}});
 }});
 const form=new FormData();form.set('file',new File(['# synthetic'],'test.md'));
 const result=await http('/api/records',{client:{personId:'author',cookie:'iso_session=session-secret',version:3},form,expected:201});
 expect(sent?.headers.get('Cookie')).toBe('iso_session=session-secret');expect(sent?.headers.get('X-Session-Version')).toBe('3');
 expect(sent?.headers.get('X-G10-Token')).toBe('staging-secret');expect(sent?.headers.get('Content-Type')).toContain('multipart/form-data');
 expect(result.status).toBe(201);expect(requests[0]).toMatchObject({method:'POST',path:'/api/records',status:201,providerCalls:'2'});
 expect(JSON.stringify(requests)).not.toMatch(/session-secret|staging-secret/);
 await expect(http('//other.invalid')).rejects.toThrow(/relative/);
 await expect(http('/api/me')).rejects.toThrow(/expected 200/);
});

it('serializes deterministic request data and masks credentials in failures',()=>{
 expect(stable({b:2,a:[{y:2,x:1}]})).toBe('{"a":[{"x":1,"y":2}],"b":2}');
 expect(message(new Error('token=secret iso_session=hidden Bearer opaque'),['secret'])).not.toMatch(/secret|hidden|opaque/);
});
