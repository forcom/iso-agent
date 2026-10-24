import {afterEach,expect,it} from 'vitest';
import app from '../../worker/src/index';
import {createTestEnvironment,type TestEnvironment} from '../support/environment';
import {canonical,sha256,verifyBundle} from '../../packages/knowledge/src/index';
import {all,get,getBundle,getKnowledgeContext,update} from '../../worker/src/lib/storage';

let env:TestEnvironment;
afterEach(async()=>env?.cleanup());
const source='# Synthetic designated record\nExact source bound to the assigned author.\n';
async function headers(personId:string){const actor=await env.select(personId);return {cookie:`iso_session=${actor.sessionId}`,'X-Session-Version':'1'}}
async function post(path:string,person:string,input:object){return app.request(path,{method:'POST',headers:{...await headers(person),'Content-Type':'application/json'},body:JSON.stringify({requestKey:crypto.randomUUID(),expectedContext:await getKnowledgeContext(env.bindings),...input})},env.bindings)}
async function registry(designations:unknown[]){const bytes=JSON.stringify({version:1,designations}),digest=await sha256(bytes),key=`record-designations/${digest}.json`;await env.bindings.SOURCES.put(key,bytes);return {recordDesignationKey:key,recordDesignationSha256:digest,bytes}}
async function setup(){
 env=await createTestEnvironment();
 for(const policies of [env.bundle.policies,env.bundle.mappings.policies])for(const policy of policies.filter(policy=>policy.resourceTypeId==='test-F01'&&['create','revise'].includes(policy.action)))policy.requiresRecordDesignation=true;
 env.bundle.manifest.manifestHash='';env.bundle.manifest.manifestHash=await sha256(canonical(env.bundle));await env.bindings.SOURCES.put('releases/test-release.json',JSON.stringify(env.bundle));
 const ref=await registry(['create','revise'].map(action=>({recordTypeId:'test-F01',action,personId:'author',roleId:'author',documentCode:'DESIGNATED-CONTINUITY',filename:'record.md',sourceSha256:sourceHash,systemIds:[]})));
 await update(env.bindings,'releases',env.bundle.manifest.releaseId,{...env.bundle.manifest,recordDesignationKey:ref.recordDesignationKey,recordDesignationSha256:ref.recordDesignationSha256}).run();return ref;
}
const sourceHash=await sha256(source);
async function openChange(){
 const opened=await post('/api/admin/regulation-changes','admin',{title:'Synthetic registry continuity'});expect(opened.status).toBe(201);const {changeId}=await opened.json() as any,path=`/api/admin/regulation-changes/${changeId}`,original=env.bundle.sources.find(source=>source.code==='TEST-PROC')!;
 const form=new FormData();for(const [key,value] of Object.entries({artifactId:original.artifactId,documentCode:original.code,title:original.title,kind:'procedure',requestKey:crypto.randomUUID(),expectedContext:JSON.stringify(await getKnowledgeContext(env.bindings))}))form.set(key,value);form.set('file',new File([original.markdown+'\n<!-- Synthetic regulation revision. -->\n'],'regulation.md'));
 expect((await app.request(`${path}/files`,{method:'POST',headers:await headers('admin'),body:form},env.bindings)).status).toBe(201);return path;
}
async function build(path:string){const response=await post(`${path}/build`,'admin',{});expect(response.status,await response.clone().text()).toBe(200);return response.json() as Promise<any>}
async function validate(path:string,candidate:any){const response=await post(`${path}/decisions`,'admin',{decision:'validate_knowledge',candidateHash:candidate.change.candidateHash,comment:'Synthetic sources and mappings checked'});expect(response.status,await response.clone().text()).toBe(200);return response.json() as Promise<any>}
async function approve(path:string,candidate:any){for(const [person,decision] of [['reviewer','review'],['director','approve']])expect((await post(`${path}/decisions`,person,{decision,candidateHash:candidate.change.candidateHash,comment:'Synthetic exact candidate decision'})).status).toBe(200)}
async function record(previous?:{artifactId:string;revisionId:string},bytes=source){
 const form=new FormData();for(const [key,value] of Object.entries({documentCode:'DESIGNATED-CONTINUITY',title:'Synthetic designated record',recordTypeIds:JSON.stringify(['test-F01']),templateRevisionIds:JSON.stringify(['test-tpl-rev-1']),requestKey:crypto.randomUUID(),expectedContext:JSON.stringify(await getKnowledgeContext(env.bindings)),...(previous?{expectedRevisionId:previous.revisionId}:{})}))form.set(key,value);form.set('file',new File([bytes],'record.md'));
 return app.request(previous?`/api/records/${previous.artifactId}/revisions`:'/api/records',{method:'POST',headers:await headers('author'),body:form},env.bindings);
}

it('preserves exact designated authority through candidate build, validation and publication without embedding business data in knowledge',async()=>{
 const ref=await setup(),created=await record();expect(created.status).toBe(201);const original=await created.json() as any,oldRevision=await get(env.bindings,'revisions',original.revisionId),baseMetadata=await get(env.bindings,'releases',env.bundle.manifest.releaseId);
 const path=await openChange(),built=await build(path);
 for(const candidate of [built,await validate(path,built)]){
  const metadata=await get<any>(env.bindings,'releases',candidate.change.candidateReleaseId);expect(metadata).toMatchObject({recordDesignationKey:ref.recordDesignationKey,recordDesignationSha256:ref.recordDesignationSha256});
  expect(candidate.candidate.manifest).not.toHaveProperty('recordDesignationKey');expect(candidate.candidate).not.toHaveProperty('designations');const copy=structuredClone(candidate.candidate);copy.manifest.manifestHash='';expect(await sha256(canonical(copy))).toBe(candidate.change.candidateHash);if(candidate.candidate.manifest.reviewStatus==='validated')expect((await verifyBundle(candidate.candidate)).valid).toBe(true);
 }
 const candidate=(await (await app.request(path,{headers:await headers('reader')},env.bindings)).json()) as any;await approve(path,candidate);
 expect((await post(`${path}/publish`,'director',{candidateHash:candidate.change.candidateHash})).status).toBe(200);
 const published=await getBundle(env.bindings,await getKnowledgeContext(env.bindings));expect(published.manifest.manifestHash).toBe(candidate.change.candidateHash);
 expect((await record(original,source+'Changed fact.')).status).toBe(403);expect((await record(original)).status).toBe(201);
 expect(await get(env.bindings,'revisions',original.revisionId)).toEqual(oldRevision);expect(await get(env.bindings,'releases',env.bundle.manifest.releaseId)).toEqual(baseMetadata);expect(await (await env.bindings.SOURCES.get(ref.recordDesignationKey))!.text()).toBe(ref.bytes);
});

it('refuses to reuse the same candidate ID with conflicting registry metadata',async()=>{
 const ref=await setup(),path=await openChange(),built=await build(path),other=await registry([]),metadata=await get<any>(env.bindings,'releases',built.change.candidateReleaseId);
 await update(env.bindings,'releases',built.change.candidateReleaseId,{...metadata,recordDesignationKey:other.recordDesignationKey,recordDesignationSha256:other.recordDesignationSha256}).run();
 const before=await getKnowledgeContext(env.bindings),objects=(await env.bindings.SOURCES.list()).objects.map(object=>object.key),response=await post(`${path}/build`,'admin',{});
 expect(response.status).toBe(409);expect(await response.json()).toMatchObject({error:{code:'RECORD_DESIGNATION_CONFLICT'}});expect(await getKnowledgeContext(env.bindings)).toEqual(before);expect((await get<any>(env.bindings,'releases',built.change.candidateReleaseId)).recordDesignationSha256).toBe(other.recordDesignationSha256);expect((await env.bindings.SOURCES.list()).objects.map(object=>object.key)).toEqual(objects);expect(await (await env.bindings.SOURCES.get(ref.recordDesignationKey))!.text()).toBe(ref.bytes);
});

it('refuses publication when the validated candidate loses its designation reference',async()=>{
 await setup();const path=await openChange(),candidate=await validate(path,await build(path));await approve(path,candidate);
 await update(env.bindings,'releases',candidate.change.candidateReleaseId,candidate.candidate.manifest).run();const before=await getKnowledgeContext(env.bindings),events=await all(env.bindings,'events');
 const response=await post(`${path}/publish`,'director',{candidateHash:candidate.change.candidateHash});expect(response.status).toBe(409);expect(await response.json()).toMatchObject({error:{code:'RECORD_DESIGNATION_CONFLICT'}});expect(await getKnowledgeContext(env.bindings)).toEqual(before);expect(await all(env.bindings,'events')).toEqual(events);
});

it('does not build a new release from corrupt inherited registry bytes',async()=>{
 const ref=await setup(),path=await openChange();await env.bindings.SOURCES.put(ref.recordDesignationKey,'{"version":1,"designations":[]}');const before=await getKnowledgeContext(env.bindings),releases=await all(env.bindings,'releases');
 const response=await post(`${path}/build`,'admin',{});expect(response.status).toBe(503);expect(await response.json()).toMatchObject({error:{code:'RECORD_DESIGNATION_INVALID'}});expect(await getKnowledgeContext(env.bindings)).toEqual(before);expect(await all(env.bindings,'releases')).toEqual(releases);
});
