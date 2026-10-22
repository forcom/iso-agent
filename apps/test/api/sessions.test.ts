import { it,expect,afterEach } from 'vitest';
import app from '../../worker/src/index';
import {createTestEnvironment, type TestEnvironment} from '../support/environment';
let env:TestEnvironment;afterEach(async()=>env?.cleanup());
it('person switch invalidates previous actor and client admin flags are ignored',async()=>{
 env=await createTestEnvironment();
 const first=await app.request('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({personId:'author',isAdmin:true})},env.bindings);
 expect(first.status).toBe(200);const data=await first.json() as any;expect(data.actor.isAdmin).toBe(false);
 const cookie=first.headers.get('set-cookie')!.split(';')[0];
 const change=await app.request('/api/session',{method:'POST',headers:{cookie,'Content-Type':'application/json','X-Session-Version':'1'},body:JSON.stringify({personId:'reader'})},env.bindings);expect(change.status).toBe(200);
 const stale=await app.request('/api/records',{method:'POST',headers:{cookie,'X-Session-Version':'1'}},env.bindings);expect(stale.status).toBe(409);
 expect((await env.bindings.DB.prepare("SELECT COUNT(*) n FROM artifacts WHERE kind='record'").first('n'))).toBe(0);
});
it('unknown APIs return JSON 404 and employee read needs a session',async()=>{
 env=await createTestEnvironment();
 expect((await app.request('/api/artifacts',{},env.bindings)).status).toBe(401);
 const response=await app.request('/api/bootstrap',{method:'POST'},env.bindings);expect(response.status).toBe(404);expect(response.headers.get('content-type')).toContain('json');
});
it.each(['missing','inactive','fictional_disabled'] as const)('selecting an active person recovers a %s previous session',async previousState=>{
 env=await createTestEnvironment();
 const previous=await env.select('author');
 if(previousState==='missing')await env.bindings.DB.prepare('DELETE FROM sessions WHERE id=?').bind(previous.sessionId).run();
 else{
  const author=JSON.parse((await env.bindings.DB.prepare('SELECT body FROM persons WHERE id=?').bind('author').first<string>('body'))!);
  await env.bindings.DB.prepare('UPDATE persons SET body=? WHERE id=?').bind(JSON.stringify({...author,...(previousState==='inactive'?{active:false}:{fictional:true})}),'author').run();
 }
 const cookie=`iso_session=${previous.sessionId}`;
 expect((await app.request('/api/me',{headers:{cookie}},env.bindings)).status).toBe(401);
 const response=await app.request('/api/session',{method:'POST',headers:{cookie,'Content-Type':'application/json','X-Session-Version':'0'},body:JSON.stringify({personId:'reader'})},env.bindings);
 expect(response.status).toBe(200);
 expect(await response.json()).toMatchObject({actor:{personId:'reader',isAdmin:false},sessionVersion:1});
 const replacement=response.headers.get('set-cookie')!.split(';')[0];expect(replacement).not.toBe(cookie);
 const me=await app.request('/api/me',{headers:{cookie:replacement}},env.bindings);
 expect(me.status).toBe(200);expect(await me.json()).toMatchObject({actor:{personId:'reader'}});
});
it('a valid previous session still rejects a stale selection version',async()=>{
 env=await createTestEnvironment();const previous=await env.select('author'),cookie=`iso_session=${previous.sessionId}`;
 const response=await app.request('/api/session',{method:'POST',headers:{cookie,'Content-Type':'application/json','X-Session-Version':'0'},body:JSON.stringify({personId:'reader'})},env.bindings);
 expect(response.status).toBe(409);expect(await response.json()).toMatchObject({error:{code:'SESSION_CONFLICT'}});expect(response.headers.has('set-cookie')).toBe(false);
 expect(await (await app.request('/api/me',{headers:{cookie}},env.bindings)).json()).toMatchObject({actor:{personId:'author'},sessionVersion:1});
});
it.each([{change:{active:false},code:'PERSON_INACTIVE'},{change:{fictional:true},code:'FICTIONAL_PERSONNEL_DISABLED'}])('stale-cookie recovery does not bypass target $code',async({change,code})=>{
 env=await createTestEnvironment();
 const reader=JSON.parse((await env.bindings.DB.prepare('SELECT body FROM persons WHERE id=?').bind('reader').first<string>('body'))!);
 await env.bindings.DB.prepare('UPDATE persons SET body=? WHERE id=?').bind(JSON.stringify({...reader,...change}),'reader').run();
 const response=await app.request('/api/session',{method:'POST',headers:{cookie:'iso_session=missing-session','Content-Type':'application/json','X-Session-Version':'0'},body:JSON.stringify({personId:'reader'})},env.bindings);
 expect(response.status).toBe(401);expect(await response.json()).toMatchObject({error:{code}});expect(response.headers.has('set-cookie')).toBe(false);
 expect(await env.bindings.DB.prepare('SELECT COUNT(*) n FROM sessions').first('n')).toBe(0);
});
