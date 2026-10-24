import assert from 'node:assert/strict';
import {basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import type {KnowledgeContext} from '../../packages/contracts/src/index';
import {message,type Client,type Http,type Json} from './client';
import {DRAFT_ONLY,hash,requestKey,validateSources,type Inventory,type InventoryRow} from './inventory';

type Operation={path:string;personId:string;payload:Json;multipart:boolean;attempt:number;result?:Json};
export type RecordResult=InventoryRow & {artifactId:string|null;revisionId:string|null;appState:string|null;disposition:'new'|'existing'|null;error:string|null;verification:'unexecuted'|'running'|'passed'|'failed';expectedOutcome:'draft'|'approval-denied'|'record-approved'|'approved-or-registered';context:KnowledgeContext|null};
export type Checkpoint={planSha256:string;operations:Record<string,Operation>;records:Record<string,RecordResult>};
type RunOptions={plan:Inventory;runId:string;http:Http;checkpoint:Checkpoint;readSource:(path:string)=>Promise<Uint8Array>;persist:()=>Promise<void>;record:(entry:Json)=>Promise<void>};
export function assertPinnedContext(expected:KnowledgeContext,current:KnowledgeContext) {
 for(const key of ['releaseId','rulesHash','authorityRevision'] as const)assert.equal(current?.[key],expected[key],`Acceptance ${key} changed; prepare a new plan`);
}
export async function runRecords({plan,runId,http,checkpoint,readSource,persist,record}:RunOptions):Promise<void> {
 await validateSources(plan.rows,readSource);
 const clients=new Map<string,Client>();
 const client=async(personId:string)=>{
  let current=clients.get(personId);if(current)return current;
  const response=await http('/api/session',{json:{personId}}),cookie=response.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie,'Missing session cookie');assert.equal(response.body.actor.personId,personId);assertPinnedContext(plan.context,response.body.context);
  current={personId,cookie,version:response.body.sessionVersion};clients.set(personId,current);return current;
 };
 for(const row of plan.rows)checkpoint.records[row.informationId]??={...row,artifactId:null,revisionId:null,appState:null,disposition:null,error:null,verification:'unexecuted',expectedOutcome:row.draftOnly?'draft':row.approvalScope==='record'?'record-approved':row.confirmations.some(proof=>proof.field==='requiredControlsVerified'&&proof.value===false)?'approval-denied':'approved-or-registered',context:null};
 await persist();
 for(const row of plan.rows){
  const result=checkpoint.records[row.informationId],approvalScope=row.approvalScope??'outcome';result.verification='running';result.error=null;await persist();
  const key=(operation:string)=>requestKey(runId,plan.target,row.informationId,operation);
  const detail=async()=>{
   const body=(await http(`/api/artifacts/${result.artifactId}`,{client:await client(row.actors.author)})).body;
   assert.equal(body.artifact.documentCode,row.informationId);assert.deepEqual(body.artifact.recordTypeIds,[row.recordTypeId]);
   assert.equal(body.artifact.workingRevisionId,result.revisionId,'Working revision changed during acceptance');
   const revision=body.revisions.find((item:Json)=>item.id===result.revisionId);assert.ok(revision,'Missing uploaded revision');
   assert.equal(revision.sourceSha256,row.sourceSha256,'Existing record hash differs; new version requires separate review');
   assert.deepEqual(revision.templateRevisionIds,[row.templateRevisionId]);assert.deepEqual(revision.systemIds,row.targetSystemId?[row.targetSystemId]:[]);
   const type=plan.recordTypes.find(type=>type.id===row.recordTypeId);assert.ok(type,'Missing planned record type');
   const applicable=!type.applicabilityCondition||revision.conditions[type.applicabilityCondition.field]===type.applicabilityCondition.equals;
   const approvalRequired=applicable&&(type.approvalRequired||!!type.approvalCondition&&revision.conditions[type.approvalCondition.field]===type.approvalCondition.equals);
   assert.ok(revision.state!=='registered'||!approvalRequired,'Existing registered revision now requires approval; a separately planned original-preserving new revision is required');
   if(['approved','registered'].includes(revision.state)){assert.equal(body.artifact.effectiveRevisionId,result.revisionId,'Completed record is not the effective revision');assert.equal(revision.approvalScope??'outcome',approvalScope,'Completed record has a different approval scope')}
   result.appState=revision.state;return revision;
  };
  const fresh=async(personId:string,needsRevision:boolean)=>{
   const actor=await client(personId);
   const view=(await http(needsRevision?`/api/records/${result.artifactId}/actions?revisionId=${result.revisionId}`:'/api/me',{client:actor})).body;
   assertPinnedContext(plan.context,view.context);
   result.context=view.context;
   return needsRevision?{expectedContext:view.context,expectedRevisionVersion:view.revisionVersion,expectedState:view.state}:{expectedContext:view.context};
  };
  const execute=async(operation:string,path:string,personId:string,fields:Json={},multipart=false,needsRevision=false,expectDenied:boolean|{status:number;code:string}=false)=>{
   const request=key(operation);let pending=checkpoint.operations[request];
   if(pending?.result)return pending.result;
   if(!pending){pending={path,personId,payload:{...fields,...await fresh(personId,needsRevision),requestKey:request},multipart,attempt:0};checkpoint.operations[request]=pending;await persist();}
   assert.equal(pending.path,path);assert.equal(pending.personId,personId);
   for(;;){
    let form:FormData|undefined;
    if(multipart){form=new FormData();form.set('file',new File([Buffer.from(await readSource(row.sourcePath))],basename(row.sourcePath),{type:'text/markdown'}));for(const [name,value] of Object.entries(pending.payload))form.set(name,typeof value==='string'?value:JSON.stringify(value));}
    const response=await http(path,{client:await client(personId),...(multipart?{form}:{json:pending.payload}),expected:null});
    const code=response.body?.error?.code;
    result.context=response.body.context??pending.payload.expectedContext;
    await record({...result,operation,requestKey:request,method:'POST',path,personId,attempt:pending.attempt,status:response.status,durationMs:response.durationMs,responseIds:Object.fromEntries(Object.entries(response.body).filter(([name])=>/Id$/.test(name))),error:code??null,at:new Date().toISOString()});
    const denied=expectDenied===true?{status:403,code:'ACTION_DENIED'}:expectDenied;
    if(denied&&response.status===denied.status&&code===denied.code){pending.result=response.body;await persist();return response.body;}
    if(response.status>=200&&response.status<300){assert.ok(!expectDenied,`${operation}: expected HTTP ${denied?`${denied.status} ${denied.code}`:'error'}, received HTTP ${response.status}`);pending.result=response.body;await persist();return response.body;}
    if(code==='DUPLICATE_CODE'&&operation==='upload')return {duplicate:true};
    if(response.status===409&&code==='CONTEXT_CONFLICT'&&pending.attempt===0){
     const refreshed=await fresh(personId,needsRevision);
     if(needsRevision){assert.equal(refreshed.expectedRevisionVersion,pending.payload.expectedRevisionVersion,'Revision changed during context retry');assert.equal(refreshed.expectedState,pending.payload.expectedState);}
     pending.payload={...pending.payload,...refreshed};pending.attempt++;await persist();continue;
    }
    throw new Error(`${operation}: HTTP ${response.status} ${code??'NON_JSON_RESPONSE'}`);
   }
  };
  try {
   const author=await client(row.actors.author),bytes=await readSource(row.sourcePath);assert.equal(hash(bytes),row.sourceSha256,'Source hash changed before upload');
   if(!result.artifactId&&!checkpoint.operations[key('upload')]){
    const existing=(await http('/api/artifacts?category=records',{client:author})).body.items.filter((item:Json)=>item.documentCode===row.informationId);
    assert.ok(existing.length<=1,'Duplicate existing document code');
    if(existing.length){result.artifactId=existing[0].id;result.revisionId=existing[0].workingRevisionId;result.disposition='existing';await detail();}
   }
   if(!result.artifactId){
    const uploaded=await execute('upload','/api/records',row.actors.author,{documentCode:row.informationId,title:row.title,recordTypeIds:[row.recordTypeId],templateRevisionIds:[row.templateRevisionId],scope:row.targetSystemId},true);
    if(uploaded.duplicate){
     const existing=(await http('/api/artifacts?category=records',{client:author})).body.items.filter((item:Json)=>item.documentCode===row.informationId);assert.equal(existing.length,1,'Duplicate record not found');
     result.artifactId=existing[0].id;result.revisionId=existing[0].workingRevisionId;result.disposition='existing';
    }else{result.artifactId=uploaded.artifactId;result.revisionId=uploaded.revisionId;result.disposition='new';assert.equal(uploaded.status,'draft','Uploaded acceptance records must start as draft');}
    await persist();
   }
   const revision=await detail();
   const content=(await http(`/api/artifacts/${result.artifactId}/revisions/${result.revisionId}/content`,{client:author})).body;
   assert.equal(content.evidenceStatus,'verified');assert.equal(content.markdown,new TextDecoder().decode(bytes).replace(/\r\n?/g,'\n'));
   if(row.informationId===DRAFT_ONLY){assert.equal(result.appState,'draft','Draft-only record was already progressed');}
   else{
    for(const [index,confirmation] of row.confirmations.entries()){
     const {personId,...proof}=confirmation;
     if(checkpoint.operations[key(`condition:${index}`)]||result.appState==='draft')await execute(`condition:${index}`,`/api/records/${result.artifactId}/conditions`,personId,{revisionId:result.revisionId,confirmations:[proof]},false,true);
    }
    const stale=revision.submittedContext&&(['releaseId','rulesHash','authorityRevision'] as const).some(field=>revision.submittedContext[field]!==plan.context[field]);
    if(checkpoint.operations[key('submit')]||['draft','rejected'].includes(result.appState??'')||stale&&['in_review','reviewed'].includes(result.appState??''))await execute('submit',`/api/records/${result.artifactId}/submit`,row.actors.submitter,{revisionId:result.revisionId,approvalScope,comment:stale?'Acceptance resume: new regulation/role context requires a fresh review round':'Acceptance run: original source status is not approval'},false,true);
    await detail();
    for(const personId of row.actors.reviewers){const operation=`review:${personId}`;if(checkpoint.operations[key(operation)]||result.appState==='in_review')await execute(operation,`/api/revisions/${result.revisionId}/decisions`,personId,{decision:'review',approvalScope,comment:'Acceptance review of this exact original revision'},false,true);await detail();}
    if(result.expectedOutcome==='approval-denied'){
     assert.equal(result.appState,'reviewed','Pending-control record must remain reviewed');assert.ok(row.actors.approvers.length,'Missing denial-test approver');
     for(const personId of row.actors.approvers)await execute(`approval-denied:${personId}`,`/api/revisions/${result.revisionId}/decisions`,personId,{decision:'approve',comment:'Acceptance: unfulfilled controls must prevent unrestricted approval'},false,true,true);
     const revision=await detail();assert.equal(revision.state,'reviewed');assert.deepEqual(revision.approvedBy??[],[],'Denied approval changed approval history');
    }else{
     for(const personId of row.actors.approvers){
      if(approvalScope==='record'&&(checkpoint.operations[key(`outcome-scope-denied:${personId}`)]||result.appState==='reviewed'))await execute(`outcome-scope-denied:${personId}`,`/api/revisions/${result.revisionId}/decisions`,personId,{decision:'approve',approvalScope:'outcome',comment:'Acceptance: a record approval request must not become outcome approval'},false,true,{status:409,code:'APPROVAL_SCOPE_CONFLICT'});
      const operation=`approve:${personId}`;if(checkpoint.operations[key(operation)]||result.appState==='reviewed')await execute(operation,`/api/revisions/${result.revisionId}/decisions`,personId,{decision:'approve',approvalScope,comment:approvalScope==='record'?'Acceptance approval of record/plan content only; unfinished conditions and outcome restrictions remain':'Acceptance approval of this exact original revision'},false,true);await detail();
     }
     assert.ok(['approved','registered'].includes(result.appState??''),`Required decisions incomplete: ${result.appState}`);
     if(approvalScope==='record'){const approved=await detail();assert.equal(approved.approvalScope,'record');for(const proof of row.confirmations.filter(proof=>typeof proof.value==='boolean'))assert.equal(approved.conditions[proof.field],proof.value,'Record approval changed a source condition')}
     const listCirculations=async()=>((await http('/api/circulations?all=true',{client:author})).body.items as Json[]);
     const matches=(item:Json)=>item.artifactId===result.artifactId&&item.revisionId===result.revisionId&&item.createdBy===row.actors.circulator&&JSON.stringify([...item.recipientIds].sort())===JSON.stringify([...row.actors.recipients].sort());
     // A new run-id must not manufacture a second circulation for an already
     // completed exact revision. Re-read the original evidence; never copy old
     // request results into this run's idempotency checkpoint.
     let circulation:Json|undefined;
     if(!checkpoint.operations[key('circulate')])circulation=(await listCirculations()).filter(matches).sort((a,b)=>b.receipts.length-a.receipts.length||a.id.localeCompare(b.id))[0];
     const reused=!!circulation;
     if(!circulation){
      const created=await execute('circulate',`/api/revisions/${result.revisionId}/circulations`,row.actors.circulator,{recipientIds:row.actors.recipients,purpose:`Acceptance ${runId}: receipt and understanding of exact revision`});
      circulation=(await listCirculations()).find(item=>item.id===created.circulationId);
     }
     assert.ok(circulation&&matches(circulation),'Circulation evidence does not match the exact revision, actor and recipients');
     const receipts=()=>circulation!.receipts as Json[];
     for(const receipt of receipts())assert.ok(receipt.circulationId===circulation.id&&receipt.revisionId===result.revisionId&&row.actors.recipients.includes(receipt.personId)&&['received','understood'].includes(receipt.kind),'Circulation contains mismatched receipt evidence');
     for(const personId of row.actors.recipients)for(const kind of ['received','understood']){
      const existing=receipts().filter(item=>item.personId===personId&&item.kind===kind);assert.ok(existing.length<=1,'Duplicate receipt evidence');
      if(!existing.length||checkpoint.operations[key(`receipt:${personId}:${kind}`)])await execute(`receipt:${personId}:${kind}`,`/api/circulations/${circulation.id}/receipts`,personId,{revisionId:result.revisionId,kind});
     }
     circulation=(await listCirculations()).find(item=>item.id===circulation!.id);
     assert.ok(circulation&&matches(circulation),'Circulation changed during verification');
     for(const personId of row.actors.recipients)for(const kind of ['received','understood'])assert.equal(receipts().filter(item=>item.personId===personId&&item.kind===kind&&item.revisionId===result.revisionId).length,1,'Missing exact-version receipt evidence');
     await fresh(row.actors.circulator,false);
     await record({...result,operation:reused?'reuse-circulation':'verify-circulation',method:'GET',status:200,circulationId:circulation.id,circulationContext:circulation.context,receiptIds:receipts().map(item=>item.id),at:new Date().toISOString()});
    }
   }
   result.verification='passed';await persist();await record({...result,operation:'verify',method:'GET',status:200,durationMs:0,at:new Date().toISOString()});
  }catch(error){result.error=message(error,[...clients.values()].map(actor=>actor.cookie));result.verification='failed';await persist();await record({...result,operation:'failure',status:null,at:new Date().toISOString()});throw error;}
 }
 await validateSources(plan.rows,readSource);
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)void import('./cli').then(({main,fail})=>main().catch(fail));
