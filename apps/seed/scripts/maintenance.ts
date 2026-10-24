import {readFile} from 'node:fs/promises';
import {Buffer} from 'node:buffer';
import {canonical, sha256} from '../../packages/knowledge/src/index';
import type {Env} from '../../worker/src/types';
import type {KnowledgeBundle} from '../../packages/contracts/src/index';

export interface MaintenanceTarget {environment:'local'|'demo'|'staging'|'test';databaseId:string;bucketName:string;statePath?:string;accountId?:string;clone?:boolean}
type Row=Record<string,string|number|null>;
type SchemaRow={type:string;name:string;sql:string};
type StoredObject={key:string;sha256:string;bytes:string;customMetadata?:Record<string,string>;httpMetadata?:Record<string,unknown>};
const columns={context:['id','release_id','rules_hash','data_revision','authority_revision'],persons:['id','body'],sessions:['id','person_id','version','updated_at'],artifacts:['id','document_code','kind','body'],revisions:['id','artifact_id','body'],relations:['id','body'],decisions:['id','revision_id','body'],circulations:['id','revision_id','body'],receipts:['id','circulation_id','person_id','kind','body'],events:['id','artifact_id','body'],assignments:['id','body'],releases:['id','object_key','body'],regulation_changes:['id','body'],mutation_requests:['actor_id','request_key','payload_hash','result','session_id','session_version','release_id','data_revision','authority_revision','rules_hash','created_at'],research_connection:['id','version','body'],research_schedules:['id','version','next_at','enabled','body'],research_jobs:['id','version','state','created_at','schedule_id','slot','body'],research_attempts:['id','job_id','state','expires_at','body'],research_outbox:['id','state','event_id','body'],research_results:['id','job_id','attempt_id','body'],research_proposals:['id','job_id','result_id','body'],research_adoptions:['id','artifact_id','revision_id','body'],research_subscriptions:['id','version','connection_id','expires_at','body']} as const;
type Table=keyof typeof columns;
const tables=Object.keys(columns) as Table[];
type Tables=Record<Table,Row[]>;
export interface MaintenanceSnapshot {version:1;target:MaintenanceTarget;createdAt:string;tables:Tables;schema:SchemaRow[];objects:StoredObject[];stateHash:string;hash:string}
export interface MaintenancePlan {version:1;operation:'reset-business'|'restore-release';target:MaintenanceTarget;baselineHash:string;beforeHash:string;createdAt:string;deleteRows:Record<Table,string[]>;replaceRows:Record<Table,Row[]>;deleteObjects:string[];preserveObjects:Array<{key:string;sha256:string}>;afterDatabaseHash:string;hash:string}
function check(condition:unknown,message:string):asserts condition {if(!condition)throw new Error(message)}
const body=(row:Row)=>JSON.parse(String(row.body));
const sorted=<T>(rows:T[])=>rows.sort((a,b)=>canonical(a).localeCompare(canonical(b)));
const digest=(value:unknown)=>sha256(canonical(value));
const databaseHash=(data:{tables:Tables;schema:SchemaRow[]})=>digest({tables:data.tables,schema:data.schema});
function targetMatches(a:MaintenanceTarget,b:MaintenanceTarget){check(canonical(a)===canonical(b),'Maintenance target mismatch')}
async function requiredTriggers(research:boolean,connector:boolean){const files=['0001_erp.sql',...(research?['0002_research.sql']:[]),...(connector?['0003_research_connector.sql']:[])];return (await Promise.all(files.map(name=>readFile(new URL(`../../worker/migrations/${name}`,import.meta.url),'utf8')))).flatMap(sql=>sql.split('-- statement-breakpoint').map(sql=>sql.trim()).filter(sql=>sql.startsWith('CREATE TRIGGER')))}
const normalizedSql=(sql:string)=>sql.replace(/\s+/g,' ').replace(/;$/,'').trim();
async function readDatabase(env:Env){
 const present=new Set((await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all<{name:string}>()).results.map(row=>row.name));
 const selected=tables.filter(table=>present.has(table));
 const queries=[...selected.map(table=>env.DB.prepare(`SELECT * FROM ${table}`)),env.DB.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name<>'d1_migrations' ORDER BY type,name")];
 const result=await env.DB.batch(queries);check(result.every(item=>item.success),'Database snapshot failed');
 const data=Object.fromEntries(selected.map((table,i)=>[table,sorted(result[i].results as Row[])])) as Tables,schema=sorted(result.at(-1)!.results as SchemaRow[]);
 check(data.context.length===1&&data.context[0].id===1,'Installed context required');
 check(schema.filter(row=>row.type==='table').every(row=>tables.includes(row.name as Table)),'Unknown application table; maintenance must be updated before proceeding');
 for(const sql of await requiredTriggers(present.has('research_connection'),present.has('research_subscriptions')))check(schema.some(row=>row.type==='trigger'&&normalizedSql(row.sql)===normalizedSql(sql)),`Required immutable/fence trigger missing or changed: ${sql.split(' ')[2]}`);
 return {tables:data,schema};
}
async function objectKeys(env:Env){let cursor:string|undefined;const keys:string[]=[];do{const page=await env.SOURCES.list({cursor});keys.push(...page.objects.map(object=>object.key));cursor=page.truncated?page.cursor:undefined}while(cursor);return keys.sort()}
export async function snapshotMaintenance(env:Env,target:MaintenanceTarget):Promise<MaintenanceSnapshot>{
 check(target.databaseId&&target.bucketName,'Explicit maintenance target required');
 const data=await readDatabase(env),keys=await objectKeys(env),objects:StoredObject[]=[];
 for(const key of keys){const object=await env.SOURCES.get(key);check(object,`Missing backup object: ${key}`);const bytes=Buffer.from(await object.arrayBuffer());objects.push({key,sha256:await sha256(bytes),bytes:bytes.toString('base64'),customMetadata:object.customMetadata??{},httpMetadata:JSON.parse(JSON.stringify(object.httpMetadata??{}))})}
 check(await databaseHash(data)===await databaseHash(await readDatabase(env))&&canonical(keys)===canonical(await objectKeys(env)),'State changed during snapshot; stop application writes and retry');
 const stateHash=await digest({...data,objects}),snapshot={version:1 as const,target,createdAt:new Date().toISOString(),...data,objects,stateHash};return {...snapshot,hash:await digest(snapshot)};
}
export async function verifySnapshot(snapshot:MaintenanceSnapshot){
 const {hash,...unsigned}=snapshot;check(snapshot.version===1&&hash===await digest(unsigned),'Backup snapshot hash mismatch');
 check(snapshot.stateHash===await digest({tables:snapshot.tables,schema:snapshot.schema,objects:snapshot.objects}),'Backup state hash mismatch');
 for(const object of snapshot.objects)check(await sha256(Buffer.from(object.bytes,'base64'))===object.sha256,`Backup object hash mismatch: ${object.key}`);
}
function references(value:unknown):any[]{if(!value||typeof value!=='object')return [];if(Array.isArray(value))return value.flatMap(references);return Object.entries(value).flatMap(([key,item])=>key==='evidenceRefs'&&Array.isArray(item)?item:references(item))}
function jsonPointer(value:any,prefix:string):{key:string;sha256:string}|undefined {if(!value?.__r2Json)return;const pointer=value.__r2Json;check(typeof pointer.sha256==='string'&&/^[a-f0-9]{64}$/.test(pointer.sha256)&&pointer.key===`${prefix}/${pointer.sha256}.json`,'Invalid stored JSON object pointer');return pointer}
async function preservation(current:MaintenanceSnapshot,baseline:MaintenanceSnapshot){
 const artifacts=new Map(current.tables.artifacts.map(row=>[String(row.id),row])),revisions=new Map(current.tables.revisions.map(row=>[String(row.id),row])),objects=new Map(current.objects.map(object=>[object.key,object]));
 const keepArtifacts=new Set<string>(),keepRevisions=new Set<string>(),keepObjects=new Map<string,string>(),sourceRevisions=new Map<string,{sha256:string;markdown:string}>();
 const keepObject=(key:string,hash:string)=>{const object=objects.get(key);check(object&&object.sha256===hash,`Preserved source object missing or changed: ${key}`);keepObjects.set(key,hash);return object};
 const changes=current.tables.regulation_changes.map(row=>{const change=body(row),pointer=jsonPointer(change.diff,'regulation-diffs');if(!pointer)return change;const object=keepObject(pointer.key,pointer.sha256);return {...change,diff:JSON.parse(Buffer.from(object.bytes,'base64').toString('utf8'))}});
 for(const row of current.tables.releases){
  const object=objects.get(String(row.object_key));check(object,`Release object missing: ${row.id}`);const bundle=JSON.parse(Buffer.from(object.bytes,'base64').toString('utf8')) as KnowledgeBundle,manifest=body(row),copy=structuredClone(bundle);copy.manifest.manifestHash='';
  check(bundle.manifest.releaseId===row.id&&manifest.manifestHash===bundle.manifest.manifestHash&&await digest(copy)===manifest.manifestHash,`Release hash changed: ${row.id}`);keepObjects.set(object.key,object.sha256);
  keepObject(`definitions/rules/${bundle.manifest.rulesHash}`,bundle.manifest.rulesHash);keepObject(`definitions/schema/${bundle.manifest.schemaHash}`,bundle.manifest.schemaHash);
  for(const source of bundle.sources){keepObject(`sources/${source.revisionId}/${source.sha256}.md`,source.sha256);sourceRevisions.set(source.revisionId,{sha256:source.sha256,markdown:source.markdown});if(source.kind!=='index'){check(revisions.has(source.revisionId),`Release source revision missing: ${source.revisionId}`);keepArtifacts.add(source.artifactId)}}
 }
 for(const row of current.tables.artifacts)if(row.kind!=='record')keepArtifacts.add(String(row.id));
 const roots=[...baseline.tables.persons,...baseline.tables.assignments].map(body),refs=roots.flatMap(references),evidence=new Map(refs.map(ref=>[canonical(ref),ref]));
 for(const assignment of baseline.tables.assignments.map(body)){
  check(revisions.has(assignment.approvedRevisionId),`Assignment provenance missing: ${assignment.approvedRevisionId}`);keepRevisions.add(assignment.approvedRevisionId);
  if(assignment.approvalDecisionId){const decision=current.tables.decisions.find(row=>row.id===assignment.approvalDecisionId);check(decision&&body(decision).decision==='approve'&&body(decision).revisionId===assignment.approvedRevisionId&&body(decision).sourceSha256===body(revisions.get(assignment.approvedRevisionId)!).sourceSha256,'Assignment approval provenance missing')}
  for(const id of [assignment.delegatedFromAssignmentId,assignment.replacesAssignmentId])if(id)check(baseline.tables.assignments.some(row=>row.id===id),'Assignment chain provenance missing');
 }
 for(const ref of refs)keepRevisions.add(ref.revisionId);
 const configurations=new Set(baseline.tables.revisions.map(body).map(revision=>revision.fictionalDesignation?.configurationId).filter(Boolean));
 for(const row of current.tables.revisions){const revision=body(row);if(configurations.has(revision.fictionalDesignation?.configurationId))keepArtifacts.add(revision.artifactId)}
 let expanded=true;while(expanded){const size=keepArtifacts.size+keepRevisions.size;
  for(const id of keepRevisions){const row=revisions.get(id);if(!row&&sourceRevisions.has(id)){keepRevisions.delete(id);continue}check(row,`Missing provenance revision: ${id}`);keepArtifacts.add(String(row.artifact_id))}
  for(const row of current.tables.revisions)if(keepArtifacts.has(String(row.artifact_id))){const revision=body(row);keepRevisions.add(String(row.id));for(const id of [revision.previousRevisionId,...(revision.templateRevisionIds??[]),...references(revision).map(ref=>ref.revisionId)])if(id&&(!sourceRevisions.has(id)||revisions.has(id)))keepRevisions.add(id)}
  const retainedEvents=current.tables.events.filter(row=>row.artifact_id===null||keepArtifacts.has(String(row.artifact_id))).map(body),retainedDecisions=current.tables.decisions.filter(row=>keepRevisions.has(String(row.revision_id))||body(row).changeId&&current.tables.regulation_changes.some(change=>change.id===body(row).changeId)).map(body);
  for(const item of [...retainedEvents,...retainedDecisions,...changes,...[...keepRevisions].filter(id=>revisions.has(id)).map(id=>body(revisions.get(id)!))]){
   for(const ref of references(item)){evidence.set(canonical(ref),ref);if(!sourceRevisions.has(ref.revisionId)||revisions.has(ref.revisionId))keepRevisions.add(ref.revisionId)}
   if(item.revisionId&&revisions.has(item.revisionId))keepRevisions.add(item.revisionId);
   if(item.decisionId){const decision=current.tables.decisions.find(row=>row.id===item.decisionId);check(decision,'Event decision provenance missing');if(revisions.has(String(decision.revision_id)))keepRevisions.add(String(decision.revision_id))}
  }
  expanded=size!==keepArtifacts.size+keepRevisions.size;
 }
 for(const id of keepArtifacts)check(artifacts.has(id),`Provenance artifact missing: ${id}`);
 for(const id of keepRevisions){const revision=body(revisions.get(id)!);const source=keepObject(revision.objectKey,revision.sourceSha256);keepObject(revision.textKey,revision.textSha256);sourceRevisions.set(id,{sha256:revision.sourceSha256,markdown:Buffer.from(source.bytes,'base64').toString('utf8').replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n')})}
 for(const ref of evidence.values()){const source=sourceRevisions.get(ref.revisionId);check(source&&source.sha256===ref.sourceSha256&&Number.isInteger(ref.lineStart)&&ref.lineStart>0&&Number.isInteger(ref.lineEnd)&&ref.lineEnd>=ref.lineStart&&source.markdown.split('\n').slice(ref.lineStart-1,ref.lineEnd).join('\n')===ref.quote,`Invalid provenance quote: ${ref.revisionId}`)}
 return {keepArtifacts,keepRevisions,keepObjects};
}
function restoredRegulations(current:MaintenanceSnapshot,baseline:MaintenanceSnapshot){
 const artifacts=new Map(baseline.tables.artifacts.filter(row=>row.kind!=='record').map(row=>[String(row.id),row])),revisions=new Map(baseline.tables.revisions.map(row=>[String(row.id),row]));
 return {artifacts:current.tables.artifacts.filter(row=>row.kind!=='record').map(row=>artifacts.get(String(row.id))??{...row,body:JSON.stringify({...body(row),effectiveRevisionId:null})}),revisions:current.tables.revisions.filter(row=>current.tables.artifacts.some(artifact=>artifact.id===row.artifact_id&&artifact.kind!=='record')).map(row=>revisions.get(String(row.id))??{...row,body:JSON.stringify({...body(row),state:'withdrawn'})})};
}
/** `snapshot` lets a caller reuse a state it has just read (the pre-apply backup) instead of reading every R2 object again. */
export async function planMaintenance(env:Env,target:MaintenanceTarget,baseline:MaintenanceSnapshot,operation:MaintenancePlan['operation'],snapshot?:MaintenanceSnapshot):Promise<MaintenancePlan>{
 check(operation==='reset-business'||operation==='restore-release','Unknown maintenance operation');targetMatches(target,baseline.target);await verifySnapshot(baseline);
 if(snapshot){targetMatches(target,snapshot.target);await verifySnapshot(snapshot)}
 const current=snapshot??await snapshotMaintenance(env,target);
 check(!tables.some(table=>table.startsWith('research_')&&table!=='research_connection'&&current.tables[table]?.length),'Existing research work requires a dedicated retention plan before business maintenance');
 const keep=await preservation(current,baseline),deleteRows=Object.fromEntries(tables.map(table=>[table,[] as string[]])) as Record<Table,string[]>,replaceRows=Object.fromEntries(tables.map(table=>[table,[] as Row[]])) as Record<Table,Row[]>;
 check(canonical(current.tables.persons.map(row=>row.id).sort())===canonical(baseline.tables.persons.map(row=>row.id).sort()),'Personnel membership changed; reconcile before reset');
 const staffing=(rows:Row[])=>sorted(rows.map(row=>{const {isAdmin:_admin,adminAssignmentId:_assignment,...person}=body(row);return person}));
 check(canonical(staffing(current.tables.persons))===canonical(staffing(baseline.tables.persons)),'Personnel configuration changed; reconcile staff changes before maintenance');
 // Restoring pointers under an open change would leave it rebuildable on withdrawn revisions.
 const baselineChanges=new Set(baseline.tables.regulation_changes.map(row=>canonical(row)));
 check(!current.tables.regulation_changes.some(row=>!['published','cancelled'].includes(body(row).state)&&!baselineChanges.has(canonical(row))),'Open regulation changes made after the baseline; cancel or publish them before maintenance');
 const restored=restoredRegulations(current,baseline);replaceRows.artifacts=restored.artifacts;replaceRows.revisions=restored.revisions;
 if(operation==='reset-business'){
  deleteRows.artifacts=current.tables.artifacts.filter(row=>!keep.keepArtifacts.has(String(row.id))).map(row=>String(row.id));deleteRows.revisions=current.tables.revisions.filter(row=>!keep.keepRevisions.has(String(row.id))).map(row=>String(row.id));
  const removed=new Set([...deleteRows.artifacts,...deleteRows.revisions]);
  deleteRows.relations=current.tables.relations.filter(row=>{const relation=body(row);return removed.has(relation.subjectId)||removed.has(relation.objectId)||references(relation).some(ref=>removed.has(ref.revisionId))}).map(row=>String(row.id));
  deleteRows.decisions=current.tables.decisions.filter(row=>removed.has(String(row.revision_id))&&!body(row).changeId).map(row=>String(row.id));
  deleteRows.circulations=current.tables.circulations.filter(row=>removed.has(String(row.revision_id))).map(row=>String(row.id));
  deleteRows.receipts=current.tables.receipts.filter(row=>deleteRows.circulations.includes(String(row.circulation_id))).map(row=>String(row.id));
  deleteRows.events=current.tables.events.filter(row=>row.artifact_id!==null&&removed.has(String(row.artifact_id))).map(row=>String(row.id));
  deleteRows.assignments=current.tables.assignments.map(row=>String(row.id));replaceRows.assignments=baseline.tables.assignments;replaceRows.persons=baseline.tables.persons;
  for(const row of baseline.tables.artifacts)if(row.kind==='record'&&keep.keepArtifacts.has(String(row.id)))replaceRows.artifacts.push(row);
  for(const row of baseline.tables.revisions)if(keep.keepRevisions.has(String(row.id))&&!replaceRows.revisions.some(other=>other.id===row.id))replaceRows.revisions.push(row);
 }
 deleteRows.sessions=current.tables.sessions.map(row=>String(row.id));
 // Replay rows have a compound key; the transaction clears the complete fenced table.
 deleteRows.mutation_requests=current.tables.mutation_requests.map(row=>`${row.actor_id}:${row.request_key}`);
 // Unchanged rows need no UPDATE; assignments are re-inserted after the full delete above.
 for(const table of tables.filter(table=>current.tables[table]))if(table!=='assignments'){const existing=new Map(current.tables[table].map(row=>[String(row.id),canonical(row)]));replaceRows[table]=replaceRows[table].filter(row=>existing.get(String(row.id))!==canonical(row))}
 const context=current.tables.context[0];replaceRows.context=[{...context,release_id:baseline.tables.context[0].release_id,rules_hash:baseline.tables.context[0].rules_hash,data_revision:Number(context.data_revision)+1,authority_revision:Number(context.authority_revision)+1}];
 const replayObjects=current.tables.mutation_requests.flatMap(row=>{const pointer=jsonPointer(JSON.parse(String(row.result)),'mutation-results');if(!pointer)return [];check(current.objects.some(object=>object.key===pointer.key&&object.sha256===pointer.sha256),'Replay object missing or changed');return [pointer.key]});
 const deleteObjects=[...new Set([...replayObjects,...current.tables.revisions.filter(row=>deleteRows.revisions.includes(String(row.id))).flatMap(row=>{const revision=body(row);return [revision.objectKey,revision.textKey]})])].filter(key=>!keep.keepObjects.has(key)).sort();
 const after=structuredClone(current.tables);for(const table of tables.filter(table=>current.tables[table])){after[table]=table==='mutation_requests'?[]:after[table].filter(row=>!deleteRows[table].includes(String(row.id)));for(const replacement of replaceRows[table]){after[table]=after[table].filter(row=>row.id!==replacement.id);after[table].push(replacement)}sorted(after[table])}
 const plan={version:1 as const,operation,target,baselineHash:baseline.hash,beforeHash:current.stateHash,createdAt:new Date().toISOString(),deleteRows,replaceRows,deleteObjects,preserveObjects:[...keep.keepObjects].map(([key,sha256])=>({key,sha256})).sort((a,b)=>a.key.localeCompare(b.key)),afterDatabaseHash:await databaseHash({tables:after,schema:current.schema})};return {...plan,hash:await digest(plan)};
}
function guards(env:Env,current:{tables:Tables;schema:SchemaRow[]}){
 const statements:D1PreparedStatement[]=[];
 const guard=(condition:string,params:unknown[])=>statements.push(env.DB.prepare(`INSERT INTO context SELECT * FROM context WHERE id=1 AND (${condition})`).bind(...params));
 // Every application write except session selection advances the context row; per-table counts catch other writers.
 // ponytail: count+context fence, not per-row content; add a row-hash column if non-app writers must be fenced exactly.
 const context=current.tables.context[0];guard(`NOT EXISTS(SELECT 1 FROM context WHERE ${columns.context.map(name=>`${name} IS ?`).join(' AND ')})`,columns.context.map(name=>context[name]));
 for(const table of tables.filter(table=>current.schema.some(row=>row.type==='table'&&row.name===table)))guard(`(SELECT COUNT(*) FROM ${table})<>?`,[current.tables[table].length]);
 guard("(SELECT COUNT(*) FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name<>'d1_migrations')<>?",[current.schema.length]);
 for(const row of current.schema)guard('NOT EXISTS(SELECT 1 FROM sqlite_master WHERE type=? AND name=? AND sql=?)',[row.type,row.name,row.sql]);return statements;
}
function insertRows(env:Env,table:Table,rows:Row[],replace=false){const names=columns[table],size=Math.floor(100/names.length),statements:D1PreparedStatement[]=[];for(let i=0;i<rows.length;i+=size){const batch=rows.slice(i,i+size);statements.push(env.DB.prepare(`INSERT ${replace?'OR REPLACE ':''}INTO ${table}(${names.join(',')}) VALUES ${batch.map(()=>`(${names.map(()=>'?').join(',')})`).join(',')}`).bind(...batch.flatMap(row=>names.map(name=>row[name]))))}return statements}
async function verifyPreservedObjects(env:Env,objects:Array<{key:string;sha256:string}>){for(const expected of objects){const object=await env.SOURCES.get(expected.key);check(object&&await sha256(new Uint8Array(await object.arrayBuffer()))===expected.sha256,`Preserved object changed: ${expected.key}`)}}
export async function applyMaintenance(env:Env,target:MaintenanceTarget,baseline:MaintenanceSnapshot,plan:MaintenancePlan,snapshot?:MaintenanceSnapshot){
 targetMatches(target,plan.target);targetMatches(target,baseline.target);await verifySnapshot(baseline);const {hash,...unsigned}=plan;check(hash===await digest(unsigned)&&plan.baselineHash===baseline.hash,'Maintenance plan hash mismatch');
 const markerId=`maintenance:${hash}`,marker=await env.DB.prepare('SELECT body FROM events WHERE id=?').bind(markerId).first<{body:string}>(),alreadyApplied=!!marker;
 if(marker&&!(await Promise.all(plan.deleteObjects.map(key=>env.SOURCES.head(key)))).some(Boolean)){await readDatabase(env);await verifyPreservedObjects(env,plan.preserveObjects);return {planHash:hash,alreadyApplied:true,pendingObjects:[] as string[],committed:true}}
 if(marker){const data=await readDatabase(env);data.tables.events=data.tables.events.filter(row=>row.id!==markerId);check(await databaseHash(data)===plan.afterDatabaseHash,'State changed after maintenance commit; refuse stale R2 retry')}
 else{
  // A reused snapshot is still fenced: its hash must equal the plan's, and the batch guards recheck the live context and counts.
  const current=snapshot??await snapshotMaintenance(env,target);check(current.stateHash===plan.beforeHash,'Stale maintenance plan: state changed');
  const recomputed=await planMaintenance(env,target,baseline,plan.operation,current);check(canonical(recomputed.deleteRows)===canonical(plan.deleteRows)&&canonical(recomputed.replaceRows)===canonical(plan.replaceRows)&&canonical(recomputed.deleteObjects)===canonical(plan.deleteObjects)&&recomputed.afterDatabaseHash===plan.afterDatabaseHash,'Maintenance plan content changed');
  await verifyPreservedObjects(env,plan.preserveObjects);const statements=guards(env,current),immutable=current.schema.filter(row=>row.type==='trigger'&&/_immutable_(update|delete)$/.test(row.name));
  for(const trigger of immutable)statements.push(env.DB.prepare(`DROP TRIGGER ${trigger.name}`));
  for(const table of [...tables].reverse())if(table==='mutation_requests'||table==='sessions')statements.push(env.DB.prepare(`DELETE FROM ${table}`));else for(let i=0;i<plan.deleteRows[table].length;i+=100){const ids=plan.deleteRows[table].slice(i,i+100);statements.push(env.DB.prepare(`DELETE FROM ${table} WHERE id IN (${ids.map(()=>'?').join(',')})`).bind(...ids))}
  for(const table of tables)for(const row of plan.replaceRows[table]){if(table==='assignments')statements.push(...insertRows(env,table,[row]));else{const names=columns[table].filter(name=>name!=='id');statements.push(env.DB.prepare(`UPDATE ${table} SET ${names.map(name=>`${name}=?`).join(',')} WHERE id=?`).bind(...names.map(name=>row[name]),row.id))}}
  const event={id:markerId,artifactId:null,kind:plan.operation==='restore-release'?'release_restored':'business_reset',at:plan.createdAt,planHash:hash,baselineHash:baseline.hash,target,context:plan.replaceRows.context[0]};statements.push(env.DB.prepare('INSERT INTO events VALUES(?,?,?)').bind(markerId,null,JSON.stringify(event)));
  for(const trigger of immutable)statements.push(env.DB.prepare(trigger.sql));check(statements.length<1000,'Maintenance exceeds single-transaction D1 query budget');
  const results=await env.DB.batch(statements);check(results.every(result=>result.success),'Maintenance transaction failed');
 }
 const committed=await readDatabase(env);committed.tables.events=committed.tables.events.filter(row=>row.id!==markerId);check(await databaseHash(committed)===plan.afterDatabaseHash,'Committed maintenance rows differ from the plan; R2 deletion stopped');
 const pendingObjects:string[]=[];await verifyPreservedObjects(env,plan.preserveObjects);
 for(const key of plan.deleteObjects)try{if(await env.SOURCES.head(key))await env.SOURCES.delete(key);check(!await env.SOURCES.head(key),'R2 deletion incomplete')}catch{pendingObjects.push(key)}
 await readDatabase(env);await verifyPreservedObjects(env,plan.preserveObjects);return {planHash:hash,alreadyApplied,pendingObjects,committed:true};
}
export async function restoreMaintenanceBackup(env:Env,target:MaintenanceTarget,backup:MaintenanceSnapshot,expectedCurrentHash:string){
 check(target.environment==='test'||['local','staging'].includes(target.environment)&&target.clone===true,'Exact backup restore is clone-only; live recovery must invalidate sessions and advance generations');targetMatches(target,backup.target);await verifySnapshot(backup);
 const current=await snapshotMaintenance(env,target);check(current.stateHash===expectedCurrentHash,'Stale backup restore fence');check(canonical(current.schema.filter(row=>row.type!=='trigger'))===canonical(backup.schema.filter(row=>row.type!=='trigger')),'Backup schema mismatch');
 // Write the old bytes first; D1 cannot point to missing originals after the atomic restore.
 for(const object of backup.objects){const metadata:any={customMetadata:object.customMetadata,httpMetadata:{...object.httpMetadata}};if(metadata.httpMetadata.cacheExpiry)metadata.httpMetadata.cacheExpiry=new Date(metadata.httpMetadata.cacheExpiry);await env.SOURCES.put(object.key,Buffer.from(object.bytes,'base64'),metadata)}
 const statements=guards(env,current);for(const row of current.schema.filter(row=>row.type==='trigger')){check(/^[A-Za-z_][A-Za-z0-9_]*$/.test(row.name),'Invalid trigger identifier');statements.push(env.DB.prepare(`DROP TRIGGER ${row.name}`))}
 for(const table of [...tables].reverse().filter(table=>current.schema.some(row=>row.type==='table'&&row.name===table)))statements.push(env.DB.prepare(`DELETE FROM ${table}`));for(const table of tables)statements.push(...insertRows(env,table,backup.tables[table]??[]));for(const row of backup.schema.filter(row=>row.type==='trigger'))statements.push(env.DB.prepare(row.sql));
 const results=await env.DB.batch(statements);check(results.every(result=>result.success),'Backup restore transaction failed');
 for(const key of await objectKeys(env))if(!backup.objects.some(object=>object.key===key))await env.SOURCES.delete(key);
 const restored=await snapshotMaintenance(env,target);check(restored.stateHash===backup.stateHash,'Restored backup does not match original D1 rows and R2 bytes');return {restored:true,stateHash:restored.stateHash};
}
export function backupSql(snapshot:MaintenanceSnapshot){
 const literal=(value:string|number|null)=>value===null?'NULL':typeof value==='number'?String(value):`CAST(X'${Buffer.from(value).toString('hex')}' AS TEXT)`;
 return ['PRAGMA foreign_keys=ON;',...snapshot.schema.filter(row=>row.type==='table').map(row=>`${row.sql};`),...tables.flatMap(table=>(snapshot.tables[table]??[]).map(row=>`INSERT INTO ${table}(${columns[table].join(',')}) VALUES(${columns[table].map(name=>literal(row[name])).join(',')});`)),...snapshot.schema.filter(row=>row.type!=='table').map(row=>`${row.sql};`)].join('\n')+'\n';
}
