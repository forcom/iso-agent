import {afterEach,expect,it} from 'vitest';
import app from '../../worker/src/index';
import {createTestEnvironment,type TestEnvironment} from '../support/environment';
import {get,getKnowledgeContext} from '../../worker/src/lib/storage';
import {canonical,sha256} from '../../packages/knowledge/src/index';
import {requiredDecisions} from '../../worker/src/lib/conditions';
import type {Revision} from '../../worker/src/types';
let env:TestEnvironment;afterEach(async()=>env?.cleanup());
async function headers(id:string){const actor=await env.select(id);return {cookie:`iso_session=${actor.sessionId}`,'X-Session-Version':'1'}}
async function mutate(path:string,body:any,id='author') {return app.request(path,{method:'POST',headers:{...await headers(id),'Content-Type':'application/json'},body:JSON.stringify({requestKey:crypto.randomUUID(),expectedContext:await getKnowledgeContext(env.bindings),...body})},env.bindings)}
async function saveBundle(){env.bundle.manifest.manifestHash='';env.bundle.manifest.manifestHash=await sha256(canonical(env.bundle));await env.bindings.SOURCES.put('releases/test-release.json',JSON.stringify(env.bundle));await env.bindings.DB.prepare('UPDATE releases SET body=? WHERE id=?').bind(JSON.stringify(env.bundle.manifest),env.bundle.manifest.releaseId).run()}
async function upload(types=['test-F01','test-F02']){
 const form=new FormData();form.set('file',new File(['# Synthetic combined record\nSection one\nSection two\nThe optional activity does not apply.'],'record.md'));form.set('documentCode','COMBINED-RECORD');form.set('title','Synthetic combined record');form.set('recordTypeIds',JSON.stringify(types));form.set('templateRevisionIds',JSON.stringify(types.map(id=>id==='test-F01'?'test-tpl-rev-1':'test-tpl-rev-2')));form.set('fieldMappings',JSON.stringify({'test-F01':'Section one','test-F02':'Section two'}));form.set('requestKey',crypto.randomUUID());form.set('expectedContext',JSON.stringify(await getKnowledgeContext(env.bindings)));
 const response=await app.request('/api/records',{method:'POST',headers:await headers('author'),body:form},env.bindings);expect(response.status).toBe(201);return await response.json() as {artifactId:string;revisionId:string};
}
async function state(id:string){return (await get<Revision>(env.bindings,'revisions',id)).state}
it('mixed types accumulate separate reviewers and exempt types never require invented approval',async()=>{
 env=await createTestEnvironment();env.bundle.recordTypes[1].approvalRequired=false;env.bundle.policies=env.bundle.policies.filter(p=>p.resourceTypeId!=='test-F02'||!['approve','reject'].includes(p.action));env.bundle.policies.find(p=>p.id==='test-F02-review')!.roleId='director';await saveBundle();
 const r=await upload();expect((await mutate(`/api/records/${r.artifactId}/submit`,{revisionId:r.revisionId})).status).toBe(200);
 expect((await mutate(`/api/revisions/${r.revisionId}/decisions`,{decision:'review'},'reviewer')).status).toBe(200);expect(await state(r.revisionId)).toBe('in_review');
 const actions=await app.request(`/api/records/${r.artifactId}/actions`,{headers:await headers('director')},env.bindings);expect((await actions.json() as any).actions.find((a:any)=>a.action==='review').allowed).toBe(true);
 expect((await mutate(`/api/revisions/${r.revisionId}/decisions`,{decision:'review'},'director')).status).toBe(200);expect(await state(r.revisionId)).toBe('reviewed');
 expect((await mutate(`/api/revisions/${r.revisionId}/decisions`,{decision:'approve'},'approver')).status).toBe(200);expect(await state(r.revisionId)).toBe('approved');
});
it('separate type approvers accumulate before the combined revision becomes effective',async()=>{
 env=await createTestEnvironment();const r=await upload();await mutate(`/api/records/${r.artifactId}/submit`,{revisionId:r.revisionId});await mutate(`/api/revisions/${r.revisionId}/decisions`,{decision:'review'},'reviewer');
 expect((await mutate(`/api/revisions/${r.revisionId}/decisions`,{decision:'approve'},'approver')).status).toBe(200);expect(await state(r.revisionId)).toBe('reviewed');
 expect((await mutate(`/api/revisions/${r.revisionId}/decisions`,{decision:'approve'},'director')).status).toBe(200);expect(await state(r.revisionId)).toBe('approved');
});
it('rejected and resubmitted revision cannot inherit reviews from the prior submission',async()=>{
 env=await createTestEnvironment();env.bundle.recordTypes[0].requiredReviewRoleIds=['reviewer','director'];env.bundle.policies.push({...env.bundle.policies.find(p=>p.id==='test-F01-review')!,id:'test-F01-review-director',roleId:'director'});await saveBundle();
 const r=await upload(['test-F01']);await mutate(`/api/records/${r.artifactId}/submit`,{revisionId:r.revisionId});await mutate(`/api/revisions/${r.revisionId}/decisions`,{decision:'review'},'reviewer');
 expect((await mutate(`/api/revisions/${r.revisionId}/decisions`,{decision:'reject'},'approver')).status).toBe(200);expect((await mutate(`/api/records/${r.artifactId}/submit`,{revisionId:r.revisionId})).status).toBe(200);
 expect((await mutate(`/api/revisions/${r.revisionId}/decisions`,{decision:'review'},'director')).status).toBe(200);expect(await state(r.revisionId)).toBe('in_review');
 await mutate(`/api/revisions/${r.revisionId}/decisions`,{decision:'review'},'reviewer');expect(await state(r.revisionId)).toBe('reviewed');
});
it('stale authority can resubmit the current file and starts a new review epoch',async()=>{
 env=await createTestEnvironment();const r=await upload(['test-F01']);await mutate(`/api/records/${r.artifactId}/submit`,{revisionId:r.revisionId});await mutate(`/api/revisions/${r.revisionId}/decisions`,{decision:'review'},'reviewer');
 await env.bindings.DB.prepare('UPDATE context SET authority_revision=authority_revision+1').run();
 expect((await mutate(`/api/revisions/${r.revisionId}/decisions`,{decision:'approve'},'approver')).status).toBe(409);
 expect((await mutate(`/api/records/${r.artifactId}/submit`,{revisionId:r.revisionId})).status).toBe(200);expect(await state(r.revisionId)).toBe('in_review');
});
it('checks conditional stages for every type and registers confirmed non-applicability without approval',async()=>{
 env=await createTestEnvironment();const condition={field:'optionalActivity',equals:true,reason:'Synthetic optional activity',evidenceRefs:env.bundle.recordTypes[0].evidenceRefs};
 env.bundle.recordTypes[1].approvalCondition=condition;
 expect(()=>requiredDecisions(env.bundle.recordTypes,{},true)).toThrow(/조건/);
 env.bundle.recordTypes[0].applicabilityCondition=condition;await saveBundle();const r=await upload(['test-F01']);
 expect((await mutate(`/api/records/${r.artifactId}/submit`,{revisionId:r.revisionId})).status).toBe(200);expect(await state(r.revisionId)).toBe('in_review');
 const confirmation=await mutate(`/api/records/${r.artifactId}/conditions`,{revisionId:r.revisionId,confirmations:[{field:'optionalActivity',value:false,lineStart:4,lineEnd:4,quote:'The optional activity does not apply.',comment:'Synthetic source confirmation'}]},'reviewer');expect(confirmation.status).toBe(200);
 expect((await mutate(`/api/records/${r.artifactId}/submit`,{revisionId:r.revisionId})).status).toBe(200);expect(await state(r.revisionId)).toBe('registered');
 expect(await env.bindings.DB.prepare("SELECT COUNT(*) FROM decisions WHERE json_extract(body,'$.decision')='approve'").first('COUNT(*)')).toBe(0);
});
it('condition confirmation needs the affected type role and invalidates earlier pending reviews',async()=>{
 env=await createTestEnvironment();const secondReview=env.bundle.policies.find(p=>p.id==='test-F02-review')!;secondReview.roleId='director';
 secondReview.conditions=[{field:'secondScopeConfirmed',equals:true,reason:'Synthetic second-type scope',evidenceRefs:secondReview.evidenceRefs}];secondReview.scopeCondition.conditions={secondScopeConfirmed:true};await saveBundle();
 const r=await upload();await mutate(`/api/records/${r.artifactId}/submit`,{revisionId:r.revisionId});expect((await mutate(`/api/revisions/${r.revisionId}/decisions`,{decision:'review'},'reviewer')).status).toBe(200);
 const body={revisionId:r.revisionId,confirmations:[{field:'secondScopeConfirmed',value:true,lineStart:3,lineEnd:3,quote:'Section two',comment:'Synthetic scope confirmation'}]};
 expect((await mutate(`/api/records/${r.artifactId}/conditions`,body,'reviewer')).status).toBe(403);
 expect((await mutate(`/api/records/${r.artifactId}/conditions`,body,'director')).status).toBe(200);
 expect((await mutate(`/api/revisions/${r.revisionId}/decisions`,{decision:'review'},'director')).status).toBe(200);expect(await state(r.revisionId)).toBe('in_review');
 await mutate(`/api/revisions/${r.revisionId}/decisions`,{decision:'review'},'reviewer');expect(await state(r.revisionId)).toBe('reviewed');
});
