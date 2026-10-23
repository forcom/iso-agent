import {afterEach,expect,it} from 'vitest';
import {mkdir,mkdtemp,rm,symlink,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {repoRoot} from '../support/environment';
import * as paths from '../../seed/scripts/maintenance-platform';
import {sha256} from '../../packages/knowledge/src/index';
const directories:string[]=[];afterEach(async()=>{for(const path of directories.splice(0))await rm(path,{recursive:true,force:true})});
it('refuses escaped state and output paths before creating files through symlinks',async()=>{
 const base=resolve(repoRoot,'output/test/acceptance');await mkdir(base,{recursive:true});const dir=await mkdtemp(resolve(base,'iso-test-path-'));directories.push(dir);
 const outside=await mkdtemp(resolve(repoRoot,'output/test/iso-test-outside-'));directories.push(outside);await symlink(outside,resolve(dir,'escape'));
 await expect(paths.containedMaintenancePath(repoRoot,resolve(dir,'escape','new','backup.json'))).rejects.toThrow(/outside|escape/i);
 await expect(paths.containedMaintenancePath(repoRoot,'../outside.json')).rejects.toThrow(/outside|escape/i);
 await writeFile(resolve(dir,'snapshot.json'),'synthetic');expect(await paths.containedMaintenancePath(repoRoot,resolve(dir,'snapshot.json'))).toBe(resolve(dir,'snapshot.json'));
});
it('requires explicit local state and remote mutation gates',()=>{
 expect(()=>paths.validateMaintenanceOptions({environment:'local',runId:'synthetic'})).toThrow(/state/i);
 expect(()=>paths.validateMaintenanceOptions({environment:'demo',runId:'synthetic',command:'apply'})).toThrow(/confirm|rehearsal/i);
 expect(()=>paths.validateMaintenanceOptions({environment:'production',runId:'synthetic'})).toThrow(/environment/i);
 expect(()=>paths.validateMaintenanceOptions({environment:'local',runId:'../escape',statePath:'output/test/acceptance/state'})).toThrow(/run/i);
});
it('rejects repaired clone reports even if a report claims a passed status',async()=>{
 const base=resolve(repoRoot,'output/test/acceptance');await mkdir(base,{recursive:true});const dir=await mkdtemp(resolve(base,'iso-test-report-'));directories.push(dir);
 const path=resolve(dir,'report.json'),report={kind:'maintenance-rehearsal',status:'passed',target:'local',sourceReadOnly:true,originalUnchanged:true,backupRestored:true,idempotent:true,provenanceRepaired:true,checks:{hierarchyRelations:38,traceVerified:true}},text=JSON.stringify(report);await writeFile(path,text);
 await expect(paths.validateRehearsalReport(repoRoot,path,await sha256(text),'local')).rejects.toThrow(/rehearsal|repair/i);
 const valid=JSON.stringify({...report,provenanceRepaired:false});await writeFile(path,valid);await expect(paths.validateRehearsalReport(repoRoot,path,await sha256(valid),'local')).resolves.toMatchObject({status:'passed'});
 const oldBaseline=JSON.stringify({...report,provenanceRepaired:false,checks:{hierarchyRelations:0,traceVerified:false}});await writeFile(path,oldBaseline);await expect(paths.validateRehearsalReport(repoRoot,path,await sha256(oldBaseline),'local')).rejects.toThrow(/rehearsal|hierarchy/i);
});
