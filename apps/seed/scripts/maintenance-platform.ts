import {mkdir,realpath,readFile,writeFile,lstat} from 'node:fs/promises';
import {resolve,relative,dirname,isAbsolute,basename} from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import type {Env} from '../../worker/src/types';
import {demoBindingsConfiguration} from './deployment';
import {sha256} from '../../packages/knowledge/src/index';
import type {MaintenanceTarget} from './maintenance';

export interface MaintenanceOptions {environment?:string;runId?:string;statePath?:string;command?:string;confirmTarget?:string;rehearsalReport?:string;rehearsalHash?:string;stagingReport?:string;stagingHash?:string}
export function validateMaintenanceOptions(options:MaintenanceOptions){
 if(!['local','demo'].includes(options.environment??''))throw new Error('Explicit --environment local|demo is required');
 if(!options.runId||!/^[-a-zA-Z0-9_]{1,80}$/.test(options.runId)||options.runId.startsWith('-'))throw new Error('Safe --run-id required');
 if(options.environment==='local'&&!options.statePath)throw new Error('Explicit --state-path required; no default runtime database');
 if(options.environment==='demo'&&['apply','restore-backup'].includes(options.command??'')&&(!options.confirmTarget||!options.rehearsalReport||!options.rehearsalHash||!options.stagingReport||!options.stagingHash))throw new Error('Remote mutation requires target confirmation and hashed local/staging rehearsal reports');
}
export async function containedMaintenancePath(root:string,path:string,allowed='output/test/acceptance'){
 const repository=await realpath(root),base=resolve(repository,allowed),requested=resolve(repository,path);
 const within=(candidate:string)=>{const rel=relative(base,candidate);return rel===''||!rel.startsWith('..')&&!isAbsolute(rel)};
 if(!within(requested))throw new Error('Maintenance path is outside the allowed output directory');
 let ancestor=requested;const suffix:string[]=[];
 while(true){try{await lstat(ancestor);break}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;suffix.unshift(basename(ancestor));const parent=dirname(ancestor);if(parent===ancestor)throw error;ancestor=parent}}
 const resolved=resolve(await realpath(ancestor),...suffix);if(!within(resolved))throw new Error('Maintenance path escapes output through a symlink');return resolved;
}
export async function writeMaintenanceJson(root:string,path:string,value:unknown){const safe=await containedMaintenancePath(root,path);await mkdir(dirname(safe),{recursive:true,mode:0o700});await writeFile(safe,JSON.stringify(value,null,2)+'\n',{mode:0o600});return safe}
export async function readMaintenanceJson<T>(root:string,path:string):Promise<T>{return JSON.parse(await readFile(await containedMaintenancePath(root,path),'utf8'))}
export async function validateRehearsalReport(root:string,path:string,hash:string,target:'local'|'staging'){
 const text=await readFile(await containedMaintenancePath(root,path),'utf8');if(await sha256(text)!==hash)throw new Error('Rehearsal report hash changed');const report=JSON.parse(text);
 if(report.kind!=='maintenance-rehearsal'||report.status!=='passed'||report.provenanceRepaired===true||report.target!==target||report.backupRestored!==true||report.idempotent!==true||target==='local'&&(report.sourceReadOnly!==true||report.originalUnchanged!==true||report.checks?.hierarchyRelations!==38||report.checks?.traceVerified!==true))throw new Error('Successful unrepaired maintenance rehearsal with the expected hierarchy is required');return report;
}
export async function openMaintenancePlatform(root:string,options:MaintenanceOptions){
 validateMaintenanceOptions(options);const environment=options.environment as 'local'|'demo',reportDirectory=await containedMaintenancePath(root,resolve(root,'output/test/acceptance',options.runId!,environment==='demo'?'remote':'local'));
 await mkdir(reportDirectory,{recursive:true,mode:0o700});process.env.WRANGLER_LOG_PATH=resolve(reportDirectory,'logs');process.env.WRANGLER_CACHE_DIR=resolve(reportDirectory,'cache');
 const wrangler=createRequire(resolve(root,'apps/worker/package.json'))('wrangler') as {unstable_readConfig(args:object,options?:object):any;getPlatformProxy(options:object):Promise<{env:Env;dispose():Promise<void>}>};
 let config:any,target:MaintenanceTarget;
 if(environment==='local'){
  const statePath=await containedMaintenancePath(root,options.statePath!,'output'),isClone=relative(resolve(root,'output/test/acceptance'),statePath);const clone=isClone!==''&&!isClone.startsWith('..')&&!isAbsolute(isClone);
  if(!clone&&statePath!==resolve(root,'output/runtime/erp-state/v3'))throw new Error('Local state must be an acceptance clone or the exact explicit runtime state');
  await lstat(statePath);const local=wrangler.unstable_readConfig({config:resolve(root,'apps/worker/wrangler.local.toml')},{hideWarnings:true});
  if(local.d1_databases?.length!==1||local.r2_buckets?.length!==1||local.d1_databases[0].remote||local.r2_buckets[0].remote)throw new Error('Expected local-only D1/R2 configuration');
  config={name:'iso-agent-maintenance',compatibility_date:local.compatibility_date,vars:{ALLOW_FICTIONAL_PERSONNEL:local.vars?.ALLOW_FICTIONAL_PERSONNEL},d1_databases:[{binding:'DB',database_name:local.d1_databases[0].database_name,database_id:local.d1_databases[0].database_id}],r2_buckets:[{binding:'SOURCES',bucket_name:local.r2_buckets[0].bucket_name}]};
  target={environment,databaseId:config.d1_databases[0].database_id,bucketName:config.r2_buckets[0].bucket_name,statePath,clone};
  if(!clone&&options.command==='apply'){
   if(options.confirmTarget!==target.databaseId||!options.rehearsalReport||!options.rehearsalHash)throw new Error('Live local apply requires explicit target confirmation and hashed clone rehearsal');await validateRehearsalReport(root,options.rehearsalReport,options.rehearsalHash,'local');
  }
 }else{
  config=demoBindingsConfiguration(wrangler.unstable_readConfig({config:resolve(root,'apps/worker/wrangler.toml')},{hideWarnings:true}));target={environment,databaseId:config.d1_databases[0].database_id,bucketName:config.r2_buckets[0].bucket_name,accountId:config.account_id};
  const info=JSON.parse(execFileSync(process.execPath,[resolve(root,'apps/worker/node_modules/wrangler/bin/wrangler.js'),'d1','info',target.databaseId,'--json','--config',resolve(root,'apps/worker/wrangler.toml')],{encoding:'utf8',env:process.env}));
  if(info.uuid!==target.databaseId||info.name!==config.d1_databases[0].database_name)throw new Error('Remote D1 identity mismatch');
  if(options.command==='apply'){if(options.confirmTarget!==target.databaseId)throw new Error('Remote target confirmation mismatch');await validateRehearsalReport(root,options.rehearsalReport!,options.rehearsalHash!,'local');await validateRehearsalReport(root,options.stagingReport!,options.stagingHash!,'staging')}
 }
 if(options.command==='restore-backup'&&!target.clone)throw new Error('Exact backup restore is clone-only');
 const configPath=await writeMaintenanceJson(root,resolve(reportDirectory,'maintenance-bindings.json'),config);
 return {...await wrangler.getPlatformProxy({configPath,remoteBindings:environment==='demo',envFiles:[],persist:environment==='local'?{path:target.statePath}:false}),target,reportDirectory};
}
