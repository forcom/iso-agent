import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import type {Env} from '../../worker/src/types';

export function installationEnvironment(value:unknown):'local'|'demo'{
 if(value!=='local'&&value!=='demo')throw new Error('Use an explicit --environment local or --environment demo.');
 return value;
}

export function demoBindingsConfiguration(config:any){
 const demoName=(name:unknown)=>typeof name==='string'&&/^iso-agent-demo(?:-[a-z0-9-]+)?$/.test(name);
 const databases=config?.d1_databases,buckets=config?.r2_buckets;
 if(!demoName(config?.name)||typeof config?.account_id!=='string')throw new Error('Demo Worker and account must be explicit.');
 if(!/^[a-f\d]{32}$/i.test(config.account_id)||config.vars?.ALLOW_FICTIONAL_PERSONNEL!=='true')throw new Error('Demo account and fictional-personnel setting are required.');
 if(!Array.isArray(databases)||databases.length!==1||databases[0].binding!=='DB'||!demoName(databases[0].database_name)||databases[0].remote!==true||!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(databases[0].database_id)||/^0{8}-0{4}-0{4}-0{4}-/.test(databases[0].database_id))throw new Error('Demo D1 needs its real ID, demo name and remote:true.');
 if(!Array.isArray(buckets)||buckets.length!==1||buckets[0].binding!=='SOURCES'||!demoName(buckets[0].bucket_name)||buckets[0].remote!==true)throw new Error('Demo R2 needs its demo name and remote:true.');
 return {name:`${config.name}-installation`,account_id:config.account_id,compatibility_date:config.compatibility_date??'2025-10-01',vars:{ALLOW_FICTIONAL_PERSONNEL:'true'},d1_databases:[{binding:'DB',database_name:databases[0].database_name,database_id:databases[0].database_id,remote:true}],r2_buckets:[{binding:'SOURCES',bucket_name:buckets[0].bucket_name,remote:true}]};
}

export async function openInstallationPlatform(root:string,environment:'local'|'demo'){
 const runtime=resolve(root,'output/runtime'),reportDirectory=environment==='local'?runtime:resolve(runtime,'deploy/demo');
 await mkdir(reportDirectory,{recursive:true});
 process.env.WRANGLER_LOG_PATH=resolve(runtime,'logs');process.env.WRANGLER_CACHE_DIR=resolve(runtime,'cache');
 const wrangler=createRequire(resolve(root,'apps/worker/package.json'))('wrangler') as {unstable_readConfig(args:object,options?:object):unknown;getPlatformProxy(options:object):Promise<{env:Env;dispose():Promise<void>}>};
 let configPath=resolve(root,'apps/worker/wrangler.local.toml');
 if(environment==='demo'){
  const config=wrangler.unstable_readConfig({config:resolve(root,'apps/worker/wrangler.toml')},{hideWarnings:true});
  const bindings=demoBindingsConfiguration(config);
  configPath=resolve(reportDirectory,'bindings.json');
  await writeFile(configPath,JSON.stringify(bindings,null,2)+'\n');
 }
 const platform=await wrangler.getPlatformProxy({configPath,remoteBindings:environment==='demo',envFiles:[],persist:environment==='local'?{path:resolve(runtime,'erp-state/v3')}:false});
 return {...platform,reportDirectory};
}
