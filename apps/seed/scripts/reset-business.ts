import {parseArgs} from 'node:util';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeFile,mkdir} from 'node:fs/promises';
import {applyMaintenance,backupSql,planMaintenance,restoreMaintenanceBackup,snapshotMaintenance,verifySnapshot,type MaintenancePlan,type MaintenanceSnapshot} from './maintenance';
import {containedMaintenancePath,openMaintenancePlatform,readMaintenanceJson,writeMaintenanceJson} from './maintenance-platform';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const {values,positionals}=parseArgs({allowPositionals:true,strict:true,options:Object.fromEntries(['environment','run-id','state-path','baseline','plan-file','expected-hash','operation','confirm-target','rehearsal-report','rehearsal-hash','staging-report','staging-hash'].map(name=>[name,{type:'string' as const}]))});
const command=positionals[0];if(positionals.length!==1||!['snapshot','plan','apply','restore-backup'].includes(command))throw new Error('Use snapshot|plan|apply|restore-backup with --environment local|demo --run-id ID and explicit local --state-path.');
if(['plan','apply','restore-backup'].includes(command)&&!values.baseline)throw new Error('--baseline snapshot path required');
if(command==='apply'&&(!values['plan-file']||!values['expected-hash']))throw new Error('Apply requires --plan-file and its --expected-hash');
if(command==='restore-backup'&&!values['expected-hash'])throw new Error('Restore requires the current --expected-hash state fence');
const platform=await openMaintenancePlatform(root,{environment:values.environment,runId:values['run-id'],statePath:values['state-path'],command,confirmTarget:values['confirm-target'],rehearsalReport:values['rehearsal-report'],rehearsalHash:values['rehearsal-hash'],stagingReport:values['staging-report'],stagingHash:values['staging-hash']});
try{
 const directory=platform.reportDirectory;
 async function saveBackup(snapshot:MaintenanceSnapshot,label:string){
  const backupDirectory=await containedMaintenancePath(root,resolve(directory,'backup'));await mkdir(backupDirectory,{recursive:true,mode:0o700});
  const snapshotPath=await containedMaintenancePath(root,resolve(backupDirectory,`${label}.json`));let exists=false;
  try{const previous=await readMaintenanceJson<MaintenanceSnapshot>(root,snapshotPath);await verifySnapshot(previous);if(previous.stateHash!==snapshot.stateHash||JSON.stringify(previous.target)!==JSON.stringify(snapshot.target))throw new Error('Existing backup does not match the planned pre-apply state');snapshot=previous;exists=true}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
  if(!exists)await writeFile(snapshotPath,JSON.stringify(snapshot,null,2)+'\n',{mode:0o600,flag:'wx'});
  await writeFile(await containedMaintenancePath(root,resolve(backupDirectory,`${label}.sql`)),backupSql(snapshot),{mode:0o600});
  const report={kind:'maintenance-backup',status:'passed',target:values.environment==='demo'?'remote':'local',snapshotPath,snapshotHash:snapshot.hash,stateHash:snapshot.stateHash,objectCount:snapshot.objects.length,tableCounts:Object.fromEntries(Object.entries(snapshot.tables).map(([name,rows])=>[name,rows.length])),createdAt:snapshot.createdAt,maintenanceTarget:platform.target};await writeMaintenanceJson(root,resolve(directory,'backup-report.json'),report);return report;
 }
 if(command==='snapshot'){
  const snapshot=await snapshotMaintenance(platform.env,platform.target);console.log(JSON.stringify(await saveBackup(snapshot,snapshot.hash),null,2));
 }else{
  const baseline=await readMaintenanceJson<MaintenanceSnapshot>(root,values.baseline!);
  if(command==='plan'){
   const plan=await planMaintenance(platform.env,platform.target,baseline,values.operation as MaintenancePlan['operation']);const planPath=await writeMaintenanceJson(root,resolve(directory,`${plan.operation}-plan.json`),plan);console.log(JSON.stringify({planPath,hash:plan.hash,operation:plan.operation,deleteRows:Object.fromEntries(Object.entries(plan.deleteRows).map(([name,ids])=>[name,ids.length])),deleteObjects:plan.deleteObjects.length},null,2));
  }else if(command==='apply'){
   const plan=await readMaintenanceJson<MaintenancePlan>(root,values['plan-file']!);if(plan.hash!==values['expected-hash'])throw new Error('Expected plan hash mismatch');
   if(!await platform.env.DB.prepare('SELECT id FROM events WHERE id=?').bind(`maintenance:${plan.hash}`).first()){
    const backup=await snapshotMaintenance(platform.env,platform.target);if(backup.stateHash!==plan.beforeHash)throw new Error('Stale plan: state changed before backup');await saveBackup(backup,`before-${plan.hash}`);
   }
   const result=await applyMaintenance(platform.env,platform.target,baseline,plan);await writeMaintenanceJson(root,resolve(directory,`${plan.operation}-result.json`),result);console.log(JSON.stringify(result,null,2));if(result.pendingObjects.length)process.exitCode=2;
  }else{const result=await restoreMaintenanceBackup(platform.env,platform.target,baseline,values['expected-hash']!);await writeMaintenanceJson(root,resolve(directory,'restore-backup-result.json'),result);console.log(JSON.stringify(result,null,2))}
 }
}finally{await platform.dispose()}
