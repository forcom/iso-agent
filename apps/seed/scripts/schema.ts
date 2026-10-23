import {readdir,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import type {Env} from '../../worker/src/types';
/** Fresh databases only. Existing installations apply the additive SQL explicitly. */
export async function installInitialSchema(db:Env['DB'],root:string){
 const dir=resolve(root,'apps/worker/migrations');
 for(const name of (await readdir(dir)).filter(name=>/^\d+_.*\.sql$/.test(name)).sort()){
  const migration=await readFile(resolve(dir,name),'utf8');
  for(const sql of migration.split('-- statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
 }
}
