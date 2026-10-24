import {requestHash} from './requests';
import type {Action,ActorContext,ApprovalScope,AuthorizationDecision,KnowledgeBundle,KnowledgeContext,PolicyCondition,RecordType} from '../../../packages/contracts/src/index';
import type {Env,Artifact,Revision} from '../types';
import {all,assertContext,assertExpectedContext,commitMutation,event,get,getBundle,getKnowledgeContext,replay,update} from './storage';
import {readRevision,resourceFor} from './artifacts';
import {authorize,authorizeConditionConfirmation} from './engine';
import {sha256} from './markdown';
import {canonical} from '../../../packages/knowledge/src/index';
import {requireValue,textField} from './errors';
// Fence the exact target the user saw, including conditions, submission and accumulated decisions.
// Other records can change without invalidating this version; no persisted counter is needed.
export function revisionVersion(revision:Revision){return sha256(canonical(revision));}
export async function assertRevisionVersion(expected:unknown,revision:Revision){
 requireValue(typeof expected==='string'&&expected.length>0,422,'EXPECTED_REVISION_VERSION_REQUIRED','조회한 기록의 검토 기준이 필요합니다. 다시 확인해 주세요.');
 requireValue(expected===await revisionVersion(revision),409,'REVISION_CONFLICT','이 기록의 조건 또는 검토 상태가 변경되었습니다. 다시 확인해 주세요.');
}
export function typeConditions(bundle:KnowledgeBundle,typeIds:string[]) {
 const conditions=bundle.policies.filter(p=>typeIds.includes(p.resourceTypeId)).flatMap(p=>p.conditions);
 for(const type of bundle.recordTypes.filter(t=>typeIds.includes(t.id)))for(const condition of [type.applicabilityCondition,type.approvalCondition,type.reviewCondition,...(type.declaredConditions??[])])if(condition)conditions.push(condition);
 return [...new Map(conditions.map(c=>[c.field,c])).values()];
}
export function requiredDecisions(types:RecordType[],conditions:Revision['conditions'],requireConfirmed:boolean,approvalScope:ApprovalScope='outcome') {
 const unconfirmed:string[]=[];
 const applies=(condition:PolicyCondition|undefined):boolean|undefined=>{
  if(!condition)return false;
  if(typeof conditions[condition.field]!=='boolean'){
   if(requireConfirmed)requireValue(false,422,'CONDITION_UNCONFIRMED',`${condition.reason} 조건을 원문 근거와 함께 확인해 주세요.`);
   unconfirmed.push(condition.field);return undefined;
  }
  return conditions[condition.field]===condition.equals;
 };
 const byType=types.map(type=>{
  const applicable=type.applicabilityCondition?applies(type.applicabilityCondition):true;
  if(applicable===false)return {recordTypeId:type.id,applicable,review:false,approval:false,requiredReviewRoleIds:[] as string[]};
  // Evaluate every condition before aggregating; Array.some short-circuiting must
  // never hide an unconfirmed condition on another constituent record type.
  const reviewCondition=applies(type.reviewCondition),approvalCondition=applies(type.approvalCondition);
  return {recordTypeId:type.id,applicable,review:type.reviewRequired||reviewCondition===true,approval:type.approvalRequired||approvalCondition===true,requiredReviewRoleIds:approvalScope==='record'&&type.recordApproval?[]:type.requiredReviewRoleIds??[]};
 });
 return {review:byType.some(type=>type.review),approval:byType.some(type=>type.approval),byType,unconfirmed:[...new Set(unconfirmed)]};
}
export function submissionStale(revision:Revision,context:KnowledgeContext) {
 return !!revision.submittedContext&&(revision.submittedContext.releaseId!==context.releaseId||revision.submittedContext.authorityRevision!==context.authorityRevision||revision.submittedContext.rulesHash!==context.rulesHash);
}
export interface RecordActionAuthorization extends AuthorizationDecision {
 recordTypeIds:string[];perType:Array<{recordTypeId:string;authorization:AuthorizationDecision}>;
}
export async function authorizeRecordAction(env:Env,actor:ActorContext,artifact:Artifact,revision:Revision,context:KnowledgeContext,action:Action,approvalScope:ApprovalScope=revision.approvalScope??'outcome'):Promise<RecordActionAuthorization> {
 const resource={...resourceFor(artifact,revision),approvalScope};
 const bundle=await getBundle(env,context),types=bundle.recordTypes.filter(type=>artifact.recordTypeIds.includes(type.id));
 if(!['record','outcome'].includes(approvalScope)||approvalScope==='record'&&(types.length!==artifact.recordTypeIds.length||types.some(type=>!type.recordApproval)))return {allowed:false,reason:'이 기록 유형에는 해당 승인 범위가 정의되지 않았습니다.',context,policyIds:[],evidenceRefs:[],recordTypeIds:[],perType:[]};
 const needs=requiredDecisions(types,revision.conditions,false,approvalScope),stale=submissionStale(revision,context);
 const noStages=!needs.review&&!needs.approval&&!needs.unconfirmed.length;
 const canResubmit=stale&&['in_review','reviewed','rejected'].includes(revision.state)||revision.state==='in_review'&&noStages;
 if(action==='submit'&&canResubmit)resource.state='draft';
 if(!['review','approve','reject'].includes(action)){
  const authorization=await authorize(env,actor,action,resource,context);
  if(action==='submit'&&!(['draft','rejected'].includes(revision.state)||canResubmit)||action==='circulate'&&!['approved','registered'].includes(revision.state))return {...authorization,allowed:false,reason:'현재 단계에서 수행할 수 없습니다.',recordTypeIds:[],perType:[]};
  return {...authorization,recordTypeIds:authorization.allowed?artifact.recordTypeIds:[],perType:artifact.recordTypeIds.map(recordTypeId=>({recordTypeId,authorization}))};
 }
 const candidates=needs.byType.filter(type=>type.applicable!==false&&(action==='review'?type.review:action==='approve'?type.approval:type.review||type.approval));
 const perType=[];
 for(const type of candidates){const authorization=await authorize(env,actor,action,{...resource,typeIds:[type.recordTypeId]},context);perType.push({recordTypeId:type.recordTypeId,authorization})}
 const allowed=perType.filter(item=>item.authorization.allowed);
 const stageMatches=action==='review'?revision.state==='in_review':action==='approve'?revision.state===(needs.review?'reviewed':'in_review'):['in_review','reviewed'].includes(revision.state);
 if(stale||!stageMatches||action!=='reject'&&needs.unconfirmed.length)return {allowed:false,reason:stale?'규정·역할 변경 후 다시 검토 요청이 필요합니다.':needs.unconfirmed.length?'유형별 적용 조건 확인이 필요합니다.':'현재 단계에서는 이 결정을 수행할 수 없습니다.',context,policyIds:[],evidenceRefs:[],recordTypeIds:[],perType};
 const unique=<T>(items:T[])=>[...new Set(items)];
 return {allowed:allowed.length>0,reason:allowed.length?'해당 기록 유형의 규정상 권한 확인':perType.map(item=>item.authorization.reason).join('; ')||'이 유형에 필요한 결정 단계가 아닙니다.',context,policyIds:unique(allowed.flatMap(item=>item.authorization.policyIds)),assignmentIds:unique(allowed.flatMap(item=>item.authorization.assignmentIds??[])),evidenceRefs:allowed.flatMap(item=>item.authorization.evidenceRefs),engine:perType[0]?.authorization.engine,recordTypeIds:allowed.map(item=>item.recordTypeId),perType};
}
export async function confirmConditions(env:Env,actor:ActorContext,artifactId:string,input:any){
 const key=textField(input.requestKey,'requestKey',200),hash=await requestHash('record.conditions',{...input,artifactId});const prior=await replay(env,actor,key,hash);if(prior!==undefined)return prior;
 const context=await getKnowledgeContext(env);assertExpectedContext(input.expectedContext,context);const artifact=await get<Artifact>(env,'artifacts',artifactId),revision=await get<Revision>(env,'revisions',input.revisionId);
 requireValue(revision.artifactId===artifactId && artifact.workingRevisionId===revision.id,409,'REVISION_CONFLICT','현재 작업 버전이 아닙니다.');requireValue(['in_review','draft','rejected'].includes(revision.state),409,'STATE_CONFLICT','결정 전 작업 버전에서 조건을 확인해 주세요.');
 await assertRevisionVersion(input.expectedRevisionVersion,revision);
 const bundle=await getBundle(env,context),known=typeConditions(bundle,artifact.recordTypeIds),{markdown}=await readRevision(env,revision.id);
 requireValue(Array.isArray(input.confirmations)&&input.confirmations.length>0,422,'CONFIRMATION_REQUIRED','확인할 조건과 원문을 지정해 주세요.');
 const conditions={...revision.conditions},proofs=[];const confirmationTypes:string[][]=[];let requesterPersonId=revision.requesterPersonId,implementerIds=revision.implementerIds,auditedPersonIds=revision.auditedPersonIds;
 for(const item of input.confirmations){
  const requester=item.field==='requesterPersonId'&&bundle.policies.some(p=>artifact.recordTypeIds.includes(p.resourceTypeId)&&p.separationCondition==='not_requester');
  const people=(item.field==='implementerIds'&&bundle.policies.some(p=>artifact.recordTypeIds.includes(p.resourceTypeId)&&p.separationCondition==='not_implementer'))||(item.field==='auditedPersonIds'&&bundle.policies.some(p=>artifact.recordTypeIds.includes(p.resourceTypeId)&&p.separationCondition==='independent_auditor'));
  requireValue(requester||people||known.some(c=>c.field===item.field)&&typeof item.value==='boolean',422,'UNKNOWN_CONDITION','규정에 정의된 조건만 확인할 수 있습니다.');
  requireValue(typeof item.quote==='string'&&item.quote.trim().length>0&&Number.isInteger(item.lineStart)&&Number.isInteger(item.lineEnd)&&item.lineStart>0&&item.lineEnd>=item.lineStart&&item.lineEnd<=markdown.split('\n').length&&item.quote===markdown.split('\n').slice(item.lineStart-1,item.lineEnd).join('\n'),422,'QUOTE_MISMATCH','확인 근거는 해당 버전 원문과 정확히 일치해야 합니다.');
  if(requester){requireValue(typeof item.value==='string'&&(await get<any>(env,'persons',item.value)).active===true,422,'INVALID_REQUESTER','확인된 직원 중 신청자를 지정해 주세요.');requesterPersonId=item.value}
  else if(people){requireValue(Array.isArray(item.value)&&item.value.length>0&&item.value.every((id:unknown)=>typeof id==='string'),422,'INVALID_PERSON_LIST','대상 직원을 명시해 주세요.');for(const id of item.value)requireValue((await get<any>(env,'persons',id)).active===true,422,'INVALID_PERSON_LIST','유효한 직원을 선택해 주세요.');if(item.field==='implementerIds')implementerIds=[...new Set<string>(item.value)];else auditedPersonIds=[...new Set<string>(item.value)]}
  else conditions[item.field]=item.value;
  confirmationTypes.push(artifact.recordTypeIds.filter(id=>requester?bundle.policies.some(p=>p.resourceTypeId===id&&p.separationCondition==='not_requester'):people?bundle.policies.some(p=>p.resourceTypeId===id&&p.separationCondition===(item.field==='implementerIds'?'not_implementer':'independent_auditor')):typeConditions(bundle,[id]).some(condition=>condition.field===item.field)));
  proofs.push({...item,comment:textField(item.comment,'조건 확인 사유',5000),revisionId:revision.id,sourceSha256:revision.sourceSha256});
 }
 const resource={...resourceFor(artifact,revision),requesterPersonId,implementerIds,auditedPersonIds,state:'in_review',conditions};
 const authorizations=[];
 for(const typeIds of confirmationTypes){
  let permission:AuthorizationDecision|undefined;
  for(const id of typeIds){
   const review=await authorizeConditionConfirmation(env,actor,'review',{...resource,typeIds:[id]},context);
   const approval=review.allowed?undefined:await authorizeConditionConfirmation(env,actor,'approve',{...resource,typeIds:[id],state:'reviewed'},context);
   if(review.allowed||approval?.allowed){permission=review.allowed?review:approval;break}
  }
  requireValue(permission,403,'CONDITION_REVIEW_DENIED','해당 조건을 정의한 유형의 검토·승인 역할만 확인할 수 있습니다.');authorizations.push(permission);
 }
 // A changed assertion invalidates every pending review, including reviews by
 // other types in the same composite file. Their immutable history is retained.
 const reset=revision.state==='in_review'?{submissionId:crypto.randomUUID(),reviewedBy:[],approvedBy:[]}:{};
 return commitMutation(env,actor,key,hash,context,{revisionId:revision.id,conditions,requesterPersonId,implementerIds,auditedPersonIds,context:{...context,dataRevision:context.dataRevision+1}},[update(env,'revisions',revision.id,{...revision,conditions,requesterPersonId,implementerIds,auditedPersonIds,...reset}),event(env,artifactId,{kind:'conditions_confirmed',revisionId:revision.id,actorId:actor.personId,proofs,authorizations,context})]);
}
