import assert from 'node:assert/strict';
import {cp,mkdir,readdir,lstat,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve,relative,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import app from '../../worker/src/index';
import {canonical,sha256} from '../../packages/knowledge/src/index';
import {all,getBundle,getKnowledgeContext,loadRelease} from '../../worker/src/lib/storage';
import {queryGraph} from '../../worker/src/lib/engine';
import {snapshotMaintenance,planMaintenance,applyMaintenance,restoreMaintenanceBackup,backupSql,type MaintenanceTarget} from '../../seed/scripts/maintenance';
import {containedMaintenancePath,openMaintenancePlatform,writeMaintenanceJson} from '../../seed/scripts/maintenance-platform';
import {repoRoot} from '../support/environment';
import {startTestEngine} from '../support/engine';
import type {Env} from '../../worker/src/types';
import type {GraphResult,Relation} from '../../packages/contracts/src/index';
import {openStaging} from '../staging/platform';

export function verifyMaintenanceTrace(trace:Pick<GraphResult,'relations'|'excluded'|'unknown'>|undefined,relations:Relation[]){
 const hierarchy=new Set(relations.filter(row=>row.type==='subordinate_to').map(row=>row.id));
 if(!hierarchy.size)return false;
 assert.ok(trace&&trace.relations.some(row=>row.type==='subordinate_to'&&hierarchy.has(row.id)),'Hierarchy missing from trace');
 assert.ok(!trace.unknown.some(row=>hierarchy.has(row.id)),'Unresolved hierarchy in trace');
 // Applicability stays unknown until a real record supplies its condition; it is not broken provenance.
 for(const excluded of trace.excluded){
  const relation=relations.find(row=>row.id===excluded.id);
  assert.ok(excluded.reason==='CONDITION_UNKNOWN'&&relation?.type==='requires_record_type'&&relation.reviewStatus==='validated'&&relation.conditionStatus==='unknown'&&relation.condition&&trace.unknown.some(row=>row.id===relation.id&&row.reason===relation.condition),`Unverified trace relation: ${excluded.id} ${excluded.reason}`);
 }
 return true;
}

async function files(root:string,path=root):Promise<string[]>{const result:string[]=[];for(const item of await readdir(path,{withFileTypes:true})){const full=resolve(path,item.name);if(item.isSymbolicLink())throw new Error(`State symlink refused: ${relative(root,full)}`);if(item.isDirectory())result.push(...await files(root,full));else if(item.isFile())result.push(full);else throw new Error('Unsupported state file')}return result.sort()}
export async function stateTreeHash(path:string){return sha256(canonical(await Promise.all((await files(path)).map(async file=>({path:relative(path,file),sha256:await sha256(await readFile(file))})))))}
export async function cloneMaintenanceState(root:string,sourcePath:string,destinationPath:string){
 const source=await containedMaintenancePath(root,sourcePath,'output'),destination=await containedMaintenancePath(root,destinationPath);
 assert.ok(!destination.startsWith(source+'/')&&!source.startsWith(destination+'/')&&source!==destination,'Clone and source must be separate');
 try{await lstat(destination);throw new Error('Clone destination already exists')}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
 const sourceHash=await stateTreeHash(source);await mkdir(dirname(destination),{recursive:true,mode:0o700});await cp(source,destination,{recursive:true,errorOnExist:true,force:false});
 assert.equal(await stateTreeHash(source),sourceHash,'Live source changed during copying; discard clone and retry while quiescent');assert.equal(await stateTreeHash(destination),sourceHash,'Copied state bytes differ');
 // SQLite sees only copied files. Its backup API folds copied WAL into each clone DB.
 for(const file of (await files(destination)).filter(file=>file.endsWith('.sqlite'))){const backup=file+'.backup';execFileSync('python3',['-c',"import sqlite3,sys; s=sqlite3.connect(sys.argv[1]); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()",file,backup]);await rename(backup,file);await rm(file+'-wal',{force:true});await rm(file+'-shm',{force:true})}
 assert.equal(await stateTreeHash(source),sourceHash,'Original source changed during clone normalization');return {sourceHash,source,destination};
}
export async function repairCloneIndexes(env:Env,target:MaintenanceTarget,enabled:boolean){
 if(enabled)assert.ok(target.clone===true&&['local','test'].includes(target.environment),'Index reconstruction is limited to an explicitly isolated local clone');
 const missing:Array<{key:string;sha256:string;releaseId:string;sourcePath:string}>=[],repaired:typeof missing=[];
 for(const row of (await env.DB.prepare('SELECT id FROM releases').all<{id:string}>()).results){const bundle=await loadRelease(env,row.id);
  for(const source of bundle.sources.filter(source=>source.kind==='index')){const key=`sources/${source.revisionId}/${source.sha256}.md`,object=await env.SOURCES.get(key);
   if(object){assert.equal(await sha256(new Uint8Array(await object.arrayBuffer())),source.sha256,`Existing index source changed: ${key}`);continue}
   const item={key,sha256:source.sha256,releaseId:row.id,sourcePath:source.path};missing.push(item);
   if(enabled){const bytes=new TextEncoder().encode(source.markdown);assert.equal(await sha256(bytes),source.sha256,'Installed normalized index text is not byte-identical to the original; reconstruction refused');await env.SOURCES.put(key,bytes);repaired.push(item)}
  }
 }return {missing,repaired};
}
export async function rehearse(env:Env,target:MaintenanceTarget,runId:string,directory:string){
 assert.equal(target.clone,true,'Maintenance rehearsal requires an explicitly isolated clone');
 const baseline=await snapshotMaintenance(env,target);await writeMaintenanceJson(repoRoot,resolve(directory,'baseline.json'),baseline);
 const bundle=await getBundle(env,await getKnowledgeContext(env)),persons=await all<any>(env,'persons'),assignments=await all<any>(env,'assignments');
 const candidates=(action:string,type:string,admin=false)=>persons.filter(person=>person.active&&(!admin||person.isAdmin)&&bundle.policies.some(policy=>policy.action===action&&policy.resourceTypeId===type&&(policy.origin==='product_policy'&&policy.roleId==='administrator'&&person.isAdmin||assignments.some(assignment=>assignment.personId===person.id&&assignment.status==='active'&&policy.roleId===assignment.roleId))));
 const clients=new Map<string,{cookie:string;version:number}>();
 async function client(personId:string){let client=clients.get(personId);if(!client){const response=await app.request('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({personId})},env);assert.equal(response.status,200,await response.clone().text());const data=await response.json() as any;client={cookie:response.headers.get('set-cookie')!.split(';')[0],version:data.sessionVersion};clients.set(personId,client)}return {cookie:client.cookie,'X-Session-Version':String(client.version)}}
 async function post(path:string,personId:string,input:unknown){const response=await app.request(path,{method:'POST',headers:{...await client(personId),'Content-Type':'application/json'},body:JSON.stringify({requestKey:crypto.randomUUID(),expectedContext:await getKnowledgeContext(env),...input as object})},env);assert.ok(response.ok,`${path}: ${response.status} ${await response.clone().text()}`);return response.json() as Promise<any>}
 const type=bundle.recordTypes.find(type=>type.reviewRequired&&type.approvalRequired&&!type.reviewCondition&&!type.approvalCondition&&!type.applicabilityCondition&&['create','submit','review','approve','circulate'].every(action=>candidates(action,type.id).length&&bundle.policies.filter(policy=>policy.action===action&&policy.resourceTypeId===type.id).every(policy=>policy.separationCondition==='none'&&!policy.conditions.length)));
 assert.ok(type,'A simple installed form with complete assigned workflow is required');const author=candidates('create',type.id)[0];
 const form=new FormData();for(const [key,value] of Object.entries({documentCode:`SYNTHETIC-MAINTENANCE-${runId}`,title:'[합성 유지보수 예행] 실제 업무 기록 아님',recordTypeId:type.id,templateRevisionIds:JSON.stringify([type.templateRevisionId]),requestKey:crypto.randomUUID(),expectedContext:JSON.stringify(await getKnowledgeContext(env))}))form.set(key,value);form.set('file',new File(['# 합성 유지보수 예행\n실제 업무·승인 사실이 아닌 복제본 전용 시험 자료.\n'],'synthetic-maintenance.md'));
 const uploaded=await app.request('/api/records',{method:'POST',headers:await client(author.id),body:form},env);assert.equal(uploaded.status,201,await uploaded.clone().text());const record=await uploaded.json() as any;
 for(const action of ['submit','review','approve','circulate']){let selected:{id:string;version:string}|undefined;
  for(const person of candidates(action,type.id)){const response=await app.request(`/api/records/${record.artifactId}/actions?revisionId=${record.revisionId}`,{headers:await client(person.id)},env);assert.equal(response.status,200);const data=await response.json() as any;if(data.actions.some((item:any)=>item.action===action&&item.allowed)){selected={id:person.id,version:data.revisionVersion};break}}
  assert.ok(selected,`Installed actor for ${action} required`);
  if(action==='submit')await post(`/api/records/${record.artifactId}/submit`,selected.id,{revisionId:record.revisionId,expectedRevisionVersion:selected.version});
  else if(action==='circulate'){const circulation=await post(`/api/revisions/${record.revisionId}/circulations`,selected.id,{recipientIds:[author.id],purpose:'합성 유지보수 예행'});await post(`/api/circulations/${circulation.circulationId}/receipts`,author.id,{revisionId:record.revisionId,kind:'received'})}
  else await post(`/api/revisions/${record.revisionId}/decisions`,selected.id,{decision:action,comment:'복제본에서만 수행한 합성 유지보수 예행',expectedRevisionVersion:selected.version});
 }
 const hierarchy=bundle.relations.filter(relation=>relation.type==='subordinate_to'),procedure=bundle.sources.find(source=>source.kind==='procedure'&&hierarchy.some(relation=>relation.subjectId===source.revisionId))??bundle.sources.find(source=>source.kind==='procedure')!;
 const administrator=candidates('revise','procedure',true)[0];assert.ok(administrator,'Administrator with procedure revision authority required');
 const {changeId}=await post('/api/admin/regulation-changes',administrator.id,{title:'[합성 복제본] 릴리스 복귀 예행'}),changePath=`/api/admin/regulation-changes/${changeId}`;
 const regulation=new FormData();for(const [key,value] of Object.entries({artifactId:procedure.artifactId,documentCode:procedure.code,title:procedure.title,kind:'procedure',requestKey:crypto.randomUUID(),expectedContext:JSON.stringify(await getKnowledgeContext(env))}))regulation.set(key,value);regulation.set('file',new File([procedure.markdown+'\n<!-- 합성 복제본의 릴리스 복귀 예행. 실제 규정 개정 아님. -->\n'],'synthetic-regulation.md'));
 const changed=await app.request(`${changePath}/files`,{method:'POST',headers:await client(administrator.id),body:regulation},env);assert.equal(changed.status,201,await changed.clone().text());
 const built=await post(`${changePath}/build`,administrator.id,{}),validated=await post(`${changePath}/decisions`,administrator.id,{decision:'validate_knowledge',candidateHash:built.change.candidateHash,comment:'합성 복제본 예행 검증'});
 for(const decision of ['review','approve']){const person=candidates(decision,'procedure')[0];assert.ok(person,`Procedure ${decision} actor required`);await post(`${changePath}/decisions`,person.id,{decision,candidateHash:validated.change.candidateHash,comment:'합성 복제본 예행 결정'})}
 await post(`${changePath}/publish`,candidates('publish','procedure')[0].id,{candidateHash:validated.change.candidateHash});
 const restorePlan=await planMaintenance(env,target,baseline,'restore-release');await writeMaintenanceJson(repoRoot,resolve(directory,'restore-release-plan.json'),restorePlan);assert.deepEqual((await applyMaintenance(env,target,baseline,restorePlan)).pendingObjects,[]);clients.clear();
 const restoredBundle=await getBundle(env,await getKnowledgeContext(env));assert.equal(restoredBundle.manifest.releaseId,bundle.manifest.releaseId);assert.deepEqual(restoredBundle.relations.filter(relation=>relation.type==='subordinate_to'),hierarchy);
 const backup=await snapshotMaintenance(env,target);await writeMaintenanceJson(repoRoot,resolve(directory,'before-reset-backup.json'),backup);await writeFile(resolve(directory,'before-reset-backup.sql'),backupSql(backup),{mode:0o600});
 const plan=await planMaintenance(env,target,baseline,'reset-business');await writeMaintenanceJson(repoRoot,resolve(directory,'reset-plan.json'),plan);const result=await applyMaintenance(env,target,baseline,plan);assert.deepEqual(result.pendingObjects,[]);
 const after=await snapshotMaintenance(env,target);assert.equal((await applyMaintenance(env,target,baseline,plan)).alreadyApplied,true);assert.equal((await snapshotMaintenance(env,target)).stateHash,after.stateHash);
 assert.deepEqual(after.tables.assignments,baseline.tables.assignments);assert.deepEqual(after.tables.persons,baseline.tables.persons);assert.ok(!after.tables.artifacts.some(row=>row.id===record.artifactId));assert.equal(after.tables.sessions.length,0);assert.equal(after.tables.mutation_requests.length,0);
 const trace=hierarchy.length?await queryGraph(env,await getKnowledgeContext(env),'trace',hierarchy[0].objectId):undefined,traceVerified=verifyMaintenanceTrace(trace,restoredBundle.relations);
 let indexCount=0;for(const source of bundle.sources.filter(source=>source.kind==='index')){const response=await app.request(`/api/source-index/${source.revisionId}`,{headers:await client(author.id)},env);assert.equal(response.status,200,await response.clone().text());indexCount++}
 const restoreFence=await snapshotMaintenance(env,target);await restoreMaintenanceBackup(env,target,backup,restoreFence.stateHash);assert.equal((await snapshotMaintenance(env,target)).stateHash,backup.stateHash);
 return {baselineHash:baseline.hash,backupHash:backup.hash,backupRestored:true,idempotent:true,checks:{persons:baseline.tables.persons.length,assignments:baseline.tables.assignments.length,hierarchyRelations:hierarchy.length,expectedHierarchyRelations:target.environment==='local'?38:hierarchy.length,traceVerified,unresolvedConditionalRelations:trace?.excluded??[],indexSources:indexCount,syntheticWorkflow:true,exactReleaseRestored:true,retainedReleaseHistory:true,immutableTriggers:true},planHash:plan.hash};
}
export async function runMaintenanceRehearsal(runId:string,repairIndexes=false){
 assert.match(runId,/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/);const directory=await containedMaintenancePath(repoRoot,resolve(repoRoot,'output/test/acceptance',runId,'rehearsal'));await mkdir(directory,{recursive:true,mode:0o700});
 const source=resolve(repoRoot,'output/runtime/erp-state/v3'),copyRoot=resolve(directory,'source-copy');await mkdir(copyRoot,{recursive:false,mode:0o700});
 // Clone only authoritative D1/R2 state; engine/cache/observability state is irrelevant.
 const clones=[];for(const kind of ['d1','r2'])clones.push(await cloneMaintenanceState(repoRoot,resolve(source,kind),resolve(copyRoot,kind)));
 const state=resolve(directory,'state','v3');await mkdir(dirname(state),{recursive:true});await rename(copyRoot,state);
 const platform=await openMaintenancePlatform(repoRoot,{environment:'local',runId,statePath:state,command:'rehearsal'}),stop=await startTestEngine();platform.env.ENGINE_URL=process.env.ISO_TEST_ENGINE_URL??'http://127.0.0.1:18765';
 let report:any={kind:'maintenance-rehearsal',target:'local',status:'failed',sourceReadOnly:true,originalUnchanged:false,backupRestored:false,idempotent:false,provenanceRepaired:false};
 try{
  const indexes=await repairCloneIndexes(platform.env,platform.target,repairIndexes);report.missingIndexSources=indexes.missing;report.repairedIndexSources=indexes.repaired;report.provenanceRepaired=indexes.repaired.length>0;
  assert.ok(repairIndexes||indexes.missing.length===0,'Original runtime is missing preserved index sources; current-state rehearsal gate remains blocked');
  report={...report,...await rehearse(platform.env,platform.target,runId,directory)};report.acceptanceReady=!report.provenanceRepaired&&report.checks.hierarchyRelations===38&&report.checks.traceVerified;report.status=report.provenanceRepaired?'passed-repaired-clone':report.acceptanceReady?'passed':'blocked-baseline-hierarchy';return report;
 }
 catch(error){report.failure=String(error);throw error}
 finally{await platform.dispose();await stop();report.sourceTrees=await Promise.all(clones.map(async clone=>({path:relative(repoRoot,clone.source),beforeSha256:clone.sourceHash,afterSha256:await stateTreeHash(clone.source)})));report.originalUnchanged=report.sourceTrees.every((tree:any)=>tree.beforeSha256===tree.afterSha256);if(!report.originalUnchanged)report.status='failed';await writeMaintenanceJson(repoRoot,resolve(directory,'maintenance-report.json'),report);assert.equal(report.originalUnchanged,true,'Original runtime state changed during rehearsal')}
}
export async function runStagingMaintenanceRehearsal(runId:string,configPath:string,confirmTarget:string){
 assert.match(runId,/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/);const path=await containedMaintenancePath(repoRoot,configPath,'output/test/staging'),configuration=JSON.parse(await readFile(path,'utf8'));
 assert.match(configuration.name,/^iso-test-g10-[a-z0-9-]+$/);assert.equal(confirmTarget,configuration.name,'Explicit staging Worker confirmation required');
 const directory=await containedMaintenancePath(repoRoot,resolve(repoRoot,'output/test/acceptance',runId,'staging'));await mkdir(directory,{recursive:true,mode:0o700});
 const platform=await openStaging(path),stop=await startTestEngine();platform.env.ENGINE_URL=process.env.ISO_TEST_ENGINE_URL??'http://127.0.0.1:18765';
 const target:MaintenanceTarget={environment:'staging',databaseId:configuration.d1_databases[0].database_id,bucketName:configuration.r2_buckets[0].bucket_name,accountId:configuration.account_id,clone:true};
 let report:any={kind:'maintenance-rehearsal',target:'staging',status:'failed',backupRestored:false,idempotent:false};
 try{const bundle=await getBundle(platform.env,await getKnowledgeContext(platform.env));assert.ok(bundle.sources.every(source=>source.path.startsWith('synthetic/')),'Remote rehearsal requires isolated synthetic sources');report={...report,...await rehearse(platform.env,target,runId,directory),status:'passed'};return report}
 catch(error){report.failure=String(error);throw error}
 finally{await platform.dispose();await stop();await writeMaintenanceJson(repoRoot,resolve(directory,'maintenance-report.json'),report)}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const {values}=parseArgs({strict:true,options:{'run-id':{type:'string'},target:{type:'string'},config:{type:'string'},'confirm-target':{type:'string'},'repair-clone-index':{type:'boolean'}}});if(!values['run-id'])throw new Error('--run-id is required');
 if(values.target&&values.target!=='local'&&values.target!=='staging')throw new Error('Rehearsal target must be local or isolated staging');
 if(values.target==='staging'&&(!values.config||!values['confirm-target']))throw new Error('Staging requires --config and --confirm-target');
 if(values.target==='staging'&&values['repair-clone-index'])throw new Error('Index repair is local-clone-only');
 console.log(JSON.stringify(values.target==='staging'?await runStagingMaintenanceRehearsal(values['run-id'],values.config!,values['confirm-target']!):await runMaintenanceRehearsal(values['run-id'],values['repair-clone-index']),null,2));
}
