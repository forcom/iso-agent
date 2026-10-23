import {afterEach,expect,it} from 'vitest';
import {createTestEnvironment,type TestEnvironment} from '../support/environment';
import {snapshotMaintenance,planMaintenance,backupSql} from '../../seed/scripts/maintenance';
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
