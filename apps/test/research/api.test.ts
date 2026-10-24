import {afterEach,describe,expect,it} from 'vitest';
import {createTestEnvironment,type TestEnvironment} from '../support/environment';
import {requestResearch,researchDefinition} from './fixture';
import {getKnowledgeContext} from '../../worker/src/lib/storage';
import {tickResearch} from '../../worker/src/research/runner';
let t:TestEnvironment;
afterEach(async()=>{await t?.cleanup()});
describe('ERP research permissions and ownership',()=>{
 it('checks schedule permissions together without granting access to other assignees or hiding engine failure',async()=>{
  t=await createTestEnvironment();const admin=await t.select('admin'),author=await t.select('author'),reader=await t.select('reader');
  const created=[];
  for(const assigneeId of ['author','author','reader'])created.push(await (await requestResearch(t,admin,'/research/schedules',{definition:{...researchDefinition,assigneeId,timing:{kind:'daily',time:'09:00',startDate:'2026-01-01',endDate:''}}})).json() as any);
  const response=await requestResearch(t,author,'/research/schedule-permissions');expect(response.status).toBe(200);
  const body=await response.json() as any;
  expect(body.items[created[0].id].allowed).toBe(true);expect(body.items[created[1].id].allowed).toBe(true);expect(body.items[created[2].id]).toBeUndefined();
  const denied=await (await requestResearch(t,reader,'/research/schedule-permissions')).json() as any;expect(denied.items[created[2].id].allowed).toBe(false);
  t.bindings.ENGINE_URL='http://127.0.0.1:1';expect((await requestResearch(t,author,'/research/schedule-permissions')).status).toBe(503);
 });
 it('lets only administrators delete a schedule while retaining its jobs and audit history',async()=>{
  t=await createTestEnvironment();const admin=await t.select('admin'),author=await t.select('author');
  const schedule=await (await requestResearch(t,admin,'/research/schedules',{definition:{...researchDefinition,timing:{kind:'daily',time:'09:00',startDate:'2026-01-01',endDate:''}}})).json() as any;
  const job=await (await requestResearch(t,admin,`/research/schedules/${schedule.id}/run`,{expectedVersion:1})).json() as any;
  const path=`/research/schedules/${schedule.id}/delete`;
  expect((await requestResearch(t,author,path,{expectedVersion:1})).status).toBe(403);
  expect((await requestResearch(t,admin,path,{expectedVersion:0})).status).toBe(409);
  const input={requestKey:'delete-once',expectedVersion:1,expectedContext:await getKnowledgeContext(t.bindings)};
  const deleted=await requestResearch(t,admin,path,input);expect(deleted.status).toBe(200);
  const result=await deleted.json();expect(await (await requestResearch(t,admin,path,input)).json()).toEqual(result);
  const overview=await (await requestResearch(t,admin,'/research')).json() as any;
  expect(overview.schedules).toHaveLength(0);expect(overview.jobs).toEqual([job]);
  expect((await requestResearch(t,admin,`/research/jobs/${job.id}`)).status).toBe(200);
  expect((await requestResearch(t,admin,`/research/schedules/${schedule.id}/run`,{expectedVersion:2})).status).toBe(404);
  expect((await requestResearch(t,admin,`/research/schedules/${schedule.id}`,{expectedVersion:2,definition:schedule.definition,enabled:true})).status).toBe(404);
  await tickResearch(t.bindings,'2030-01-01T00:00:00.000Z');
  expect(await t.bindings.DB.prepare('SELECT COUNT(*) n FROM research_jobs').first('n')).toBe(1);
  const event=JSON.parse((await t.bindings.DB.prepare("SELECT body FROM events WHERE json_extract(body,'$.kind')='research.schedule_deleted'").first('body')) as string);
  expect(event).toMatchObject({actorId:'admin',scheduleId:schedule.id});
  const stored=JSON.parse((await t.bindings.DB.prepare('SELECT body FROM research_schedules WHERE id=?').bind(schedule.id).first('body')) as string);
  expect(stored).toMatchObject({enabled:false,nextAt:null,definition:schedule.definition});expect(stored.deletedAt).toBeTruthy();
 });
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
 it('requires both schedule ownership and record permission unless the caller is an administrator',async()=>{
  t=await createTestEnvironment();const admin=await t.select('admin'),author=await t.select('author'),reader=await t.select('reader');
  const response=await requestResearch(t,admin,'/research/schedules',{definition:{...researchDefinition,assigneeId:'reader',recordTypeIds:['test-F01','test-F02'],timing:{kind:'daily',time:'09:00',startDate:'2026-01-01',endDate:''}}});
  expect(response.status).toBe(201);const schedule=await response.json() as any;
  for(const actor of [reader,author]){
   expect((await requestResearch(t,actor,`/research/schedules/${schedule.id}/run`,{expectedVersion:1})).status).toBe(403);
   expect((await requestResearch(t,actor,`/research/schedules/${schedule.id}`,{expectedVersion:1,definition:schedule.definition,enabled:false})).status).toBe(403);
  }
  expect(await t.bindings.DB.prepare('SELECT COUNT(*) n FROM research_jobs').first('n')).toBe(0);
  const run=await requestResearch(t,admin,`/research/schedules/${schedule.id}/run`,{expectedVersion:1});expect(run.status).toBe(201);
  expect(await run.json()).toMatchObject({requestedBy:'admin',assigneeId:'reader',scheduleId:schedule.id});
  const reassigned=await requestResearch(t,admin,`/research/schedules/${schedule.id}`,{expectedVersion:1,definition:{...schedule.definition,assigneeId:'author'},enabled:true});expect(reassigned.status).toBe(200);
  expect((await requestResearch(t,author,`/research/schedules/${schedule.id}/run`,{expectedVersion:2})).status).toBe(201);
 });
 it('deduplicates a manual request but rejects another payload under the same key',async()=>{
  t=await createTestEnvironment();const author=await t.select('author'),data={requestKey:'same-request',expectedContext:await getKnowledgeContext(t.bindings),definition:researchDefinition};
  const first=await requestResearch(t,author,'/research/jobs',data);expect(first.status).toBe(201);const job=await first.json();
  expect(await (await requestResearch(t,author,'/research/jobs',data)).json()).toEqual(job);
  expect((await requestResearch(t,author,'/research/jobs',{...data,definition:{...researchDefinition,title:'changed'}})).status).toBe(409);
 });
});
