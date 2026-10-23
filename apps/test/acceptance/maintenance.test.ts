import {afterEach, describe, expect, it, vi} from 'vitest';
import app from '../../worker/src/index';
import {createTestEnvironment, type TestEnvironment} from '../support/environment';
import {getKnowledgeContext, get} from '../../worker/src/lib/storage';
import {revisionVersion} from '../../worker/src/lib/conditions';
import {sha256, buildRelease, canonical} from '../../packages/knowledge/src/index';
import {syntheticBundle} from '../support/fixtures';
import {KNOWLEDGE_SCHEMA} from '../../packages/ontology/src/index';
import {readFile} from 'node:fs/promises';
import * as maintenance from '../../seed/scripts/maintenance';
import * as rehearsal from './maintenance-rehearsal';

const target = {environment:'test' as const,databaseId:'iso-test-maintenance',bucketName:'iso-test-maintenance-sources',statePath:'output/test/maintenance'};
let test: TestEnvironment;
afterEach(async()=>{vi.restoreAllMocks();await test?.cleanup()});
async function environment() {
 const base=await syntheticBundle(),markdown='# Synthetic index\nSynthetic hierarchy source.\n',hash=await sha256(markdown);
 const source={artifactId:'synthetic-index',revisionId:'synthetic-index-rev',path:'synthetic/index.md',code:'SYNTHETIC-INDEX',title:'Synthetic index',kind:'index' as const,sha256:hash,textSha256:hash,markdown};
 const mappings=structuredClone(base.mappings);mappings.sources.push({sourceCode:source.code,sourceSha256:hash,revisionId:source.revisionId,reviewStatus:'validated',reviewedBy:'synthetic',reviewedAt:'2026-01-01',clauses:[]});
 const bundle=await buildRelease({sources:[...base.sources,source].map(({markdown,...s})=>({...s,bytes:new TextEncoder().encode(markdown)})),mappings,rules:await readFile(new URL('../../packages/ontology/rules.dl',import.meta.url)),schema:new TextEncoder().encode(canonical(KNOWLEDGE_SCHEMA)),schemaVersion:base.manifest.schemaVersion,sourceMode:'synthetic'});
 test=await createTestEnvironment(bundle);
 return test.bindings;
}
async function headers(personId:string){const actor=await test.select(personId);return {cookie:`iso_session=${actor.sessionId}`,'X-Session-Version':'1'}}
async function post(path:string,personId:string,body:any){
 const revisionId=path.match(/\/revisions\/([^/]+)\/decisions/)?.[1]??(path.endsWith('/submit')?body.revisionId:undefined);
 const expectedRevisionVersion=revisionId?await revisionVersion(await get(test.bindings,'revisions',revisionId)):undefined;
 const response=await app.request(path,{method:'POST',headers:{...await headers(personId),'Content-Type':'application/json'},body:JSON.stringify({requestKey:crypto.randomUUID(),expectedContext:await getKnowledgeContext(test.bindings),expectedRevisionVersion,...body})},test.bindings);
 expect(response.status,await response.clone().text()).toBeLessThan(300);return response.json() as Promise<any>;
}
async function business(){
 const form=new FormData();for(const [key,value] of Object.entries({documentCode:'SYNTHETIC-BUSINESS',title:'Synthetic business',recordTypeId:'test-F01',templateRevisionIds:'["test-tpl-rev-1"]',requestKey:crypto.randomUUID(),expectedContext:JSON.stringify(await getKnowledgeContext(test.bindings))}))form.set(key,value);
 form.set('file',new File(['# Synthetic business\nA test record.'],'record.md'));
 const response=await app.request('/api/records',{method:'POST',headers:await headers('author'),body:form},test.bindings);expect(response.status,await response.clone().text()).toBe(201);const result=await response.json() as any;
 await post(`/api/records/${result.artifactId}/submit`,'author',{revisionId:result.revisionId});
 await post(`/api/revisions/${result.revisionId}/decisions`,'reviewer',{decision:'review',comment:'Synthetic review'});
 await post(`/api/revisions/${result.revisionId}/decisions`,'approver',{decision:'approve',comment:'Synthetic approval'});
 const circulation=await post(`/api/revisions/${result.revisionId}/circulations`,'author',{recipientIds:['reader'],purpose:'Synthetic circulation'});
 await post(`/api/circulations/${circulation.circulationId}/receipts`,'reader',{revisionId:result.revisionId,kind:'received'});
 return result;
}
async function designation(){
 const env=test.bindings,markdown='# Synthetic designation\nSynthetic author appointed.\n',hash=await sha256(markdown);
 env.ALLOW_FICTIONAL_PERSONNEL='true';await env.DB.prepare("UPDATE persons SET body=json_set(body,'$.fictional',json('true')) WHERE id='author'").run();
 for(const name of ['assignment','personas','company']){
  const id=`synthetic-${name}`,revisionId=`${id}-rev`,objectKey=`sources/${revisionId}/${hash}.md`,textKey=`text/${revisionId}/${hash}.txt`;
  const artifact={id,documentCode:id,title:id,kind:'record',recordTypeIds:[],workingRevisionId:revisionId,effectiveRevisionId:revisionId,systemIds:[]};
  const revision={id:revisionId,artifactId:id,filename:'source.md',sourceSha256:hash,textSha256:hash,objectKey,textKey,state:'registered',createdAt:'2026-01-01',createdBy:'synthetic',previousRevisionId:null,templateRevisionIds:[],systemIds:[],conditions:{},fieldMappings:{},evidenceStatus:'verified',fictionalDesignation:{configurationId:'synthetic-configuration',sourceSha256:hash,authorizationReference:'https://github.com/example/synthetic/issues/1'}};
  await env.DB.batch([env.DB.prepare('INSERT INTO artifacts VALUES(?,?,?,?)').bind(id,id,'record',JSON.stringify(artifact)),env.DB.prepare('INSERT INTO revisions VALUES(?,?,?)').bind(revisionId,id,JSON.stringify(revision))]);await env.SOURCES.put(objectKey,markdown);await env.SOURCES.put(textKey,markdown);
 }
 const assignment=await get<any>(env,'assignments','test-assignment-author');assignment.approvedRevisionId='synthetic-assignment-rev';assignment.basis='fictional_configuration';assignment.evidenceRefs=[{revisionId:'synthetic-assignment-rev',sourceSha256:hash,lineStart:2,lineEnd:2,quote:markdown.split('\n')[1]}];
 await env.DB.prepare('UPDATE assignments SET body=? WHERE id=?').bind(JSON.stringify(assignment),assignment.id).run();
}
describe('maintenance boundaries and recoverable D1/R2 changes',()=>{
 it('repairs missing index bytes only in an explicit clone using the verified installed source hash',async()=>{
  const env=await environment(),source=test.bundle.sources.find(source=>source.kind==='index')!,key=`sources/${source.revisionId}/${source.sha256}.md`;await env.SOURCES.delete(key);
  const clone={...target,clone:true};expect((await rehearsal.repairCloneIndexes(env,clone,false)).missing.map(item=>item.key)).toEqual([key]);expect(await env.SOURCES.get(key)).toBeNull();
  await expect(rehearsal.repairCloneIndexes(env,{...clone,environment:'demo'},true)).rejects.toThrow(/clone/i);
  expect((await rehearsal.repairCloneIndexes(env,clone,true)).repaired.map(item=>item.key)).toEqual([key]);expect(await (await env.SOURCES.get(key))!.text()).toBe(source.markdown);
  await env.SOURCES.put(key,'tampered');await expect(rehearsal.repairCloneIndexes(env,clone,true)).rejects.toThrow(/changed/i);
 });
 it('keeps designation record provenance and index bytes while resetting the full real business lifecycle',async()=>{
  const env=await environment();await designation();const baseline=await maintenance.snapshotMaintenance(env,target);const record=await business();
  const original=await get<any>(env,'assignments','test-assignment-author');await env.DB.prepare('UPDATE assignments SET body=? WHERE id=?').bind(JSON.stringify({...original,status:'revoked'}),original.id).run();
  await env.DB.prepare('INSERT INTO assignments VALUES(?,?)').bind('test-only-assignment',JSON.stringify({...original,id:'test-only-assignment',approvedRevisionId:record.revisionId})).run();
  const before=await getKnowledgeContext(env),plan=await maintenance.planMaintenance(env,target,baseline,'reset-business');
  expect(plan.deleteRows.artifacts).toEqual([record.artifactId]);expect(plan.deleteObjects).toHaveLength(2);
  const result=await maintenance.applyMaintenance(env,target,baseline,plan);expect(result.pendingObjects).toEqual([]);
  expect(await env.DB.prepare('SELECT COUNT(*) n FROM artifacts WHERE kind=\'record\'').first('n')).toBe(3);
  for(const table of ['decisions','circulations','receipts','sessions','mutation_requests'])expect(await env.DB.prepare(`SELECT COUNT(*) n FROM ${table}`).first('n')).toBe(0);
  expect(await get<any>(env,'assignments','test-assignment-author')).toEqual(original);
  expect(await env.DB.prepare('SELECT id FROM assignments WHERE id=\'test-only-assignment\'').first()).toBeNull();
  expect(await getKnowledgeContext(env)).toEqual({...before,dataRevision:before.dataRevision+1,authorityRevision:before.authorityRevision+1});
  const index=test.bundle.sources.find(source=>source.kind==='index')!;expect(await (await env.SOURCES.get(`sources/${index.revisionId}/${index.sha256}.md`))!.text()).toBe(index.markdown);
  await expect(env.DB.prepare('DELETE FROM events').run()).rejects.toThrow(/IMMUTABLE_EVENT/);
  const again=await maintenance.applyMaintenance(env,target,baseline,plan);expect(again.alreadyApplied).toBe(true);expect(await getKnowledgeContext(env)).toEqual({...before,dataRevision:before.dataRevision+1,authorityRevision:before.authorityRevision+1});
  await test.select('reader');expect((await maintenance.applyMaintenance(env,target,baseline,plan)).alreadyApplied).toBe(true);expect(await env.DB.prepare('SELECT COUNT(*) n FROM sessions').first('n')).toBe(1);
 });
 it('refuses missing index provenance, a changed plan, a wrong target, and changes that do not bump context',async()=>{
  const env=await environment(),baseline=await maintenance.snapshotMaintenance(env,target);await business();const plan=await maintenance.planMaintenance(env,target,baseline,'reset-business');
  await expect(maintenance.applyMaintenance(env,{...target,databaseId:'different'},baseline,plan)).rejects.toThrow(/target/i);
  await expect(maintenance.applyMaintenance(env,target,baseline,{...plan,deleteObjects:[]})).rejects.toThrow(/hash/i);
  const index=test.bundle.sources.find(source=>source.kind==='index')!,key=`sources/${index.revisionId}/${index.sha256}.md`;await env.SOURCES.delete(key);
  await expect(maintenance.planMaintenance(env,target,baseline,'reset-business')).rejects.toThrow(/source|object|provenance/i);await env.SOURCES.put(key,index.markdown);
  await env.DB.prepare('UPDATE persons SET body=json_set(body,\'$.name\',\'changed\') WHERE id=\'reader\'').run();
  await expect(maintenance.applyMaintenance(env,target,baseline,plan)).rejects.toThrow(/stale|changed/i);
 });
 it('refuses a new plan after staff name or active configuration changes',async()=>{
  const env=await environment(),baseline=await maintenance.snapshotMaintenance(env,target),person=await get<any>(env,'persons','reader');
  for(const change of [{name:'Changed staff name'},{active:false}]){await env.DB.prepare('UPDATE persons SET body=? WHERE id=?').bind(JSON.stringify({...person,...change}),'reader').run();await expect(maintenance.planMaintenance(env,target,baseline,'reset-business')).rejects.toThrow(/personnel|staff/i)}
 });
 it('retains evidence referenced by a preserved publication event',async()=>{
  const env=await environment(),baseline=await maintenance.snapshotMaintenance(env,target),record=await business(),revision=await get<any>(env,'revisions',record.revisionId);
  await env.DB.prepare('INSERT INTO events VALUES(?,?,?)').bind('synthetic-publication',null,JSON.stringify({id:'synthetic-publication',kind:'release_published',evidenceRefs:[{revisionId:record.revisionId,sourceSha256:revision.sourceSha256,lineStart:1,lineEnd:1,quote:'# Synthetic business'}]})).run();
  const plan=await maintenance.planMaintenance(env,target,baseline,'reset-business');expect(plan.deleteRows.artifacts).not.toContain(record.artifactId);await maintenance.applyMaintenance(env,target,baseline,plan);expect(await env.SOURCES.get(revision.objectKey)).not.toBeNull();
 });
 it('keeps hash-checked large regulation diffs and their evidence but deletes only referenced replay objects',async()=>{
  const env=await environment(),baseline=await maintenance.snapshotMaintenance(env,target),record=await business(),revision=await get<any>(env,'revisions',record.revisionId);
  const diff=JSON.stringify({assignments:[{evidenceRefs:[{revisionId:record.revisionId,sourceSha256:revision.sourceSha256,lineStart:1,lineEnd:1,quote:'# Synthetic business'}]}]}),diffHash=await sha256(diff),diffKey=`regulation-diffs/${diffHash}.json`;
  await env.SOURCES.put(diffKey,diff);await env.DB.prepare('INSERT INTO regulation_changes VALUES(?,?)').bind('synthetic-change',JSON.stringify({id:'synthetic-change',state:'published',diff:{__r2Json:{key:diffKey,sha256:diffHash}}})).run();
  const result='{"synthetic":"large replay result"}',resultHash=await sha256(result),resultKey=`mutation-results/${resultHash}.json`;await env.SOURCES.put(resultKey,result);await env.SOURCES.put('mutation-results/unreferenced-orphan.json','orphan');await env.DB.prepare('UPDATE mutation_requests SET result=?').bind(JSON.stringify({__r2Json:{key:resultKey,sha256:resultHash}})).run();
  const plan=await maintenance.planMaintenance(env,target,baseline,'reset-business');expect(plan.deleteObjects).toEqual([resultKey]);expect(plan.deleteRows.artifacts).not.toContain(record.artifactId);expect(plan.preserveObjects).toContainEqual({key:diffKey,sha256:diffHash});
  await env.SOURCES.put(diffKey,'tampered');await expect(maintenance.applyMaintenance(env,target,baseline,plan)).rejects.toThrow(/changed|stale/i);await env.SOURCES.put(diffKey,diff);
  await maintenance.applyMaintenance(env,target,baseline,plan);expect(await env.SOURCES.get(resultKey)).toBeNull();expect(await env.SOURCES.get(diffKey)).not.toBeNull();expect(await env.SOURCES.get(revision.objectKey)).not.toBeNull();expect(await env.SOURCES.get('mutation-results/unreferenced-orphan.json')).not.toBeNull();
 });
 it('rolls back deleted rows and immutable trigger removal on a failing D1 batch',async()=>{
  const env=await environment(),baseline=await maintenance.snapshotMaintenance(env,target),record=await business();
  await env.DB.prepare("CREATE TRIGGER injected BEFORE DELETE ON revisions BEGIN SELECT RAISE(ABORT,'synthetic failure'); END").run();
  const plan=await maintenance.planMaintenance(env,target,baseline,'reset-business'),before=await maintenance.snapshotMaintenance(env,target);
  await expect(maintenance.applyMaintenance(env,target,baseline,plan)).rejects.toThrow(/synthetic failure/);
  expect((await maintenance.snapshotMaintenance(env,target)).stateHash).toBe(before.stateHash);expect(await env.DB.prepare('SELECT id FROM artifacts WHERE id=?').bind(record.artifactId).first()).not.toBeNull();
  await expect(env.DB.prepare('DELETE FROM decisions').run()).rejects.toThrow(/IMMUTABLE_EVENT/);
 });
 it('resumes failed R2 deletes after a fresh invocation without another D1 generation bump',async()=>{
  const env=await environment(),baseline=await maintenance.snapshotMaintenance(env,target);await business();const plan=await maintenance.planMaintenance(env,target,baseline,'reset-business');
  const bucket=env.SOURCES;let failed=true;env.SOURCES=new Proxy(bucket,{get(object,key){if(key==='delete')return async(value:string|string[])=>{if(failed){failed=false;throw new Error('synthetic R2 outage')}return bucket.delete(value)};const value=Reflect.get(object,key);return typeof value==='function'?value.bind(object):value}});
  const first=await maintenance.applyMaintenance(env,target,baseline,plan);expect(first.pendingObjects).toHaveLength(1);const context=await getKnowledgeContext(env);
  const second=await maintenance.applyMaintenance(env,target,baseline,JSON.parse(JSON.stringify(plan)));expect(second.pendingObjects).toEqual([]);expect(second.alreadyApplied).toBe(true);expect(await getKnowledgeContext(env)).toEqual(context);
 });
 it('restores actual backup bytes and all D1 rows in a clone, but refuses live backup restore',async()=>{
  const env=await environment(),baseline=await maintenance.snapshotMaintenance(env,target);await business();const backup=await maintenance.snapshotMaintenance(env,target),plan=await maintenance.planMaintenance(env,target,baseline,'reset-business');
  await maintenance.applyMaintenance(env,target,baseline,plan);const current=await maintenance.snapshotMaintenance(env,target);
  await expect(maintenance.restoreMaintenanceBackup(env,{...target,environment:'demo'},backup,current.stateHash)).rejects.toThrow(/clone|target/i);
  await maintenance.restoreMaintenanceBackup(env,target,backup,current.stateHash);expect((await maintenance.snapshotMaintenance(env,target)).stateHash).toBe(backup.stateHash);
  await expect(env.DB.prepare('DELETE FROM receipts').run()).rejects.toThrow(/IMMUTABLE_EVENT/);
 });
 it('restores the exact original release pointers and retains published trial history',async()=>{
  const env=await environment(),baseline=await maintenance.snapshotMaintenance(env,target),source=test.bundle.sources.find(s=>s.code==='TEST-PROC')!;
  const {changeId}=await post('/api/admin/regulation-changes','admin',{title:'Synthetic trial'}),path=`/api/admin/regulation-changes/${changeId}`;
  const form=new FormData();for(const [key,value] of Object.entries({artifactId:source.artifactId,documentCode:source.code,title:source.title,kind:'procedure',requestKey:crypto.randomUUID(),expectedContext:JSON.stringify(await getKnowledgeContext(env))}))form.set(key,value);form.set('file',new File([source.markdown+'\nSynthetic trial.\n'],'trial.md'));
  const upload=await app.request(`${path}/files`,{method:'POST',headers:await headers('admin'),body:form},env);expect(upload.status).toBe(201);
  const built=await post(`${path}/build`,'admin',{}),validated=await post(`${path}/decisions`,'admin',{decision:'validate_knowledge',candidateHash:built.change.candidateHash,comment:'Synthetic validation'});
  for(const [person,decision] of [['reviewer','review'],['director','approve']])await post(`${path}/decisions`,person,{decision,candidateHash:validated.change.candidateHash,comment:'Synthetic decision'});
  await post(`${path}/publish`,'director',{candidateHash:validated.change.candidateHash});const published=await getKnowledgeContext(env);expect(published.releaseId).not.toBe(baseline.tables.context[0].release_id);
  const plan=await maintenance.planMaintenance(env,target,baseline,'restore-release');await maintenance.applyMaintenance(env,target,baseline,plan);
  expect(await getKnowledgeContext(env)).toMatchObject({releaseId:baseline.tables.context[0].release_id,rulesHash:baseline.tables.context[0].rules_hash,dataRevision:published.dataRevision+1,authorityRevision:published.authorityRevision+1});
  expect(await get<any>(env,'artifacts',source.artifactId)).toMatchObject({workingRevisionId:source.revisionId,effectiveRevisionId:source.revisionId});
  expect((await env.DB.prepare('SELECT body FROM revisions WHERE artifact_id=? AND id<>?').bind(source.artifactId,source.revisionId).all<{body:string}>()).results.map(row=>JSON.parse(row.body).state)).toEqual(['withdrawn']);
  expect(await get<any>(env,'regulation_changes',changeId)).toMatchObject({state:'published'});expect(await env.DB.prepare('SELECT COUNT(*) n FROM releases').first('n')).toBeGreaterThan(1);
  expect(await env.DB.prepare("SELECT COUNT(*) n FROM events WHERE json_extract(body,'$.kind')='release_restored'").first('n')).toBe(1);
 });
});
