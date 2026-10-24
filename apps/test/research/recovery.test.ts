import {afterEach,expect,it} from 'vitest';
import {createTestEnvironment,type TestEnvironment} from '../support/environment';
import {researchDefinition} from './fixture';
import {createSchedule,editSchedule} from '../../worker/src/research/service';
import {tickResearch} from '../../worker/src/research/runner';
import {getKnowledgeContext} from '../../worker/src/lib/storage';
let t:TestEnvironment;
afterEach(async()=>{await t?.cleanup()});
async function schedule(title='합성 정기 조사'){
 const actor=await t.select('admin');return await createSchedule(t.bindings,actor,{requestKey:crypto.randomUUID(),expectedContext:await getKnowledgeContext(t.bindings),definition:{...researchDefinition,title,periodStart:'2026-01-01',periodEnd:'2026-01-01',timing:{kind:'daily',time:'09:00',startDate:'2026-01-01',endDate:''}}},'2026-01-01T00:00:00Z') as any;
}
it('keeps an overdue slot on a pure assignee edit',async()=>{
 t=await createTestEnvironment();const s=await schedule(),actor=await t.select('admin');
 const changed=await editSchedule(t.bindings,actor,s.id,{requestKey:'edit',expectedContext:await getKnowledgeContext(t.bindings),expectedVersion:s.version,definition:{...s.definition,assigneeId:'reader'},enabled:true},'2026-02-01T01:00:00Z') as any;
 expect(changed.nextAt).toBe('2026-01-02T00:00:00.000Z');
 await tickResearch(t.bindings,'2026-02-01T01:00:00Z');expect(await t.bindings.DB.prepare('SELECT COUNT(*) n FROM research_jobs').first('n')).toBe(1);
});
it('records the real catch-up interval separately from the original setting and never asserts verified coverage',async()=>{
 t=await createTestEnvironment();await schedule();await tickResearch(t.bindings,'2026-02-01T01:00:00Z');
 const job=JSON.parse((await t.bindings.DB.prepare('SELECT body FROM research_jobs').first('body')) as string);
 expect(job.definition.periodStart).toBe('2026-01-01');expect(job.definition.periodEnd).toBe('2026-02-01');
 expect(job.scheduleDefinition.periodEnd).toBe('2026-01-01');
 expect(job.coverage).toMatchObject({from:'2026-01-01',through:'2026-02-01',scheduledFrom:'2026-01-02T00:00:00.000Z',coalescedThrough:'2026-02-01T01:00:00Z',verifiedThrough:null});
});
it('isolates invalid due schedules and continues healthy schedules',async()=>{
 t=await createTestEnvironment();const bad=await schedule('문제 일정'),good=await schedule('정상 일정');
 await t.bindings.DB.prepare("UPDATE research_schedules SET version=version+1,body=json_set(body,'$.version',version+1,'$.definition.recordTypeIds',json('[\"removed-type\"]')) WHERE id=?").bind(bad.id).run();
 await expect(tickResearch(t.bindings,'2026-02-01T01:00:00Z')).resolves.toBeUndefined();
 expect(await t.bindings.DB.prepare('SELECT schedule_id FROM research_jobs').first('schedule_id')).toBe(good.id);
 const stored=JSON.parse((await t.bindings.DB.prepare('SELECT body FROM research_schedules WHERE id=?').bind(bad.id).first('body')) as string);
 expect(stored.enabled).toBe(false);expect(stored.lastError.code).toBe('UNKNOWN_RECORD_TYPE');
 const actor=await t.select('admin'),context=await getKnowledgeContext(t.bindings);
 const corrected=await editSchedule(t.bindings,actor,bad.id,{requestKey:'correct',expectedContext:context,expectedVersion:stored.version,definition:bad.definition,enabled:false},'2026-02-01T02:00:00Z') as any;
 expect(corrected.nextAt).toBe(bad.nextAt);expect(corrected.lastError).toBeUndefined();
 const resumed=await editSchedule(t.bindings,actor,bad.id,{requestKey:'resume',expectedContext:context,expectedVersion:corrected.version,definition:corrected.definition,enabled:true},'2026-02-01T02:00:00Z') as any;
 expect(resumed.nextAt).toBe(bad.nextAt);
 await tickResearch(t.bindings,'2026-02-01T02:00:00Z');expect(await t.bindings.DB.prepare('SELECT COUNT(*) n FROM research_jobs').first('n')).toBe(2);
});
it('keeps the company schedule running with an unassigned job when the employee becomes inactive',async()=>{
 t=await createTestEnvironment();const s=await schedule();
 await t.bindings.DB.prepare("UPDATE persons SET body=json_set(body,'$.active',json('false')) WHERE id=?").bind(s.definition.assigneeId).run();
 await tickResearch(t.bindings,'2026-02-01T01:00:00Z');
 const job=JSON.parse((await t.bindings.DB.prepare('SELECT body FROM research_jobs').first('body')) as string);
 expect(job.assigneeId).toBe('');expect(job.definition.assigneeId).toBe(s.definition.assigneeId);expect(job.connectionId).toBe(s.connectionId);
});
