import {afterEach,expect,it} from 'vitest';
import {createTestEnvironment,type TestEnvironment} from '../support/environment';
import {snapshotMaintenance,planMaintenance,backupSql,restoreMaintenanceBackup} from '../../seed/scripts/maintenance';
import {canonical,sha256} from '../../packages/knowledge/src/index';
import {requestResearch,researchDefinition} from './fixture';
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
