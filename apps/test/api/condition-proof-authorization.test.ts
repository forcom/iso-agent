import {afterEach,expect,it} from 'vitest';
import app from '../../worker/src/index';
import {createTestEnvironment,type TestEnvironment} from '../support/environment';
import {canonical,sha256} from '../../packages/knowledge/src/index';
import {all,get,getKnowledgeContext,update} from '../../worker/src/lib/storage';
import {revisionVersion} from '../../worker/src/lib/conditions';
import type {Revision} from '../../worker/src/types';

let env:TestEnvironment;
afterEach(async()=>env?.cleanup());
type RecordIds={artifactId:string;revisionId:string};
const quote='The escalation applies; mandatory controls are not verified.';
async function headers(personId:string){const actor=await env.select(personId);return {cookie:`iso_session=${actor.sessionId}`,'X-Session-Version':'1'};}
async function setup(){
 env=await createTestEnvironment();
 const approval=env.bundle.policies.find(policy=>policy.id==='test-F01-approve')!;
 approval.roleId='director';
 approval.conditions=[{field:'escalationRequired',equals:true,reason:'Synthetic escalation',evidenceRefs:approval.evidenceRefs},{field:'requiredControlsVerified',equals:true,reason:'Synthetic mandatory controls',evidenceRefs:approval.evidenceRefs}];
 approval.scopeCondition.conditions={escalationRequired:true,requiredControlsVerified:true};
 await saveBundle();
 const form=new FormData();form.set('file',new File([`# Synthetic conditional record\n${quote}`],'record.md'));
 form.set('documentCode','SYNTHETIC-CONDITION-PROOF');form.set('title','Synthetic conditional record');
 form.set('recordTypeIds',JSON.stringify(['test-F01']));form.set('templateRevisionIds',JSON.stringify(['test-tpl-rev-1']));
 form.set('requestKey',crypto.randomUUID());form.set('expectedContext',JSON.stringify(await getKnowledgeContext(env.bindings)));
 const response=await app.request('/api/records',{method:'POST',headers:await headers('author'),body:form},env.bindings);
 expect(response.status).toBe(201);return response.json() as Promise<RecordIds>;
}
async function saveBundle(){
 env.bundle.manifest.manifestHash='';env.bundle.manifest.manifestHash=await sha256(canonical(env.bundle));
 await env.bindings.SOURCES.put('releases/test-release.json',JSON.stringify(env.bundle));
 await env.bindings.DB.prepare('UPDATE releases SET body=? WHERE id=?').bind(JSON.stringify(env.bundle.manifest),env.bundle.manifest.releaseId).run();
}
async function mutate(record:RecordIds,operation:string,personId:string,body:object={}){
 const path=operation==='conditions'||operation==='submit'?`/api/records/${record.artifactId}/${operation}`:`/api/revisions/${record.revisionId}/decisions`;
 return app.request(path,{method:'POST',headers:{...await headers(personId),'Content-Type':'application/json'},body:JSON.stringify({requestKey:crypto.randomUUID(),revisionId:record.revisionId,expectedContext:await getKnowledgeContext(env.bindings),expectedRevisionVersion:await revisionVersion(await get<Revision>(env.bindings,'revisions',record.revisionId)),decision:operation,...body})},env.bindings);
}
function proof(field:string,value:boolean){return {field,value,lineStart:2,lineEnd:2,quote,comment:'Record the synthetic source fact without granting approval'};}

it.each([false,undefined])('allows the approval role to confirm a fact with mandatory controls %s while approval stays denied',async(controls)=>{
 const record=await setup();
 if(controls===false){
  const response=await mutate(record,'conditions','director',{confirmations:[proof('requiredControlsVerified',false)]});
  expect(response.status).toBe(200);
 }
 const confirmation=await mutate(record,'conditions','director',{confirmations:[proof('escalationRequired',true)]});
 expect(confirmation.status).toBe(200);
 const revision=await get<Revision>(env.bindings,'revisions',record.revisionId);
 expect(revision.conditions.escalationRequired).toBe(true);expect(revision.conditions.requiredControlsVerified).toBe(controls);expect(revision.state).toBe('draft');
 expect(await all(env.bindings,'decisions')).toHaveLength(0);
 const events=(await all<any>(env.bindings,'events')).filter(event=>event.kind==='conditions_confirmed');
 expect(events.length).toBe(controls===false?2:1);
 expect(events.every(event=>event.authorizations.every((authorization:any)=>authorization.purpose==='condition_confirmation'))).toBe(true);
 expect((await mutate(record,'submit','author')).status).toBe(200);
 expect((await mutate(record,'review','reviewer')).status).toBe(200);
 const beforeContext=await getKnowledgeContext(env.bindings),beforeDecisions=await all(env.bindings,'decisions');
 const approval=await mutate(record,'approve','director',{purpose:'condition_confirmation'});
 expect(approval.status).toBe(403);expect(await approval.json()).toMatchObject({error:{code:'ACTION_DENIED'}});
 expect(await getKnowledgeContext(env.bindings)).toEqual(beforeContext);expect(await all(env.bindings,'decisions')).toEqual(beforeDecisions);
 expect((await get<Revision>(env.bindings,'revisions',record.revisionId)).state).toBe('reviewed');
});

it.each(['wrong-role','wrong-assignment-scope','wrong-policy-scope','self-review','stale-context','stale-version'])('does not bypass %s when confirming conditions',async(boundary)=>{
 const record=await setup();let actor='director';const extra:Record<string,unknown>={};
 if(boundary==='wrong-role')actor='reader';
 if(boundary==='wrong-assignment-scope'){
  const assignment=await get<any>(env.bindings,'assignments','test-assignment-director');
  await update(env.bindings,'assignments',assignment.id,{...assignment,scope:{kind:'resource',ids:['another-record']}}).run();
 }
 if(boundary==='wrong-policy-scope'||boundary==='self-review'){
  const approval=env.bundle.policies.find(policy=>policy.id==='test-F01-approve')!;
  if(boundary==='wrong-policy-scope')approval.scopeCondition={kind:'system',systemIds:['another-system'],conditions:approval.scopeCondition.conditions};
  else {approval.roleId='author';approval.separationCondition='not_author';actor='author';}
  await saveBundle();
 }
 if(boundary==='stale-context')extra.expectedContext={...await getKnowledgeContext(env.bindings),authorityRevision:999};
 if(boundary==='stale-version')extra.expectedRevisionVersion='old-view';
 const before=await get<Revision>(env.bindings,'revisions',record.revisionId),beforeContext=await getKnowledgeContext(env.bindings);
 const response=await mutate(record,'conditions',actor,{confirmations:[proof('escalationRequired',true)],...extra});
 expect(response.status).toBe(boundary.startsWith('stale-')?409:403);
 expect(await get<Revision>(env.bindings,'revisions',record.revisionId)).toEqual(before);
 expect(await getKnowledgeContext(env.bindings)).toEqual(beforeContext);
 expect((await all<any>(env.bindings,'events')).filter(event=>event.kind==='conditions_confirmed')).toHaveLength(0);
});

it('keeps not_implementer separation when the same approval role confirms a condition',async()=>{
 const record=await setup();
 const approval=env.bundle.policies.find(policy=>policy.id==='test-F01-approve')!;
 approval.separationCondition='not_implementer';await saveBundle();
 const initial=await get<Revision>(env.bindings,'revisions',record.revisionId);
 const selfImplemented={...initial,conditions:{requiredControlsVerified:false},implementerIds:['director']};
 await update(env.bindings,'revisions',record.revisionId,selfImplemented).run();
 const confirmation={confirmations:[proof('escalationRequired',true)]};
 const beforeContext=await getKnowledgeContext(env.bindings),beforeEvents=await all(env.bindings,'events');
 const denied=await mutate(record,'conditions','director',confirmation);
 expect(denied.status).toBe(403);expect(await denied.json()).toMatchObject({error:{code:'CONDITION_REVIEW_DENIED'}});
 expect(await get<Revision>(env.bindings,'revisions',record.revisionId)).toEqual(selfImplemented);
 expect(await getKnowledgeContext(env.bindings)).toEqual(beforeContext);expect(await all(env.bindings,'events')).toEqual(beforeEvents);
 expect(await all(env.bindings,'decisions')).toHaveLength(0);
 // Only the implementer changes; actor, assignment, policy, state and facts stay fixed.
 await update(env.bindings,'revisions',record.revisionId,{...selfImplemented,implementerIds:['reader']}).run();
 const allowed=await mutate(record,'conditions','director',confirmation);
 expect(allowed.status).toBe(200);
 expect(await get<Revision>(env.bindings,'revisions',record.revisionId)).toMatchObject({state:'draft',implementerIds:['reader'],conditions:{requiredControlsVerified:false,escalationRequired:true}});
 const events=(await all<any>(env.bindings,'events')).filter(event=>event.kind==='conditions_confirmed');
 expect(events).toHaveLength(1);
 expect(events[0].authorizations).toHaveLength(1);
 expect(events[0].authorizations[0]).toMatchObject({allowed:true,purpose:'condition_confirmation',policyIds:[approval.id]});
 expect(await all(env.bindings,'decisions')).toHaveLength(0);
});
