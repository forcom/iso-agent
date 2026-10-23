import {afterEach,expect,it} from 'vitest';
import {mkdir,mkdtemp,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {repoRoot} from '../support/environment';
import * as rehearsal from './maintenance-rehearsal';
const directories:string[]=[];afterEach(async()=>{for(const path of directories.splice(0))await rm(path,{recursive:true,force:true})});
it('clones SQLite and blob bytes without changing the source or opening a live source database',async()=>{
 const base=resolve(repoRoot,'output/test/acceptance');await mkdir(base,{recursive:true});const dir=await mkdtemp(resolve(base,'iso-test-clone-'));directories.push(dir);
 const source=resolve(dir,'source');await mkdir(resolve(source,'d1'),{recursive:true});await mkdir(resolve(source,'r2','blobs'),{recursive:true});await writeFile(resolve(source,'r2','blobs','synthetic'),'synthetic R2 bytes');
 execFileSync('python3',['-c',"import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute('pragma journal_mode=wal'); c.execute('create table sample(value text)'); c.execute(\"insert into sample values('synthetic')\"); c.commit(); c.close()",resolve(source,'d1','synthetic.sqlite')]);
 const before=await rehearsal.stateTreeHash(source),result=await rehearsal.cloneMaintenanceState(repoRoot,source,resolve(dir,'clone'));
 expect(result.sourceHash).toBe(before);expect(await rehearsal.stateTreeHash(source)).toBe(before);expect(await readFile(resolve(dir,'clone','r2','blobs','synthetic'),'utf8')).toBe('synthetic R2 bytes');
 expect(execFileSync('python3',['-c',"import sqlite3,sys; print(sqlite3.connect(sys.argv[1]).execute('select value from sample').fetchone()[0])",resolve(dir,'clone','d1','synthetic.sqlite')],{encoding:'utf8'}).trim()).toBe('synthetic');
 await expect(rehearsal.cloneMaintenanceState(repoRoot,source,resolve(dir,'clone'))).rejects.toThrow(/exist/i);
 await symlink(resolve(dir,'clone'),resolve(source,'r2','escape'));await expect(rehearsal.cloneMaintenanceState(repoRoot,source,resolve(dir,'other'))).rejects.toThrow(/symlink/i);
});
it('rejects a demo target and missing staging confirmation before opening remote bindings',async()=>{
 const base=resolve(repoRoot,'output/test/staging');await mkdir(base,{recursive:true});const dir=await mkdtemp(resolve(base,'iso-test-maintenance-gate-'));directories.push(dir);const config=resolve(dir,'wrangler.json');
 await writeFile(config,JSON.stringify({name:'iso-agent-demo'}));await expect(rehearsal.runStagingMaintenanceRehearsal('synthetic',config,'iso-agent-demo')).rejects.toThrow();
 await writeFile(config,JSON.stringify({name:'iso-test-g10-synthetic'}));await expect(rehearsal.runStagingMaintenanceRehearsal('synthetic',config,'wrong-target')).rejects.toThrow(/confirmation/i);
});
