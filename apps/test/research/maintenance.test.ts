import {afterEach,expect,it} from 'vitest';
import {createTestEnvironment,type TestEnvironment} from '../support/environment';
import {snapshotMaintenance,planMaintenance,applyMaintenance,backupSql,restoreMaintenanceBackup} from '../../seed/scripts/maintenance';
import {canonical,sha256} from '../../packages/knowledge/src/index';
import {requestResearch,researchDefinition,resultInput} from './fixture';
import {reserveResearchJob,beginResearchJob,finishResearchAttempt} from '../../worker/src/research/runner';
import {registerRecord} from '../../worker/src/lib/artifacts';
import {getKnowledgeContext} from '../../worker/src/lib/storage';
let t:TestEnvironment;
afterEach(async()=>{await t?.cleanup()});
it('backs up the shared connection and refuses the old business reset when research work exists',async()=>{
 t=await createTestEnvironment();const target={environment:'test' as const,databaseId:'iso-test',bucketName:'iso-test'};
 const baseline=await snapshotMaintenance(t.bindings,target);
 expect(backupSql(baseline)).toContain('INSERT INTO research_connection');
 const author=await t.select('author');expect((await requestResearch(t,author,'/research/jobs',{definition:researchDefinition})).status).toBe(201);
 await expect(planMaintenance(t.bindings,target,baseline,'reset-business')).rejects.toThrow(/research/i);
 expect(await t.bindings.DB.prepare('SELECT COUNT(*) n FROM research_jobs').first('n')).toBe(1);
});
it('restores the pre-research backup format in a legacy-schema clone',async()=>{
 t=await createTestEnvironment();
 for(const name of ['research_subscriptions','research_adoptions','research_proposals','research_results','research_outbox','research_attempts','research_jobs','research_schedules','research_connection'])await t.bindings.DB.prepare(`DROP TABLE ${name}`).run();
 const target={environment:'test' as const,databaseId:'iso-test',bucketName:'iso-test'};
 const current=await snapshotMaintenance(t.bindings,target),legacy=structuredClone(current);
 for(const key of Object.keys(legacy.tables).filter(key=>key.startsWith('research_')))delete (legacy.tables as any)[key];
 legacy.stateHash=await sha256(canonical({tables:legacy.tables,schema:legacy.schema,objects:legacy.objects}));
 const {hash:_,...unsigned}=legacy;legacy.hash=await sha256(canonical(unsigned));
 expect(backupSql(legacy)).not.toContain('CREATE TABLE research_');
 await expect(restoreMaintenanceBackup(t.bindings,target,legacy,current.stateHash)).resolves.toMatchObject({restored:true,stateHash:legacy.stateHash});
});

async function resetFixture(){
 t=await createTestEnvironment();const env=t.bindings,actor=await t.select('author');
 await env.DB.prepare("UPDATE research_connection SET version=version+1,body=json_set(body,'$.version',version+1,'$.state','ready')").run();
 expect((await requestResearch(t,actor,'/research/jobs',{definition:researchDefinition})).status).toBe(201);
 const attempt=(await reserveResearchJob(env))!;await beginResearchJob(env,attempt.id);await finishResearchAttempt(env,attempt.id,resultInput);
 const proposal=await env.DB.prepare('SELECT id FROM research_proposals').first<string>('id');
 const record=await registerRecord(env,actor,{file:new TextEncoder().encode('# Synthetic adopted record\n'),filename:'synthetic.md',documentCode:'SYNTHETIC-RESET',title:'Synthetic',recordTypeIds:['test-F01'],templateRevisionIds:['test-tpl-rev-1'],scope:'',requestKey:crypto.randomUUID(),expectedContext:await getKnowledgeContext(env),researchProposalId:proposal!});
 expect((await requestResearch(t,await t.select('admin'),'/research/schedules',{definition:{...researchDefinition,timing:{kind:'daily',time:'00:00',startDate:'2030-01-01',endDate:''}},enabled:false})).status).toBe(201);
 await env.DB.prepare("UPDATE research_schedules SET version=version+1,enabled=0,body=json_set(body,'$.version',version+1,'$.enabled',json('false'))").run();
 await env.DB.prepare("UPDATE research_connection SET version=version+1,body=json_set(body,'$.version',version+1,'$.state','held')").run();
 await env.DB.prepare('INSERT INTO research_subscriptions VALUES(?,?,?,?,?)').bind('synthetic-subscription',1,'company-dots','2030-01-01T00:00:00Z',JSON.stringify({id:'synthetic-subscription',version:1,secret:'synthetic-sealed-secret'})).run();
 await env.OAUTH_KV!.put('synthetic-oauth-grant','synthetic-credential');
 const target={environment:'test' as const,databaseId:'iso-test',bucketName:'iso-test'};
 return {env,target,record,baseline:await snapshotMaintenance(env,target)};
}

it('explicitly resets business and research while preserving staff grounds, connection, subscription and OAuth',async()=>{
 const {env,target,record,baseline}=await resetFixture();
 const plan=await planMaintenance(env,target,baseline,'reset-business-and-research');
 expect(plan.deleteRows.research_adoptions).toHaveLength(1);
 expect(plan.deleteRows.research_schedules).toHaveLength(1);
 expect(plan.deleteRows.artifacts).toContain(record.artifactId);
 expect(await applyMaintenance(env,target,baseline,plan)).toMatchObject({committed:true,pendingObjects:[]});
 const after=await snapshotMaintenance(env,target);
 for(const table of ['persons','assignments','research_connection','research_subscriptions'] as const)expect(after.tables[table]).toEqual(baseline.tables[table]);
 for(const table of ['research_schedules','research_jobs','research_attempts','research_outbox','research_results','research_proposals','research_adoptions'] as const)expect(after.tables[table]).toEqual([]);
 expect(after.tables.events.map(row=>JSON.parse(String(row.body))).some(event=>event.kind.startsWith('research.')&&(event.jobId||event.scheduleId))).toBe(false);
 expect(after.tables.revisions.some(row=>row.id===record.revisionId)).toBe(false);
 expect(after.objects.some(object=>object.key.includes(record.revisionId))).toBe(false);
 expect(after.schema).toEqual(baseline.schema);
 expect(await env.OAUTH_KV!.get('synthetic-oauth-grant')).toBe('synthetic-credential');
 expect(await applyMaintenance(env,target,baseline,plan)).toMatchObject({alreadyApplied:true,pendingObjects:[]});
 expect((await snapshotMaintenance(env,target)).stateHash).toBe(after.stateHash);
 await expect(restoreMaintenanceBackup(env,target,baseline,after.stateHash)).resolves.toMatchObject({restored:true,stateHash:baseline.stateHash});
});

it('refuses reset until dispatch, schedules and active execution leases are stopped',async()=>{
 const {env,target}=await resetFixture();
 await env.DB.prepare("UPDATE research_connection SET version=version+1,body=json_set(body,'$.version',version+1,'$.state','ready')").run();
 let baseline=await snapshotMaintenance(env,target);
 await expect(planMaintenance(env,target,baseline,'reset-business-and-research')).rejects.toThrow(/pause|held/i);
 await env.DB.prepare("UPDATE research_connection SET version=version+1,body=json_set(body,'$.version',version+1,'$.state','held')").run();
 await env.DB.prepare("UPDATE research_schedules SET version=version+1,enabled=1,body=json_set(body,'$.version',version+1,'$.enabled',json('true'))").run();
 baseline=await snapshotMaintenance(env,target);
 await expect(planMaintenance(env,target,baseline,'reset-business-and-research')).rejects.toThrow(/schedule/i);
 await env.DB.prepare("UPDATE research_schedules SET version=version+1,enabled=0,body=json_set(body,'$.version',version+1,'$.enabled',json('false'))").run();
 await env.DB.prepare("UPDATE research_attempts SET state='running',body=json_set(body,'$.state','running')").run();
 baseline=await snapshotMaintenance(env,target);
 await expect(planMaintenance(env,target,baseline,'reset-business-and-research')).rejects.toThrow(/active|execution/i);
});

it('fences research changes even when counts and the ERP context are unchanged',async()=>{
 const {env,target,baseline}=await resetFixture(),plan=await planMaintenance(env,target,baseline,'reset-business-and-research');
 await env.DB.prepare("UPDATE research_subscriptions SET version=version+1,body=json_set(body,'$.version',version+1)").run();
 await expect(applyMaintenance(env,target,baseline,plan,baseline)).rejects.toThrow();
 expect(await env.DB.prepare('SELECT COUNT(*) n FROM research_jobs').first('n')).toBe(1);
 expect(await env.DB.prepare('SELECT COUNT(*) n FROM research_results').first('n')).toBe(1);
});

it('refuses to delete research provenance used as preserved personnel evidence',async()=>{
 const {env,target,record}=await resetFixture();
 const revision=JSON.parse(await env.DB.prepare('SELECT body FROM revisions WHERE id=?').bind(record.revisionId).first<string>('body') as string);
 const refs=[{revisionId:record.revisionId,sourceSha256:revision.sourceSha256,lineStart:1,lineEnd:1,quote:'# Synthetic adopted record'}];
 await env.DB.prepare("UPDATE persons SET body=json_set(body,'$.evidenceRefs',json(?)) WHERE id='author'").bind(JSON.stringify(refs)).run();
 const baseline=await snapshotMaintenance(env,target);
 await expect(planMaintenance(env,target,baseline,'reset-business-and-research')).rejects.toThrow(/grounds reference research/i);
 expect(await env.DB.prepare('SELECT COUNT(*) n FROM research_adoptions').first('n')).toBe(1);
});
