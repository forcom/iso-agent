import {requestHash} from './requests';
import type {ActorContext,DecisionInput} from '../../../packages/contracts/src/index';
import type {Artifact,Env,Revision} from '../types';
import {all,assertContext,assertExpectedContext,commitMutation,event,get,getBundle,getKnowledgeContext,replay,update} from './storage';
import {authorizeRecordAction,requiredDecisions,submissionStale} from './conditions';
import {readRevision} from './artifacts';
import {requireValue,textField} from './errors';
export async function decideRevision(env:Env,actor:ActorContext,input:DecisionInput) {
 const key=textField(input.requestKey,'requestKey',200),hash=await requestHash('record.decide',input);const prior=await replay(env,actor,key,hash);if(prior!==undefined)return prior;
 const context=await getKnowledgeContext(env);assertExpectedContext(input.expectedContext,context);
 const revision=await get<Revision>(env,'revisions',input.revisionId),artifact=await get<Artifact>(env,'artifacts',revision.artifactId);
 requireValue(artifact.kind==='record',422,'INVALID_RESOURCE','기록 검토 경로를 사용해 주세요.');
 requireValue(artifact.workingRevisionId===revision.id,409,'REVISION_CONFLICT','새 작업 버전이 등록되었습니다.');
 requireValue(['submit','review','approve','reject'].includes(input.decision),422,'INVALID_DECISION','결정 유형을 확인해 주세요.');
 const stale=submissionStale(revision,context);
 if(input.decision!=='submit')requireValue(!stale,409,'AUTHORITY_CONFLICT','검토 요청 이후 정책·역할이 바뀌었습니다. 다시 검토 요청해 주세요.');
 const bundle=await getBundle(env,context),types=bundle.recordTypes.filter(type=>artifact.recordTypeIds.includes(type.id));
 requireValue(types.length===artifact.recordTypeIds.length,422,'RECORD_TYPE_UNAVAILABLE','현재 규정에서 기록 유형을 확인할 수 없습니다.');
 const needed=requiredDecisions(types,revision.conditions,input.decision==='approve'||input.decision==='review');
 const authorization=await authorizeRecordAction(env,actor,artifact,revision,context,input.decision);
 requireValue(authorization.allowed,403,'ACTION_DENIED',authorization.reason);await readRevision(env,revision.id);
 const next={...revision};const decisionId=crypto.randomUUID();
 if(input.decision==='submit'){
  const confirmedNoStages=!needed.review&&!needed.approval&&!needed.unconfirmed.length;
  requireValue(['draft','rejected'].includes(revision.state)||stale&&['in_review','reviewed'].includes(revision.state)||revision.state==='in_review'&&confirmedNoStages,409,'STATE_CONFLICT','현재 상태에서 검토를 요청할 수 없습니다.');
  next.submissionId=crypto.randomUUID();next.submittedContext=context;next.reviewedBy=[];next.approvedBy=[];
  next.state=!needed.review&&!needed.approval&&!needed.unconfirmed.length?'registered':'in_review';
 }else if(input.decision==='reject'){
  requireValue(['in_review','reviewed'].includes(revision.state),409,'STATE_CONFLICT','검토 중인 버전만 반려할 수 있습니다.');next.state='rejected';
 }else{
  const previous=(await all<any>(env,'decisions')).filter(decision=>decision.revisionId===revision.id&&decision.submissionId===revision.submissionId&&decision.context.releaseId===context.releaseId&&decision.context.authorityRevision===context.authorityRevision);
  const current={decision:input.decision,authorization,recordTypeIds:authorization.recordTypeIds};
  const decisions=[...previous,current];
  const forType=(kind:string,typeId:string)=>decisions.filter(decision=>decision.decision===kind&&(decision.recordTypeIds??[]).includes(typeId));
  const reviewComplete=needed.byType.filter(type=>type.review).every(type=>{
   const reviews=forType('review',type.recordTypeId);if(!reviews.length)return false;
   const policies=reviews.flatMap(review=>review.authorization.policyIds);
   const roles=new Set(bundle.policies.filter(policy=>policy.resourceTypeId===type.recordTypeId&&policies.includes(policy.id)).map(policy=>policy.roleId));
   return type.requiredReviewRoleIds.every(role=>roles.has(role));
  });
  if(input.decision==='review'){
   requireValue(needed.review,422,'REVIEW_NOT_REQUIRED','이 유형은 별도 검토가 필요하지 않습니다.');requireValue(revision.state==='in_review',409,'STATE_CONFLICT','검토 요청된 버전이 아닙니다.');
   next.state=reviewComplete?(needed.approval?'reviewed':'registered'):'in_review';next.reviewedBy=[...new Set([...(revision.reviewedBy??[]),actor.personId])];
  }else{
   requireValue(needed.approval,422,'APPROVAL_NOT_REQUIRED','이 유형은 승인 불필요입니다. 승인 이벤트를 생성하지 않습니다.');
   requireValue(revision.state===(needed.review?'reviewed':'in_review')&&reviewComplete,409,'STATE_CONFLICT','필요한 유형별 검토 단계를 먼저 완료해 주세요.');
   const approvalComplete=needed.byType.filter(type=>type.approval).every(type=>forType('approve',type.recordTypeId).length>0);
   next.state=approvalComplete?'approved':revision.state;next.approvedBy=[...new Set([...(revision.approvedBy??[]),actor.personId])];
  }
 }
 const decision={id:decisionId,revisionId:revision.id,artifactId:artifact.id,submissionId:next.submissionId,recordTypeIds:authorization.recordTypeIds,decision:input.decision,comment:input.comment??'',actorId:actor.personId,at:new Date().toISOString(),sourceSha256:revision.sourceSha256,context,authorization};
 const statements=[update(env,'revisions',revision.id,next),env.DB.prepare('INSERT INTO decisions VALUES(?,?,?)').bind(decisionId,revision.id,JSON.stringify(decision)),event(env,artifact.id,{kind:input.decision,revisionId:revision.id,decisionId,submissionId:next.submissionId,recordTypeIds:authorization.recordTypeIds,actorId:actor.personId,context})];
 if(['approved','registered'].includes(next.state))statements.push(update(env,'artifacts',artifact.id,{...artifact,effectiveRevisionId:revision.id}));
 const result={decisionId,revisionId:revision.id,status:next.state,recordTypeIds:authorization.recordTypeIds,submissionId:next.submissionId,context:{...context,dataRevision:context.dataRevision+1}};
 return commitMutation(env,actor,key,hash,context,result,statements);
}
