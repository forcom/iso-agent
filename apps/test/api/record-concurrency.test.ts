import {afterEach,expect,it} from 'vitest';
import app from '../../worker/src/index';
import {createTestEnvironment,type TestEnvironment} from '../support/environment';
import {canonical,sha256} from '../../packages/knowledge/src/index';
import {all,get,getKnowledgeContext} from '../../worker/src/lib/storage';
import {mutationContext,type ActionSet} from '../../worker/web/api';
import type {Revision} from '../../worker/src/types';

let env:TestEnvironment;
afterEach(async()=>env?.cleanup());
type RecordIds={artifactId:string;revisionId:string};
async function headers(personId:string){const actor=await env.select(personId);return {cookie:`iso_session=${actor.sessionId}`,'X-Session-Version':'1'};}
async function post(path:string,body:object,personId:string){
 return app.request(path,{method:'POST',headers:{...await headers(personId),'Content-Type':'application/json'},body:JSON.stringify({requestKey:crypto.randomUUID(),...body})},env.bindings);
}
async function setup(){
 env=await createTestEnvironment();
 env.bundle.recordTypes[0].approvalCondition={field:'approvalApplicable',equals:true,reason:'Synthetic approval applicability',evidenceRefs:env.bundle.recordTypes[0].evidenceRefs};
 env.bundle.manifest.manifestHash='';env.bundle.manifest.manifestHash=await sha256(canonical(env.bundle));
 await env.bindings.SOURCES.put('releases/test-release.json',JSON.stringify(env.bundle));
 await env.bindings.DB.prepare('UPDATE releases SET body=? WHERE id=?').bind(JSON.stringify(env.bundle.manifest),env.bundle.manifest.releaseId).run();
}
async function upload():Promise<RecordIds>{
 const form=new FormData();form.set('file',new File(['# Synthetic record\nThe activity requires applicability confirmation.'],'record.md'));
 form.set('documentCode',crypto.randomUUID());form.set('title','Synthetic condition race');
 form.set('recordTypeIds',JSON.stringify(['test-F01']));form.set('templateRevisionIds',JSON.stringify(['test-tpl-rev-1']));
 form.set('requestKey',crypto.randomUUID());form.set('expectedContext',JSON.stringify(await getKnowledgeContext(env.bindings)));
 const response=await app.request('/api/records',{method:'POST',headers:await headers('author'),body:form},env.bindings);
 expect(response.status).toBe(201);return response.json() as Promise<RecordIds>;
}
async function screen(record:RecordIds,personId:string):Promise<ActionSet>{
 const response=await app.request(`/api/records/${record.artifactId}/actions?revisionId=${record.revisionId}`,{headers:await headers(personId)},env.bindings);
 expect(response.status).toBe(200);return response.json() as Promise<ActionSet>;
}
function confirmations(value:boolean){return [{field:'approvalApplicable',value,lineStart:2,lineEnd:2,quote:'The activity requires applicability confirmation.',comment:'Synthetic applicability determination'}];}
async function confirm(record:RecordIds,value:boolean,view?:ActionSet){
 return post(`/api/records/${record.artifactId}/conditions`,{...mutationContext(view??await screen(record,'approver')),confirmations:confirmations(value)},'approver');
}
async function decide(record:RecordIds,decision:string,personId:string,view?:ActionSet){
 return post(decision==='submit'?`/api/records/${record.artifactId}/submit`:`/api/revisions/${record.revisionId}/decisions`,{...mutationContext(view??await screen(record,personId)),decision,comment:'Synthetic decision'},personId);
}
async function submitted(){
 const record=await upload();expect((await confirm(record,false)).status).toBe(200);expect((await decide(record,'submit','author')).status).toBe(200);return record;
}

it('rejects an old review after a condition change creates a new submission',async()=>{
 await setup();const record=await submitted(),oldScreen=await screen(record,'reviewer');
 const before=await get<Revision>(env.bindings,'revisions',record.revisionId);
 expect(oldScreen.conditions?.find(condition=>condition.field==='approvalApplicable')?.value).toBe(false);
 expect((await confirm(record,true)).status).toBe(200);
 const changed=await get<Revision>(env.bindings,'revisions',record.revisionId);
 expect(changed.submissionId).not.toBe(before.submissionId);
 const response=await decide(record,'review','reviewer',oldScreen);
 expect(response.status).toBe(409);expect(await response.json()).toMatchObject({error:{code:'REVISION_CONFLICT'}});
 expect((await all<any>(env.bindings,'decisions')).filter(decision=>decision.decision==='review')).toHaveLength(0);
 expect((await get<Revision>(env.bindings,'revisions',record.revisionId)).state).toBe('in_review');
 expect((await decide(record,'review','reviewer')).status).toBe(200);
});

it('rejects a stale draft condition edit instead of overwriting a newer confirmation',async()=>{
 await setup();const record=await upload(),oldScreen=await screen(record,'approver');
 expect((await confirm(record,true,oldScreen)).status).toBe(200);
 expect((await confirm(record,false,oldScreen)).status).toBe(409);
 const revision=await get<Revision>(env.bindings,'revisions',record.revisionId);
 expect(revision.conditions.approvalApplicable).toBe(true);expect(revision.state).toBe('draft');
 expect((await all<any>(env.bindings,'events')).filter(event=>event.kind==='conditions_confirmed')).toHaveLength(1);
});

it('rejects a review from the prior submission after rejection and resubmission',async()=>{
 await setup();const record=await submitted(),oldScreen=await screen(record,'reviewer');
 expect((await decide(record,'reject','approver')).status).toBe(200);expect((await decide(record,'submit','author')).status).toBe(200);
 expect((await decide(record,'review','reviewer',oldScreen)).status).toBe(409);
 expect((await decide(record,'review','reviewer')).status).toBe(200);
});

it('allows unrelated record changes and replays an already committed decision once',async()=>{
 await setup();const record=await submitted(),view=await screen(record,'reviewer');
 await upload();
 const body={...mutationContext(view),decision:'review',comment:'Synthetic decision',requestKey:'same-review'};
 const first=await post(`/api/revisions/${record.revisionId}/decisions`,body,'reviewer');expect(first.status).toBe(200);
 const replay=await post(`/api/revisions/${record.revisionId}/decisions`,body,'reviewer');expect(replay.status).toBe(200);expect(await replay.json()).toEqual(await first.json());
 expect((await all<any>(env.bindings,'decisions')).filter(decision=>decision.decision==='review')).toHaveLength(1);
});

it.each(['submit','conditions'])('requires the target version for %s',async(operation)=>{
 await setup();const record=await upload();
 const response=await post(`/api/records/${record.artifactId}/${operation}`,{revisionId:record.revisionId,expectedContext:await getKnowledgeContext(env.bindings),confirmations:confirmations(true)},operation==='submit'?'author':'approver');
 expect(response.status).toBe(422);expect(await response.json()).toMatchObject({error:{code:'EXPECTED_REVISION_VERSION_REQUIRED'}});
 expect(await all(env.bindings,'decisions')).toHaveLength(0);
 expect((await get<Revision>(env.bindings,'revisions',record.revisionId)).conditions).toEqual({});
});
