import {afterEach,expect,it} from 'vitest';
import app from '../../worker/src/index';
import {createTestEnvironment,type TestEnvironment} from '../support/environment';
import {canonical,sha256} from '../../packages/knowledge/src/index';
import {all,get,getKnowledgeContext,update} from '../../worker/src/lib/storage';
import {revisionVersion} from '../../worker/src/lib/conditions';
import type {Revision} from '../../worker/src/types';

let env:TestEnvironment;
afterEach(async()=>env?.cleanup());
const text='# Synthetic designated record\nThe designated reviewer must confirm this case.';
type RecordIds={artifactId:string;revisionId:string};
type Binding={recordTypeId:string;action:string;personId:string;roleId:string;documentCode:string;filename:string;sourceSha256:string;systemIds:string[]};
async function saveBundle(){
 env.bundle.manifest.manifestHash='';env.bundle.manifest.manifestHash=await sha256(canonical(env.bundle));
 await env.bindings.SOURCES.put('releases/test-release.json',JSON.stringify(env.bundle));
 await update(env.bindings,'releases',env.bundle.manifest.releaseId,env.bundle.manifest).run();
}
async function setup(){
 env=await createTestEnvironment();
 for(const policy of env.bundle.policies.filter(policy=>policy.resourceTypeId==='test-F01'&&['create','revise','review','approve'].includes(policy.action)))Object.assign(policy,{requiresRecordDesignation:true});
 for(const id of ['system-a','system-b'])env.bundle.entities.push({id,type:'AISystem',label:id,evidenceRefs:[]});
 await saveBundle();
 const sourceSha256=await sha256(text);
 return ['create','revise','review','approve'].map(action=>({recordTypeId:'test-F01',action,personId:action==='review'?'reviewer':action==='approve'?'approver':'author',roleId:action==='review'?'reviewer':action==='approve'?'approver':'author',documentCode:'DESIGNATED-CASE',filename:'case.md',sourceSha256,systemIds:['system-a']}));
}
async function registry(designations:Binding[],override?:unknown){
 const bytes=JSON.stringify(override??{version:1,designations}),digest=await sha256(bytes),key=`record-designations/${digest}.json`;
 await env.bindings.SOURCES.put(key,bytes);
 await update(env.bindings,'releases',env.bundle.manifest.releaseId,{...env.bundle.manifest,recordDesignationKey:key,recordDesignationSha256:digest}).run();
 return {key,digest};
}
async function headers(personId:string){const actor=await env.select(personId);return {cookie:`iso_session=${actor.sessionId}`,'X-Session-Version':'1'};}
async function upload(options:{person?:string;code?:string;filename?:string;bytes?:string;system?:string;record?:RecordIds}={}){
 const form=new FormData();form.set('file',new File([options.bytes??text],options.filename??'case.md'));
 form.set('documentCode',options.code??'DESIGNATED-CASE');form.set('title','Synthetic designated case');form.set('recordTypeIds',JSON.stringify(['test-F01']));form.set('templateRevisionIds',JSON.stringify(['test-tpl-rev-1']));form.set('scope',options.system??'system-a');
 form.set('requestKey',crypto.randomUUID());form.set('expectedContext',JSON.stringify(await getKnowledgeContext(env.bindings)));
 if(options.record)form.set('expectedRevisionId',options.record.revisionId);
 return app.request(options.record?`/api/records/${options.record.artifactId}/revisions`:'/api/records',{method:'POST',headers:await headers(options.person??'author'),body:form},env.bindings);
}
async function mutate(record:RecordIds,operation:string,personId:string,extra:object={}){
 const path=['submit','conditions'].includes(operation)?`/api/records/${record.artifactId}/${operation}`:`/api/revisions/${record.revisionId}/decisions`;
 return app.request(path,{method:'POST',headers:{...await headers(personId),'Content-Type':'application/json'},body:JSON.stringify({revisionId:record.revisionId,decision:operation,requestKey:crypto.randomUUID(),expectedContext:await getKnowledgeContext(env.bindings),expectedRevisionVersion:await revisionVersion(await get<Revision>(env.bindings,'revisions',record.revisionId)),...extra})},env.bindings);
}
async function grant(personId:string,roleId:string){
 const assignment=await get<any>(env.bindings,'assignments',`test-assignment-${roleId}`);
 await env.bindings.DB.prepare('INSERT INTO assignments VALUES(?,?)').bind(`case-${personId}-${roleId}`,JSON.stringify({...assignment,id:`case-${personId}-${roleId}`,personId})).run();
}

it('uses exact source designations for creation and decisions without turning them into role assignments',async()=>{
 const bindings=await setup();await registry(bindings);
 const created=await upload();expect(created.status).toBe(201);const record=await created.json() as RecordIds;
 expect((await mutate(record,'submit','author')).status).toBe(200);
 expect((await mutate(record,'review','reviewer')).status).toBe(200);
 expect((await mutate(record,'approve','approver')).status).toBe(200);
 expect((await get<Revision>(env.bindings,'revisions',record.revisionId)).state).toBe('approved');
 await env.bindings.DB.prepare("DELETE FROM assignments WHERE id='test-assignment-author'").run();
 expect((await upload({record})).status).toBe(403);
});

it.each(['missing-registry','missing-object','different-person','different-role','different-code','different-filename','different-source','different-system'])('denies designated creation with %s and writes no record',async(boundary)=>{
 const bindings=await setup();const options:Parameters<typeof upload>[0]={};
 if(boundary==='different-person'){await grant('reader','author');options.person='reader';}
 if(boundary==='different-role')bindings.find(binding=>binding.action==='create')!.roleId='director';
 if(boundary==='different-code')options.code='OTHER-CASE';
 if(boundary==='different-filename')options.filename='renamed.md';
 if(boundary==='different-source')options.bytes=`${text}\nChanged content.`;
 if(boundary==='different-system')options.system='system-b';
 if(boundary!=='missing-registry'){const ref=await registry(bindings);if(boundary==='missing-object')await env.bindings.SOURCES.delete(ref.key);}
 const context=await getKnowledgeContext(env.bindings),objects=(await env.bindings.SOURCES.list()).objects.map(object=>object.key);
 const response=await upload(options);expect(response.status).toBe(403);
 expect((await all<any>(env.bindings,'artifacts')).filter(artifact=>artifact.kind==='record')).toHaveLength(0);
 expect(await getKnowledgeContext(env.bindings)).toEqual(context);
 expect((await env.bindings.SOURCES.list()).objects.map(object=>object.key)).toEqual(objects);
});

it.each(['hash','schema','partial-reference'])('returns 503 for a corrupt designation %s without fallback authorization',async(boundary)=>{
 const bindings=await setup();const ref=await registry(bindings,boundary==='schema'?{version:1,designations:[{...bindings[0],sourceSha256:'not-a-sha'}]}:undefined);
 if(boundary==='hash')await env.bindings.SOURCES.put(ref.key,'{"version":1,"designations":[]}');
 if(boundary==='partial-reference')await update(env.bindings,'releases',env.bundle.manifest.releaseId,{...env.bundle.manifest,recordDesignationKey:ref.key}).run();
 const response=await upload();expect(response.status).toBe(503);expect(await response.json()).toMatchObject({error:{code:'RECORD_DESIGNATION_INVALID'}});
 expect((await all<any>(env.bindings,'artifacts')).filter(artifact=>artifact.kind==='record')).toHaveLength(0);
});

it.each(['bytes','filename','system'])('checks incoming revised %s and keeps the original revision unchanged when they lack a designation',async(boundary)=>{
 const bindings=await setup();await registry(bindings);const created=await upload();expect(created.status).toBe(201);const record=await created.json() as RecordIds;
 const before=await get<Revision>(env.bindings,'revisions',record.revisionId),context=await getKnowledgeContext(env.bindings);
 const options={record,...boundary==='bytes'?{bytes:`${text}\nA new fact.`}:boundary==='filename'?{filename:'new-name.md'}:{system:'system-b'}};
 expect((await upload(options)).status).toBe(403);
 expect(await getKnowledgeContext(env.bindings)).toEqual(context);expect(await get<Revision>(env.bindings,'revisions',record.revisionId)).toEqual(before);
 await registry([...bindings,{...bindings.find(binding=>binding.action==='revise')!,sourceSha256:await sha256(options.bytes??text),filename:options.filename??'case.md',systemIds:[options.system??'system-a']}]);
 const revised=await upload(options);expect(revised.status).toBe(201);
 expect((await revised.json() as RecordIds).revisionId).not.toBe(record.revisionId);
 expect(await get<Revision>(env.bindings,'revisions',record.revisionId)).toEqual(before);
});

it('rechecks a previously valid registry after its R2 bytes are replaced',async()=>{
 const bindings=await setup(),ref=await registry(bindings);
 const created=await upload();expect(created.status).toBe(201);const record=await created.json() as RecordIds;
 await env.bindings.SOURCES.put(ref.key,'{"version":1,"designations":[]}');
 const response=await upload({record});expect(response.status).toBe(503);
 expect(await response.json()).toMatchObject({error:{code:'RECORD_DESIGNATION_INVALID'}});
});

it('does not reuse another case reviewer designation for review or condition confirmation',async()=>{
 const bindings=await setup();
 const review=env.bundle.policies.find(policy=>policy.id==='test-F01-review')!;
 review.conditions=[{field:'scopeAcknowledged',equals:true,reason:'Synthetic case fact',evidenceRefs:review.evidenceRefs}];await saveBundle();
 await grant('director','reviewer');await registry(bindings);
 const created=await upload();expect(created.status).toBe(201);const record=await created.json() as RecordIds;
 const proof={confirmations:[{field:'scopeAcknowledged',value:true,lineStart:2,lineEnd:2,quote:text.split('\n')[1],comment:'Synthetic case fact'}]};
 expect((await mutate(record,'conditions','director',proof)).status).toBe(403);
 expect((await mutate(record,'conditions','reviewer',proof)).status).toBe(200);
 expect((await mutate(record,'submit','author')).status).toBe(200);
 expect((await mutate(record,'review','director')).status).toBe(403);
 expect((await mutate(record,'review','reviewer')).status).toBe(200);
 const decisions=await all<any>(env.bindings,'decisions');expect(decisions.filter(decision=>decision.decision==='review').map(decision=>decision.actorId)).toEqual(['reviewer']);
});
