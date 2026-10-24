import {afterEach,expect,it} from 'vitest';
import app from '../../worker/src/index';
import {createTestEnvironment,type TestEnvironment} from '../support/environment';
import {get,getKnowledgeContext} from '../../worker/src/lib/storage';
import {canonical,sha256} from '../../packages/knowledge/src/index';
import {authorizeRecordAction,revisionVersion} from '../../worker/src/lib/conditions';
import type {Artifact,Revision} from '../../worker/src/types';
let env:TestEnvironment;
afterEach(async()=>env?.cleanup());
async function setup(){
 env=await createTestEnvironment();
 const type=env.bundle.recordTypes[0];type.recordApproval={label:'계획 승인',limitations:'실행·효과성 확인과 종결 승인은 포함하지 않습니다.'};type.requiredReviewRoleIds=['reviewer','director'];
 const approve=env.bundle.policies.find(p=>p.id==='test-F01-approve')!;
 approve.conditions=[{field:'requiredControlsVerified',equals:true,reason:'Synthetic completion gate',evidenceRefs:approve.evidenceRefs}];
 env.bundle.policies.push({...approve,id:'record-approve',approvalScope:'record',conditions:[]});
 env.bundle.policies.push({...env.bundle.policies.find(p=>p.id==='test-F01-review')!,id:'specialist-review',roleId:'director',approvalScope:'outcome'});
 env.bundle.manifest.manifestHash='';env.bundle.manifest.manifestHash=await sha256(canonical(env.bundle));
 await env.bindings.SOURCES.put('releases/test-release.json',JSON.stringify(env.bundle));await env.bindings.DB.prepare('UPDATE releases SET body=?').bind(JSON.stringify(env.bundle.manifest)).run();
 const form=new FormData();form.set('file',new File(['# Synthetic plan\nRequired controls are incomplete.'],'plan.md'));form.set('documentCode','PLAN-001');form.set('title','Synthetic plan');form.set('recordTypeIds','["test-F01"]');form.set('templateRevisionIds','["test-tpl-rev-1"]');form.set('requestKey',crypto.randomUUID());form.set('expectedContext',JSON.stringify(await getKnowledgeContext(env.bindings)));
 const upload=await app.request('/api/records',{method:'POST',headers:await headers('author'),body:form},env.bindings);expect(upload.status).toBe(201);return await upload.json() as {artifactId:string;revisionId:string};
}
async function headers(id:string){const actor=await env.select(id);return {cookie:`iso_session=${actor.sessionId}`,'X-Session-Version':'1'}}
async function mutate(r:{artifactId:string;revisionId:string},decision:string,personId:string,approvalScope?:string){
 const revision=await get<Revision>(env.bindings,'revisions',r.revisionId);
 return app.request(decision==='submit'?`/api/records/${r.artifactId}/submit`:`/api/revisions/${r.revisionId}/decisions`,{method:'POST',headers:{...await headers(personId),'Content-Type':'application/json'},body:JSON.stringify({...r,decision,approvalScope,comment:'Synthetic scope test',requestKey:crypto.randomUUID(),expectedContext:await getKnowledgeContext(env.bindings),expectedRevisionVersion:await revisionVersion(revision)})},env.bindings);
}
it('explicit plan approval stays distinct from outcome approval and retains incomplete controls',async()=>{
 const r=await setup();
 expect((await mutate(r,'submit','author','record')).status).toBe(200);
 expect((await mutate(r,'review','reviewer')).status).toBe(200);
 const revision=await get<Revision>(env.bindings,'revisions',r.revisionId);expect(revision.state).toBe('reviewed');
 const artifact=await get<Artifact>(env.bindings,'artifacts',r.artifactId);
 expect((await authorizeRecordAction(env.bindings,await env.select('approver'),artifact,revision,await getKnowledgeContext(env.bindings),'approve','outcome')).allowed).toBe(false);
 const before=await getKnowledgeContext(env.bindings);
 const change=await mutate(r,'approve','approver','outcome');expect(change.status).toBe(409);expect((await change.json() as any).error.code).toBe('APPROVAL_SCOPE_CONFLICT');expect(await getKnowledgeContext(env.bindings)).toEqual(before);
 expect((await mutate(r,'approve','reader','record')).status).toBe(403);
 expect((await mutate(r,'approve','approver','record')).status).toBe(200);
 const approved=await get<Revision>(env.bindings,'revisions',r.revisionId);expect(approved.approvalScope).toBe('record');expect(approved.state).toBe('approved');expect(approved.conditions.requiredControlsVerified).not.toBe(true);
 const decisions=await env.bindings.DB.prepare("SELECT body FROM decisions WHERE json_extract(body,'$.decision')='approve'").all<{body:string}>();expect(decisions.results.map(row=>JSON.parse(row.body).approvalScope)).toEqual(['record']);
 const actions=await app.request(`/api/records/${r.artifactId}/actions`,{headers:await headers('approver')},env.bindings);expect(await actions.json()).toMatchObject({approvalScope:'record',recordApproval:{label:'계획 승인'}});
});
it('ordinary approval still needs every required reviewer and the completion gate',async()=>{
 const r=await setup();expect((await mutate(r,'submit','author')).status).toBe(200);await mutate(r,'review','reviewer');expect((await get<Revision>(env.bindings,'revisions',r.revisionId)).state).toBe('in_review');
 expect((await mutate(r,'review','director')).status).toBe(200);expect((await get<Revision>(env.bindings,'revisions',r.revisionId)).state).toBe('reviewed');expect((await mutate(r,'approve','approver')).status).toBe(403);
});
it('unsupported scopes and scope switching while submitted cannot loosen approval requirements',async()=>{
 const r=await setup();expect((await mutate(r,'submit','author','invented')).status).toBe(422);expect((await mutate(r,'submit','author')).status).toBe(200);expect((await mutate(r,'submit','author','record')).status).toBe(403);
});
it('resubmitting a stale record approval under outcome scope requires fresh mandatory reviews',async()=>{
 const r=await setup();await mutate(r,'submit','author','record');await mutate(r,'review','reviewer');
 const old=await get<Revision>(env.bindings,'revisions',r.revisionId);
 await env.bindings.DB.prepare('UPDATE context SET authority_revision=authority_revision+1').run();
 expect((await mutate(r,'submit','author','outcome')).status).toBe(200);
 const restarted=await get<Revision>(env.bindings,'revisions',r.revisionId);expect(restarted.submissionId).not.toBe(old.submissionId);expect(restarted.approvalScope).toBe('outcome');expect(restarted.reviewedBy).toEqual([]);
 expect((await mutate(r,'approve','approver','outcome')).status).toBe(403);
 await mutate(r,'review','director');expect((await get<Revision>(env.bindings,'revisions',r.revisionId)).state).toBe('in_review');
 await mutate(r,'review','reviewer');expect((await get<Revision>(env.bindings,'revisions',r.revisionId)).state).toBe('reviewed');
});
it('a new revision retains the old record approval as history without inheriting its scope or decisions',async()=>{
 const r=await setup();await mutate(r,'submit','author','record');await mutate(r,'review','reviewer');await mutate(r,'approve','approver','record');
 const old=await get<Revision>(env.bindings,'revisions',r.revisionId);
 const form=new FormData();form.set('file',new File(['# Synthetic revised plan\nRequired controls remain incomplete.'],'plan-v2.md'));form.set('documentCode','PLAN-001');form.set('title','Synthetic plan');form.set('recordTypeIds','["test-F01"]');form.set('templateRevisionIds','["test-tpl-rev-1"]');form.set('expectedRevisionId',r.revisionId);form.set('requestKey',crypto.randomUUID());form.set('expectedContext',JSON.stringify(await getKnowledgeContext(env.bindings)));
 const response=await app.request(`/api/records/${r.artifactId}/revisions`,{method:'POST',headers:await headers('author'),body:form},env.bindings);expect(response.status,await response.clone().text()).toBe(201);
 const next=await response.json() as {revisionId:string};const revision=await get<Revision>(env.bindings,'revisions',next.revisionId);expect(revision.state).toBe('draft');expect(revision.approvalScope).toBeUndefined();expect(revision.submissionId).toBeUndefined();expect(revision.reviewedBy??[]).toEqual([]);
 expect(await get<Revision>(env.bindings,'revisions',r.revisionId)).toEqual(old);expect((await get<Artifact>(env.bindings,'artifacts',r.artifactId)).effectiveRevisionId).toBe(r.revisionId);
 expect((await mutate(r,'approve','approver','record')).status).toBe(409);
});
