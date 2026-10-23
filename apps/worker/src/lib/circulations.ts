import {requestHash} from './requests';
import type {ActorContext,CirculationInput,KnowledgeContext,Person} from '../../../packages/contracts/src/index';
import type {Env,Artifact,Revision} from '../types';
import {get,getKnowledgeContext,assertContext,assertExpectedContext,replay,commitMutation,event} from './storage';
import {resourceFor,readRevision} from './artifacts';
import {requireAuthorization,engineCall} from './engine';
import {sha256} from './markdown';
import {requireValue,stringList,textField} from './errors';
export interface Circulation {id:string;revisionId:string;artifactId:string;recipientIds:string[];purpose:string;createdBy:string;at:string;context:KnowledgeContext}
export async function createCirculation(env:Env,actor:ActorContext,input:CirculationInput) {
 const key=textField(input.requestKey,'requestKey',200),hash=await requestHash('circulation.create',input);const prior=await replay(env,actor,key,hash);if(prior!==undefined)return prior;
 const context=await getKnowledgeContext(env);assertExpectedContext(input.expectedContext,context);
 const revision=await get<Revision>(env,'revisions',input.revisionId),artifact=await get<Artifact>(env,'artifacts',revision.artifactId);
 requireValue(['approved','registered'].includes(revision.state),409,'STATE_CONFLICT','승인본 또는 승인 불필요 등록본만 회람할 수 있습니다.');
 const authorization=await requireAuthorization(env,actor,'circulate',{...resourceFor(artifact,revision),currentRevisionId:revision.id},context);
 await readRevision(env,revision.id);
 const recipients=stringList(input.recipientIds,'recipientIds');requireValue(recipients.length>0,422,'RECIPIENT_REQUIRED','수신자를 지정해 주세요.');
 for(const id of recipients)requireValue((await get<Person>(env,'persons',id)).active,422,'RECIPIENT_INACTIVE','유효한 수신자를 선택해 주세요.');
 const id=crypto.randomUUID(),circulation:Circulation={id,revisionId:revision.id,artifactId:artifact.id,recipientIds:recipients,purpose:textField(input.purpose,'purpose'),createdBy:actor.personId,at:new Date().toISOString(),context};
 return commitMutation(env,actor,key,hash,context,{circulationId:id,revisionId:revision.id,recipientIds:recipients,context:{...context,dataRevision:context.dataRevision+1}},[env.DB.prepare('INSERT INTO circulations VALUES(?,?,?)').bind(id,revision.id,JSON.stringify(circulation)),event(env,artifact.id,{kind:'circulation_created',circulationId:id,revisionId:revision.id,actorId:actor.personId,authorization,context})]);
}
export async function confirmReceipt(env:Env,actor:ActorContext,input:{circulationId:string;revisionId:string;kind:'received'|'understood';requestKey:string;expectedContext:KnowledgeContext}) {
 const key=textField(input.requestKey,'requestKey',200),hash=await requestHash('receipt.confirm',input);const prior=await replay(env,actor,key,hash);if(prior!==undefined)return prior;
 const context=await getKnowledgeContext(env);assertExpectedContext(input.expectedContext,context);
 const circ=await get<Circulation>(env,'circulations',input.circulationId);
 requireValue(circ.recipientIds.includes(actor.personId),403,'RECIPIENT_REQUIRED','지정 수신자 본인만 확인할 수 있습니다.');
 requireValue(circ.revisionId===input.revisionId,409,'REVISION_CONFLICT','회람 대상 버전이 다릅니다.');
 requireValue(['received','understood'].includes(input.kind),422,'INVALID_RECEIPT','수령·이해 확인을 선택해 주세요.');
 const existing=await env.DB.prepare('SELECT body FROM receipts WHERE circulation_id=? AND person_id=? AND kind=?').bind(circ.id,actor.personId,input.kind).first<{body:string}>();if(existing)return JSON.parse(existing.body);
 if(input.kind==='understood')requireValue(await env.DB.prepare("SELECT id FROM receipts WHERE circulation_id=? AND person_id=? AND kind='received'").bind(circ.id,actor.personId).first(),409,'RECEIPT_ORDER','수령 확인을 먼저 해 주세요.');
 const authorization=await engineCall<any>(env,'/authorize',{context,snapshot:{context,policies:[],assignments:[]},actor:{...actor,active:true},action:'confirm_receipt',resource:{id:circ.id,typeIds:[],revisionId:circ.revisionId,currentRevisionId:circ.revisionId,state:'approved',recipientPersonIds:circ.recipientIds},now:new Date().toISOString()},context);
 requireValue(authorization.allowed,403,'RECEIPT_DENIED',authorization.reason);
 const id=crypto.randomUUID(),receipt={id,receiptId:id,circulationId:circ.id,revisionId:circ.revisionId,personId:actor.personId,kind:input.kind,at:new Date().toISOString()};
 return commitMutation(env,actor,key,hash,context,receipt,[env.DB.prepare('INSERT INTO receipts VALUES(?,?,?,?,?)').bind(id,circ.id,actor.personId,input.kind,JSON.stringify(receipt)),event(env,circ.artifactId,{kind:`receipt_${input.kind}`,receiptId:id,revisionId:circ.revisionId,actorId:actor.personId,context})]);
}
