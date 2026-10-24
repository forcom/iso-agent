import assert from 'node:assert/strict';
import {appendFile,mkdir,open,readFile,readdir,realpath,rm} from 'node:fs/promises';
import {isAbsolute,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {createInterface} from 'node:readline/promises';
import {spawn} from 'node:child_process';
import {createHttp,message,saveJson,stable,type Client} from './client';
import {assertInventory,hash,requestKey,targetUrl,validateActors,validateSources,type Inventory,type Target} from './inventory';
import {assertOracleApproved,validatePermissionPersonnel,validatePermissionSources,validatePolicyComparison,type PermissionOracle} from './permissions';
import {prepareInventory} from './prepare';
import {assertPinnedContext,runRecords,type Checkpoint} from './run';

export const repoRoot=fileURLToPath(new URL('../../../',import.meta.url));
const policyPath='apps/seed/inputs/reviewed-mappings.json';
function within(path:string,root:string){const rel=relative(root,path);return rel===''||!rel.startsWith('..')&&!isAbsolute(rel);}
async function original(path:string) {
 const source=await realpath(resolve(repoRoot,path));assert.ok(within(source,resolve(repoRoot,'docs/records')),'Original must remain inside docs/records');return readFile(source);
}
export async function validatePrerequisites(plan:Inventory,read:(path:string)=>Promise<Uint8Array>) {
 const inputSha256=hash(stable(plan.rows.map(row=>[row.informationId,row.sourceSha256]).sort()));
 for(const [key,kind,target] of [['localAcceptanceReport','erp-records-acceptance','local'],['resetRehearsalReport','maintenance-rehearsal','local'],['remoteBackupReport','maintenance-backup','remote']] as const){
  if(plan.target==='local'&&key!=='resetRehearsalReport')continue;
  const ref=plan.prerequisites[key];assert.ok(ref,`${plan.target} prerequisite missing: ${key}`);
  assert.ok(within(resolve(repoRoot,ref.path),resolve(repoRoot,'output/test/acceptance')),'Prerequisite evidence must stay under output/test/acceptance');
  const bytes=await read(ref.path);assert.equal(hash(bytes),ref.sha256,`Changed prerequisite ${key}`);const report=JSON.parse(new TextDecoder().decode(bytes));
  assert.equal(report.kind,kind);assert.equal(report.target,target);assert.equal(report.status,'passed',`${key} was not passed`);
  if(key==='localAcceptanceReport'){
   assert.equal(report.inputSha256,inputSha256);assert.equal(report.releaseId,plan.context.releaseId);
   for(let number=1;number<=18;number++){const code=`AT-${String(number).padStart(2,'0')}`;assert.equal(report.scenarios?.[code],'passed',`Missing required local ${code} result`);}
  }
  if(key==='resetRehearsalReport'){assert.notEqual(report.provenanceRepaired,true,'Reset rehearsal changed original provenance');for(const field of ['sourceReadOnly','originalUnchanged','backupRestored','idempotent'])assert.equal(report[field],true,`Reset rehearsal lacks ${field}`);}
  if(key==='remoteBackupReport')assert.ok(report.snapshotPath&&report.snapshotHash&&report.stateHash&&report.createdAt,'Incomplete remote backup evidence');
 }
}
export async function validatePlan(plan:Inventory,read:(path:string)=>Promise<Uint8Array>) {
 assertInventory(plan);
 const oracleBytes=await read(plan.oraclePath);assert.equal(hash(oracleBytes),plan.oracleSha256,'Permission oracle changed');const oracle:unknown=JSON.parse(new TextDecoder().decode(oracleBytes));
 assertOracleApproved(oracle,[...new Set(plan.rows.map(row=>row.formId))]);
 const policies=await read(policyPath);assert.equal(hash(policies),plan.policySha256,'Policy file changed');
 assert.deepEqual(validatePolicyComparison(oracle,JSON.parse(new TextDecoder().decode(policies)),hash(policies)),[]);
 assert.equal(oracle.personnel?.path,'apps/seed/inputs/aidu-personnel.json','Personnel source mismatch');const personnel=await read(oracle.personnel!.path);assert.deepEqual(validatePermissionPersonnel(oracle,JSON.parse(new TextDecoder().decode(personnel)),hash(personnel)),[]);
 assert.deepEqual(await validatePermissionSources(oracle,async path=>new TextDecoder().decode(await read(path))),[]);
 validateActors(plan,oracle);await validateSources(plan.rows,read);
 await validatePrerequisites(plan,read);
}
export async function main(args=process.argv.slice(2)) {
 const {values}=parseArgs({args,options:{target:{type:'string'},'run-id':{type:'string'},plan:{type:'string'},'base-url':{type:'string'},oracle:{type:'string'},prepare:{type:'boolean'},screens:{type:'boolean'},'sample-code':{type:'string'}}});
 assert.ok(values.target&&values['run-id']&&values.plan,'Required: --target local|remote --run-id <id> --plan <inventory.json>');
 const target=values.target as Target,runId=values['run-id'],baseUrl=targetUrl(target,values['base-url']);requestKey(runId,target,'validation','validation');
 const directory=resolve(repoRoot,'output/test/acceptance',runId,target),planPath=resolve(repoRoot,values.plan);
 const cookie=process.env.ACCEPTANCE_SESSION_COOKIE;assert.ok(cookie&&/^iso_session=[^;\s]+$/.test(cookie),'Set ACCEPTANCE_SESSION_COOKIE to an existing selected-employee session; preparation only uses GET');
 const reader:Client={personId:'existing-session',cookie,version:Number(process.env.ACCEPTANCE_SESSION_VERSION??1)};
 const http=createHttp({baseUrl}),read=async(path:string)=>path.startsWith('docs/records/')?original(path):readFile(resolve(repoRoot,path));
 if(values.prepare){
  assert.ok(!values.screens,'Preparation and screens are separate operations');assert.ok(within(planPath,directory),'Generated inventory must be under this run/target output directory');
  const oraclePath=values.oracle??'apps/test/acceptance/expected-permissions.json',oracleBytes=await read(oraclePath),oracle=JSON.parse(oracleBytes.toString()) as PermissionOracle;
  const files=(await readdir(resolve(repoRoot,'docs/records'),{recursive:true})).filter(path=>path.endsWith('.md')&&!path.endsWith('README.md')).sort();assert.equal(files.length,74,'Expected 74 original Markdown files');
  const sources=[];for(const path of files){const sourcePath=`docs/records/${path}`;sources.push({path:sourcePath,bytes:await original(sourcePath)});}
  const plan=await prepareInventory({target,baseUrl,http,client:reader,oracle,oraclePath,oracleSha256:hash(oracleBytes),policySha256:hash(await read(policyPath)),sources});
  await saveJson(planPath,plan);console.log(JSON.stringify({status:'prepared-not-executed',plan:planPath,records:plan.rows.length,unresolvedRows:plan.rows.filter(row=>row.issues.length).length}));return;
 }
 const raw=await readFile(planPath),plan=JSON.parse(raw.toString()) as Inventory;assert.equal(plan.target,target);assert.equal(plan.baseUrl,baseUrl);
 await validatePlan(plan,read);
 const me=(await http('/api/me',{client:reader})).body;assertPinnedContext(plan.context,me.context);
 const people=(await http('/api/persons',{client:reader})).body.items;
 for(const person of plan.persons)assert.ok(people.some((current:any)=>current.id===person.id&&current.name===person.name&&current.personaId===person.personaId),`Installed person changed: ${person.id}`);
 const entities=(await http('/api/entities',{client:reader})).body;
 assertPinnedContext(plan.context,entities.context);
 const templateVersions=new Map<string,string>();
 for(const row of plan.rows){
  const type=entities.items.find((item:any)=>item.type==='RecordType'&&item.id===row.recordTypeId)?.metadata;
  assert.ok(type&&type.code===row.formId&&type.templateRevisionId===row.templateRevisionId,`Installed type/template changed: ${row.formId}`);
  if(row.targetSystemId)assert.ok(entities.items.some((item:any)=>item.type==='AISystem'&&item.id===row.targetSystemId),`Unknown target system: ${row.informationId}`);
  if(!templateVersions.has(row.templateRevisionId)){
   const content=(await http(`/api/artifacts/${type.templateArtifactId}/revisions/${row.templateRevisionId}/content`,{client:reader})).body;assert.equal(content.evidenceStatus,'verified');
   templateVersions.set(row.templateRevisionId,content.markdown.match(/^template_version:\s*["']?([^\n"']+)/m)?.[1].trim()??'');
  }
  assert.equal(templateVersions.get(row.templateRevisionId),row.templateVersion,`Installed template version mismatch: ${row.formId}`);
 }
 if(target==='remote'){
  assert.ok(process.stdin.isTTY&&process.stdout.isTTY,'Remote writes require interactive confirmation in a terminal');
  const prompt=createInterface({input:process.stdin,output:process.stdout});try{const phrase=`RUN ${runId} ${baseUrl}`;assert.equal(await prompt.question(`Remote acceptance writes to ${baseUrl}. Type ${phrase}: `),phrase,'Remote confirmation rejected');}finally{prompt.close();}
 }
 await mkdir(directory,{recursive:true});const lock=await open(resolve(directory,'run.lock'),'wx');
 try{
  await lock.writeFile(String(process.pid));
  if(values.screens){
   const code=values['sample-code'];assert.ok(code,'Screen run requires --sample-code <information_id>');
   const row=plan.rows.find(row=>row.informationId===code);assert.ok(row&&!row.draftOnly&&!row.confirmations.length&&row.actors.approvers.length,'Choose an unconditional approval-required screen sample');
   const exit=await new Promise<number|null>(done=>{const child=spawn('pnpm',['--filter','@iso-agent/test','exec','playwright','test','--config','acceptance/playwright.config.ts'],{cwd:repoRoot,stdio:'inherit',env:{...process.env,ACCEPTANCE_PLAN:planPath,ACCEPTANCE_RUN_ID:runId,ACCEPTANCE_TARGET:target,ACCEPTANCE_BASE_URL:baseUrl,ACCEPTANCE_SAMPLE_CODE:code,ACCEPTANCE_SCREEN_AUTHORIZED:hash(raw)}});child.on('error',()=>done(1));child.on('exit',done)});assert.equal(exit,0,'Acceptance screen sample failed');return;
  }
  const checkpointPath=resolve(directory,'checkpoint.json');let checkpoint:Checkpoint;
  try{checkpoint=JSON.parse(await readFile(checkpointPath,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;checkpoint={planSha256:hash(raw),operations:{},records:{}};}
  assert.equal(checkpoint.planSha256,hash(raw),'Plan changed for this run-id; use a new run-id');
  const persist=async()=>{await saveJson(checkpointPath,checkpoint);await saveJson(resolve(directory,'records.json'),Object.values(checkpoint.records));};
  let status='failed';try{await runRecords({plan,runId,http,checkpoint,readSource:original,persist,record:async entry=>{await appendFile(resolve(directory,'results.jsonl'),JSON.stringify(entry)+'\n',{mode:0o600});}});status=Object.values(checkpoint.records).some(row=>row.expectedOutcome==='approval-denied')?'blocked':'passed';}
  finally{await saveJson(resolve(directory,'run-report.json'),{kind:'acceptance-api-run',status,target,runId,baseUrl,planSha256:hash(raw),coverage:'P-7 API runner only; expected denial does not complete approval/circulation and this report is not AT-01..20 acceptance',records:Object.values(checkpoint.records).map(row=>({informationId:row.informationId,verification:row.verification,expectedOutcome:row.expectedOutcome,appState:row.appState})),finishedAt:new Date().toISOString()});}
  if(status!=='passed')process.exitCode=1;
  console.log(JSON.stringify({status,records:plan.rows.length,directory}));
 }finally{await lock.close();await rm(resolve(directory,'run.lock'));}
}
export function fail(error:unknown){console.error(message(error,[process.env.ACCEPTANCE_SESSION_COOKIE??'']));process.exitCode=1;}
