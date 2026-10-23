import {afterEach,expect,it} from 'vitest';
import {createTestEnvironment,type TestEnvironment} from '../support/environment';
import {requestResearch,researchDefinition} from './fixture';
import {beginResearchJob,expireResearchAttempts,finishResearchAttempt,reserveResearchJob} from '../../worker/src/research/runner';
import type {Env} from '../../worker/src/types';
let t:TestEnvironment;
afterEach(async()=>{await t?.cleanup()});
it.each(['begin','finish','cancel'])('does not undo %s that wins after the expiry scan',async transition=>{
 t=await createTestEnvironment();
 await t.bindings.DB.prepare("UPDATE research_connection SET version=2,body=json_set(body,'$.version',2,'$.state','ready') WHERE id='company-dots'").run();
 const actor=await t.select('author'),j=await (await requestResearch(t,actor,'/research/jobs',{definition:researchDefinition})).json() as any;
 const a=(await reserveResearchJob(t.bindings,'2026-10-24T00:00:00Z'))!;
 if(transition!=='begin')await beginResearchJob(t.bindings,a.id,'2026-10-24T00:01:00Z');
 const db=t.bindings.DB;
 const env={...t.bindings,DB:{
  prepare(sql:string){const prepared=db.prepare(sql);if(!sql.startsWith('SELECT body FROM research_attempts WHERE state IN'))return prepared;
   return {bind(...args:unknown[]){const bound=prepared.bind(...args);return {async all(){
    const stale=await bound.all();
    if(transition==='begin')await beginResearchJob(t.bindings,a.id,'2026-10-24T00:14:00Z');
    if(transition==='finish')await finishResearchAttempt(t.bindings,a.id,{kind:'needs_input',message:'합성 추가 확인'},'2026-10-24T00:30:00Z');
    if(transition==='cancel'){const detail=await (await requestResearch(t,actor,`/research/jobs/${j.id}`)).json() as any;expect((await requestResearch(t,actor,`/research/jobs/${j.id}`,{action:'cancel',expectedVersion:detail.job.version})).status).toBe(200)}
    return stale;
   }}}} as D1PreparedStatement;
  },batch:db.batch.bind(db)
 } as Env['DB']};
 await expireResearchAttempts(env,transition==='begin'?'2026-10-24T00:16:00Z':'2026-10-24T01:02:00Z');
 expect(await db.prepare('SELECT state FROM research_jobs WHERE id=?').bind(j.id).first('state')).toBe(transition==='begin'?'running':transition==='finish'?'needs_input':'cancelled');
 const attempt=JSON.parse((await db.prepare('SELECT body FROM research_attempts WHERE id=?').bind(a.id).first('body')) as string);
 if(transition==='finish')expect(attempt.resultHash).toHaveLength(64);
 if(transition==='begin')expect(attempt.expiresAt).toBe('2026-10-24T01:14:00.000Z');
});
