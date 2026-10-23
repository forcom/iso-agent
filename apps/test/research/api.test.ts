import {afterEach,describe,expect,it} from 'vitest';
import {createTestEnvironment,type TestEnvironment} from '../support/environment';
import {requestResearch,researchDefinition} from './fixture';
import {getKnowledgeContext} from '../../worker/src/lib/storage';
let t:TestEnvironment;
afterEach(async()=>{await t?.cleanup()});
describe('ERP research permissions and ownership',()=>{
 it('keeps company connection independent while changing schedule assignee and preserving queued definitions',async()=>{
  t=await createTestEnvironment();const admin=await t.select('admin');
  const response=await requestResearch(t,admin,'/research/schedules',{definition:{...researchDefinition,timing:{kind:'monthly',time:'09:00',day:31,startDate:'2026-01-01',endDate:''}}});
  expect(response.status).toBe(201);const schedule=await response.json() as any;
  expect(schedule.nextAt).toMatch(/T00:00:00.000Z$/);
  const job=await (await requestResearch(t,admin,`/research/schedules/${schedule.id}/run`,{expectedVersion:1})).json() as any;
  const changed=await requestResearch(t,admin,`/research/schedules/${schedule.id}`,{expectedVersion:1,definition:{...schedule.definition,assigneeId:'reader'},enabled:false});
  expect(changed.status).toBe(200);
  const view=await (await requestResearch(t,admin,`/research/jobs/${job.id}`)).json() as any;
  expect(view.job.assigneeId).toBe('reader');expect(view.job.definition.assigneeId).toBe('author');
  expect(view.job.requestedBy).toBe('admin');expect(view.job.connectionId).toBe(schedule.connectionId);
  expect(view.connection.state).toBe('unconfigured');expect(view.events.length).toBeGreaterThan(0);
  const stale=await requestResearch(t,admin,`/research/schedules/${schedule.id}`,{expectedVersion:1,definition:schedule.definition,enabled:true});
  expect(stale.status).toBe(409);
 });
 it('allows common reading but checks every record type for one-off research',async()=>{
  t=await createTestEnvironment();const author=await t.select('author'),reader=await t.select('reader');
  const allowed=await requestResearch(t,author,'/research/jobs',{definition:researchDefinition});expect(allowed.status).toBe(201);
  const job=await allowed.json() as any;
  expect((await requestResearch(t,reader,`/research/jobs/${job.id}`)).status).toBe(200);
  expect((await requestResearch(t,reader,'/research/jobs',{definition:researchDefinition})).status).toBe(403);
  expect((await requestResearch(t,author,'/research/schedules',{definition:researchDefinition})).status).toBe(403);
  expect((await requestResearch(t,author,'/research/jobs',{definition:{...researchDefinition,recordTypeIds:['test-F01','unknown-type']}})).status).toBe(422);
  const rows=await t.bindings.DB.prepare('SELECT COUNT(*) n FROM research_jobs').first('n');expect(rows).toBe(1);
 });
 it('rejects stale sessions and preserves data on engine outage',async()=>{
  t=await createTestEnvironment();const author=await t.select('author');
  await t.bindings.DB.prepare('UPDATE sessions SET version=2 WHERE id=?').bind(author.sessionId).run();
  expect((await requestResearch(t,author,'/research/jobs',{definition:researchDefinition})).status).toBe(409);
  const fresh=await t.select('author');t.bindings.ENGINE_URL='http://127.0.0.1:1';
  expect((await requestResearch(t,fresh,'/research/jobs',{definition:researchDefinition})).status).toBe(503);
  expect(await t.bindings.DB.prepare('SELECT COUNT(*) n FROM research_jobs').first('n')).toBe(0);
 });
 it('deduplicates a manual request but rejects another payload under the same key',async()=>{
  t=await createTestEnvironment();const author=await t.select('author'),data={requestKey:'same-request',expectedContext:await getKnowledgeContext(t.bindings),definition:researchDefinition};
  const first=await requestResearch(t,author,'/research/jobs',data);expect(first.status).toBe(201);const job=await first.json();
  expect(await (await requestResearch(t,author,'/research/jobs',data)).json()).toEqual(job);
  expect((await requestResearch(t,author,'/research/jobs',{...data,definition:{...researchDefinition,title:'changed'}})).status).toBe(409);
 });
});
