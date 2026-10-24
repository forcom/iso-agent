import {afterEach,describe,expect,it} from 'vitest';
import {createTestEnvironment,type TestEnvironment} from '../support/environment';
import {requestResearch,researchDefinition,resultInput} from './fixture';
import {createSchedule} from '../../worker/src/research/service';
import {getKnowledgeContext} from '../../worker/src/lib/storage';
import {tickResearch,reserveResearchJob,beginResearchJob,finishResearchAttempt,expireResearchAttempts} from '../../worker/src/research/runner';
let t:TestEnvironment;
afterEach(async()=>{await t?.cleanup()});
async function ready(){await t.bindings.DB.prepare("UPDATE research_connection SET version=version+1,body=json_set(body,'$.version',version+1,'$.state','ready') WHERE id='company-dots'").run()}
async function job(){const actor=await t.select('author');return await (await requestResearch(t,actor,'/research/jobs',{definition:researchDefinition})).json() as any}

describe('research scheduler and server execution contract',()=>{
 it('runs three-hour slots once and coalesces a missed interval without replaying every slot',async()=>{
  t=await createTestEnvironment();const admin=await t.select('admin');
  const s=await createSchedule(t.bindings,admin,{requestKey:'three-hour',expectedContext:await getKnowledgeContext(t.bindings),definition:{...researchDefinition,timing:{kind:'three_hourly',time:'00:00',startDate:'2026-01-01',endDate:''}}},'2025-12-31T14:00:00Z') as any;
  await Promise.all([tickResearch(t.bindings,'2025-12-31T15:00:00Z'),tickResearch(t.bindings,'2025-12-31T15:00:00Z')]);
  expect(await t.bindings.DB.prepare('SELECT COUNT(*) n FROM research_jobs').first('n')).toBe(1);
  expect(await t.bindings.DB.prepare('SELECT next_at FROM research_schedules WHERE id=?').bind(s.id).first('next_at')).toBe('2025-12-31T18:00:00.000Z');
  await tickResearch(t.bindings,'2026-01-01T02:59:59Z');
  expect(await t.bindings.DB.prepare('SELECT COUNT(*) n FROM research_jobs').first('n')).toBe(2);
  expect(await t.bindings.DB.prepare('SELECT next_at FROM research_schedules WHERE id=?').bind(s.id).first('next_at')).toBe('2026-01-01T03:00:00.000Z');
 });
 it('coalesces missed slots and deduplicates simultaneous ticks without a Dots connection',async()=>{
  t=await createTestEnvironment();const admin=await t.select('admin');
  const s=await createSchedule(t.bindings,admin,{requestKey:'schedule',expectedContext:await getKnowledgeContext(t.bindings),definition:{...researchDefinition,timing:{kind:'daily',time:'09:00',startDate:'2026-01-01',endDate:''}}},'2026-01-01T00:00:00Z') as any;
  await Promise.all([tickResearch(t.bindings,'2026-02-01T01:00:00Z'),tickResearch(t.bindings,'2026-02-01T01:00:00Z')]);
  expect(await t.bindings.DB.prepare('SELECT COUNT(*) n FROM research_jobs').first('n')).toBe(1);
  expect(await t.bindings.DB.prepare('SELECT next_at FROM research_schedules WHERE id=?').bind(s.id).first('next_at')).toBe('2026-02-02T00:00:00.000Z');
  expect(await reserveResearchJob(t.bindings,'2026-02-01T01:00:00Z')).toBeNull();
 });
 it('reserves one job, releases a question wait and starts the next waiting job',async()=>{
  t=await createTestEnvironment();await ready();const first=await job(),second=await job();
  const attempts=await Promise.all([reserveResearchJob(t.bindings),reserveResearchJob(t.bindings)]);
  expect(attempts.filter(Boolean)).toHaveLength(1);const a=attempts.find(Boolean)!;
  expect((await beginResearchJob(t.bindings,a.id)).id).toBe(first.id);
  expect((await beginResearchJob(t.bindings,a.id)).id).toBe(first.id);
  await finishResearchAttempt(t.bindings,a.id,{kind:'needs_input',message:'대상 버전을 알려 주세요.'});
  const next=await reserveResearchJob(t.bindings);expect(next?.jobId).toBe(second.id);
  const admin=await t.select('admin'),detail=await (await requestResearch(t,admin,`/research/jobs/${first.id}`)).json() as any;
  const resumed=await requestResearch(t,admin,`/research/jobs/${first.id}`,{expectedVersion:detail.job.version,action:'resume',supplement:'대상은 합성 버전 2입니다.'});
  expect(resumed.status).toBe(200);expect((await resumed.json() as any).attemptId).toBeNull();
 });
 it('stores idempotent proposals without accepting external verification claims or writing records',async()=>{
  t=await createTestEnvironment();await ready();await job();const a=(await reserveResearchJob(t.bindings))!;await beginResearchJob(t.bindings,a.id);
  await finishResearchAttempt(t.bindings,a.id,resultInput);await finishResearchAttempt(t.bindings,a.id,resultInput);
  const saved=JSON.parse((await t.bindings.DB.prepare('SELECT body FROM research_results').first('body')) as string);
  expect(saved.result.sources[0].verification).toBe('unverified');
  expect(await t.bindings.DB.prepare('SELECT COUNT(*) n FROM research_proposals').first('n')).toBe(1);
  expect(await t.bindings.DB.prepare("SELECT COUNT(*) n FROM artifacts WHERE kind='record'").first('n')).toBe(0);
  expect(await t.bindings.DB.prepare('SELECT COUNT(*) n FROM decisions').first('n')).toBe(0);
 });
 it('rejects fabricated internal citations and false no-change after a failed search',async()=>{
  t=await createTestEnvironment();await ready();await job();const a=(await reserveResearchJob(t.bindings))!;await beginResearchJob(t.bindings,a.id);
  for(const result of [{...resultInput.result,coverage:'no_change',failedSources:['failed query']},{...resultInput.result,internalEvidence:[{revisionId:'test-reg-rev',sourceSha256:'0'.repeat(64),lineStart:1,lineEnd:1,quote:'invented'}]}]){
   await expect(finishResearchAttempt(t.bindings,a.id,{kind:'result',result})).rejects.toMatchObject({status:422});
  }
  expect(await t.bindings.DB.prepare('SELECT COUNT(*) n FROM research_results').first('n')).toBe(0);
 });
 it('rejects malformed result members at the boundary and accepts concurrent duplicate submissions once',async()=>{
  t=await createTestEnvironment();await ready();await job();const a=(await reserveResearchJob(t.bindings))!;await beginResearchJob(t.bindings,a.id);
  for(const field of ['sources','findings','drafts','actions'])await expect(finishResearchAttempt(t.bindings,a.id,{kind:'result',result:{...resultInput.result,[field]:[null]}})).rejects.toMatchObject({status:422});
  await expect(Promise.all([finishResearchAttempt(t.bindings,a.id,resultInput),finishResearchAttempt(t.bindings,a.id,resultInput)])).resolves.toHaveLength(2);
  expect(await t.bindings.DB.prepare('SELECT COUNT(*) n FROM research_results').first('n')).toBe(1);
 });
 it('quarantines late results after cancellation and holds further dispatch until external stop is verified',async()=>{
  t=await createTestEnvironment();await ready();const j=await job();const a=(await reserveResearchJob(t.bindings))!;await beginResearchJob(t.bindings,a.id);
  const actor=await t.select('admin'),detail=await (await requestResearch(t,actor,`/research/jobs/${j.id}`)).json() as any;
  expect((await requestResearch(t,actor,`/research/jobs/${j.id}`,{expectedVersion:detail.job.version,action:'cancel'})).status).toBe(200);
  await finishResearchAttempt(t.bindings,a.id,resultInput);
  expect(await t.bindings.DB.prepare('SELECT COUNT(*) n FROM research_proposals').first('n')).toBe(0);
  expect(JSON.parse((await t.bindings.DB.prepare('SELECT body FROM research_results').first('body')) as string).quarantined).toBe(true);
  expect(await reserveResearchJob(t.bindings)).toBeNull();
  await expect(beginResearchJob(t.bindings,a.id)).rejects.toMatchObject({status:409});
 });
 it('marks expired reservations uncertain rather than complete and does not retry blindly',async()=>{
  t=await createTestEnvironment();await ready();await job();await reserveResearchJob(t.bindings,'2026-10-24T00:00:00Z');
  await expireResearchAttempts(t.bindings,'2026-10-24T00:16:00Z');
  expect(await t.bindings.DB.prepare('SELECT state FROM research_jobs').first('state')).toBe('uncertain');
  expect(await reserveResearchJob(t.bindings,'2026-10-24T00:17:00Z')).toBeNull();
 });
});
