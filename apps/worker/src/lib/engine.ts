import type {ActorContext,KnowledgeContext,KnowledgeBundle,Entity,Relation,RoleAssignment,Person,Action,ApprovalScope,AuthorizationDecision,GraphResult,GraphOperation,EvidenceRef,EvidenceStatus} from '../../../packages/contracts/src/index';
import type {Artifact,Env,Revision} from '../types';
import {ApiError,requireValue} from './errors';
import {all,assertContext,getBundle,getKnowledgeContext,loadRelease,requestMemo} from './storage';
import {sha256} from './markdown';
import {administratorAssignmentEligible} from '../routes/session';
import {canonical} from '../../../packages/knowledge/src/index';
import {restrictRecordDesignations,type DesignatedSource} from './record-designations';
// ponytail: memoized per request only; every request still re-reads and re-hashes all R2 sources.
// Cache verified source hashes by R2 etag across requests if revision counts make that slow.
export async function snapshot(env:Env,context:KnowledgeContext) {
 const data=await requestMemo(`snapshot:${canonical(context)}`,()=>computeSnapshot(env,context));
 assertContext(context,await getKnowledgeContext(env));
 return {...data};
}
async function computeSnapshot(env:Env,context:KnowledgeContext) {
 const bundle=await getBundle(env,context);
 const [artifacts,revisions,relations,assignments,decisions,persons,receipts]=await Promise.all([all<Artifact>(env,'artifacts'),all<Revision>(env,'revisions'),all<Relation>(env,'relations'),all<RoleAssignment>(env,'assignments'),all<{id:string;revisionId:string;decision:string;sourceSha256?:string;actorId?:string}>(env,'decisions'),all<Person>(env,'persons'),all<{id:string;revisionId:string;personId:string;kind:string}>(env,'receipts')]);
 const sourceStates=new Map<string,{status:EvidenceStatus;hash?:string;raw?:string;text?:string}>();
 const sourceRevisions=[...revisions,...bundle.sources.filter(source=>source.kind==='index').map(source=>({id:source.revisionId,objectKey:`sources/${source.revisionId}/${source.sha256}.md`,sourceSha256:source.sha256,textSha256:source.textSha256,evidenceStatus:'verified' as const}))];
 await Promise.all(sourceRevisions.map(async revision=>{
  if(revision.evidenceStatus!=='verified'){sourceStates.set(revision.id,{status:revision.evidenceStatus});return}
  const object=await env.SOURCES.get(revision.objectKey);
  if(!object){sourceStates.set(revision.id,{status:'unavailable'});return}
  const bytes=new Uint8Array(await object.arrayBuffer()),hash=await sha256(bytes);
  if(hash!==revision.sourceSha256){sourceStates.set(revision.id,{status:'changed'});return}
  try {
   const raw=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes),text=raw.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
   if(await sha256(text)!==revision.textSha256){sourceStates.set(revision.id,{status:'changed'});return}
   sourceStates.set(revision.id,{status:'verified',hash,raw,text});
  }catch{sourceStates.set(revision.id,{status:'unavailable'})}
 }));
 const evidenceStatus=(refs:EvidenceRef[]):EvidenceStatus=>{
  if(!refs.length)return 'unrecorded';
  for(const ref of refs){
   const source=sourceStates.get(ref.revisionId);
   if(!source)return 'unavailable';
   if(source.status!=='verified')return source.status;
   if(source.hash!==ref.sourceSha256 || !Number.isInteger(ref.lineStart) || !Number.isInteger(ref.lineEnd) || ref.lineStart<1 || ref.lineEnd<ref.lineStart)return 'changed';
   const matches=(text:string)=>{const lines=text.split('\n');return ref.lineEnd<=lines.length && lines.slice(ref.lineStart-1,ref.lineEnd).join('\n')===ref.quote};
   if(!matches(source.raw!)&&!matches(source.text!))return 'changed';
  }return 'verified';
 };
 const sourceRef=(revisionId:string):EvidenceRef[]=>{
  const source=sourceStates.get(revisionId);if(source?.status!=='verified')return [];
  const lines=source.text!.split('\n'),line=lines.findIndex(value=>value.trim().length>0);
  return line<0?[]:[{revisionId,sourceSha256:source.hash!,lineStart:line+1,lineEnd:line+1,quote:lines[line]}];
 };
 const entities:Entity[]=bundle.entities.map(entity=>({...entity,metadata:{...entity.metadata}})); const byId=new Map(entities.map(e=>[e.id,e]));
 const addEntity=(entity:Entity)=>{if(!byId.has(entity.id)){entities.push(entity);byId.set(entity.id,entity)}};
 for(const artifact of artifacts) if(!byId.has(artifact.id)){
  const entity:Entity={id:artifact.id,type:artifact.kind==='record'?'Record':artifact.kind==='template'?'Template':'Regulation',label:artifact.title,evidenceRefs:[]};entities.push(entity);byId.set(entity.id,entity);
 }
 for(const revision of revisions){
  const artifact=artifacts.find(a=>a.id===revision.artifactId);
  let entity=byId.get(revision.id);
  if(!entity){entity={id:revision.id,type:'ArtifactRevision',label:`${artifact?.title??revision.id} (${revision.state})`,evidenceRefs:[]};entities.push(entity);byId.set(entity.id,entity)}
  entity.metadata={...entity.metadata,artifactId:revision.artifactId,artifactKind:artifact?.kind,state:revision.state,evidenceStatus:sourceStates.get(revision.id)?.status??'unavailable'};
 }
 // Runtime facts retain their creation release in storage. Resolve removed definitions
 // from that immutable release, then calculate against the current snapshot context.
 const historicalBundles=new Map<string,KnowledgeBundle>();
 for(const relation of relations){
  const missing=[relation.subjectId,relation.objectId].filter(id=>!byId.has(id));if(!missing.length)continue;
  const releaseId=relation.createdReleaseId??relation.releaseId;
  let historical=historicalBundles.get(releaseId);
  if(!historical){historical=await loadRelease(env,releaseId);historicalBundles.set(releaseId,historical)}
  for(const id of missing){
   const definition=historical.entities.find(entity=>entity.id===id);
   requireValue(definition,503,'KNOWLEDGE_UNAVAILABLE','기록의 이전 분류 정의를 찾을 수 없습니다.');
   addEntity({...definition,metadata:{...definition.metadata,currentDefinition:false,definitionReleaseId:releaseId}});
  }
 }
 for(const person of persons)addEntity({id:person.id,type:'Person',label:person.name,evidenceRefs:[],metadata:{active:person.active,fictional:person.fictional,personaId:person.personaId,department:person.department,jobTitle:person.jobTitle,reportsToId:person.reportsToId}});
 for(const role of bundle.roles)addEntity({id:role.id,type:'FunctionalRole',label:role.name,evidenceRefs:role.evidenceRefs});
 const dynamicRelations:Relation[]=[];
 const directEvent=async(seed:string,subjectId:string,objectId:string,type:Relation['type'],refs:EvidenceRef[])=>{
  const hash=await sha256(seed),id=`${hash.slice(0,8)}-${hash.slice(8,12)}-8${hash.slice(13,16)}-${((parseInt(hash[16],16)&3)|8).toString(16)}${hash.slice(17,20)}-${hash.slice(20,32)}`;
  dynamicRelations.push({id,subjectId,objectId,type,origin:'explicit_metadata',evidenceRefs:refs,releaseId:context.releaseId,reviewStatus:'validated',derived:false});
 };
 for(const decision of decisions){
  if(!byId.has(decision.revisionId))continue;
  const refs=sourceRef(decision.revisionId);
  addEntity({id:decision.id,type:'ReviewDecision',label:decision.decision,evidenceRefs:refs,metadata:{...decision,eventRecorded:true}});
  await directEvent(`${decision.id}:decision_on`,decision.id,decision.revisionId,'decision_on',refs);
 }
 for(const receipt of receipts){
  if(!byId.has(receipt.revisionId))continue;
  const refs=sourceRef(receipt.revisionId);
  addEntity({id:receipt.id,type:'Receipt',label:receipt.kind,evidenceRefs:refs,metadata:{...receipt,eventRecorded:true}});
  await directEvent(`${receipt.id}:receipt_for`,receipt.id,receipt.revisionId,'receipt_for',refs);
 }
 for(const assignment of assignments){
  // Historical role IDs remain explicit assignment metadata; they cannot acquire
  // a current policy merely by appearing as a node in this graph.
  addEntity({id:assignment.roleId,type:'FunctionalRole',label:assignment.roleId,evidenceRefs:assignment.evidenceRefs,metadata:{currentDefinition:false}});
  addEntity({id:assignment.id,type:'RoleAssignment',label:`${assignment.personId} / ${assignment.roleId}`,evidenceRefs:assignment.evidenceRefs,metadata:{...assignment,eventRecorded:true}});
  if(byId.has(assignment.personId))await directEvent(`${assignment.id}:assignment_person`,assignment.id,assignment.personId,'assignment_person',assignment.evidenceRefs);
  await directEvent(`${assignment.id}:assignment_role`,assignment.id,assignment.roleId,'assignment_role',assignment.evidenceRefs);
 }
 for(const entity of entities)if(entity.type==='ArtifactRevision'&&!sourceStates.has(entity.id))entity.metadata={...entity.metadata,evidenceStatus:'unavailable'};
 const runtimeRelations=relations.map(relation=>({...relation,...(relation.releaseId===context.releaseId?{}:{createdReleaseId:relation.createdReleaseId??relation.releaseId,releaseId:context.releaseId})}));
 const verifiedRelations=[...bundle.relations,...runtimeRelations,...dynamicRelations].map(original=>{
  let relation=original;
  if(relation.type==='has_revision'&&relation.origin==='explicit_metadata'&&!relation.evidenceRefs.length&&revisions.some(revision=>revision.id===relation.objectId&&revision.artifactId===relation.subjectId))relation={...relation,evidenceRefs:sourceRef(relation.objectId)};
  let status=relation.evidenceStatus&&relation.evidenceStatus!=='verified'?relation.evidenceStatus:(relation.origin==='product_policy'&&!relation.evidenceRefs.length?'verified':evidenceStatus(relation.evidenceRefs));
  for(const id of [relation.subjectId,relation.objectId])if(byId.get(id)?.type==='ArtifactRevision'&&sourceStates.get(id)?.status!=='verified')status=sourceStates.get(id)?.status??'unavailable';
  return {...relation,evidenceStatus:status};
 });
 const policies=bundle.policies.map(policy=>({...policy,reviewStatus:(evidenceStatus(policy.evidenceRefs)==='verified'||policy.origin==='product_policy'&&bundle.productPolicies.some(product=>product.id===policy.productPolicyId&&product.origin==='product_policy'&&product.sourceUrl&&product.decision))?policy.reviewStatus:'rejected' as const}));
 const verifiedAssignments=assignments.map(assignment=>{
  const revision=revisions.find(r=>r.id===assignment.approvedRevisionId),decision=decisions.find(d=>d.id===assignment.approvalDecisionId);
  const external=revision?.externalDesignation;
  const fictional=revision?.fictionalDesignation;
  // Local persona configuration keeps its checked source without inventing an approval.
  const fictionalValid=env.ALLOW_FICTIONAL_PERSONNEL==='true'&&persons.some(person=>person.id===assignment.personId&&person.fictional===true)&&revision?.state==='registered'&&!!fictional?.authorizationReference&&!!fictional.configurationId&&fictional.sourceSha256===revision.sourceSha256&&assignment.approvalDecisionId===undefined&&!external;
  // Only the installer can record external approval provenance. A missing named
  // in-app decision must never fall back to that initial-deployment exception.
  const approvalValid=assignment.approvalDecisionId!==undefined
   ? !!decision&&decision.revisionId===revision?.id&&decision.decision==='approve'&&decision.sourceSha256===revision?.sourceSha256
   : !!external&&!!external.approvalEvidenceId&&external.sourceSha256===revision?.sourceSha256&&external.confirmedBy===revision?.createdBy&&external.confirmedAt===revision?.createdAt&&Number.isFinite(Date.parse(external.confirmedAt))&&persons.some(person=>person.id===external.confirmedBy);
  const designationValid=assignment.basis==='fictional_configuration'?fictionalValid:revision?.state==='approved'&&approvalValid;
  const valid=revision&&designationValid&&sourceStates.get(revision.id)?.status==='verified'&&evidenceStatus(assignment.evidenceRefs)==='verified'&&assignment.evidenceRefs.every(ref=>ref.revisionId===revision.id&&ref.sourceSha256===revision.sourceSha256);
  return {...assignment,status:valid?assignment.status:'revoked' as const};
 });
 assertContext(context,await getKnowledgeContext(env));
 return {context,bundle,entities,relations:verifiedRelations,policies,assignments:verifiedAssignments,productPolicies:bundle.productPolicies};
}
export async function engineCall<T>(env:Env,path:string,input:unknown,context:KnowledgeContext):Promise<T> {
 let response:Response;
 try {
  const init={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(30000)};
  if(env.ENGINE) response=await env.ENGINE.get(env.ENGINE.idFromName('iso-knowledge-engine')).fetch(`http://engine${path}`,init);
  else if(env.ENGINE_URL && ['127.0.0.1','localhost','[::1]'].includes(new URL(env.ENGINE_URL).hostname)) response=await fetch(`${env.ENGINE_URL}${path}`,init);
  else throw new Error('Engine binding missing');
 } catch {throw new ApiError(503,'ENGINE_UNAVAILABLE','계산 엔진에 연결할 수 없습니다. 변경이나 대체 계산을 수행하지 않았습니다.')}
 let data:any;try{data=await response.json()}catch{throw new ApiError(503,'ENGINE_UNAVAILABLE','계산 엔진의 응답을 읽을 수 없습니다.')}
 if(response.status===422)throw new ApiError(422,'INVALID_ENGINE_REQUEST','조회 또는 권한 판정 입력을 확인해 주세요.',data);
 if(response.status===409) throw new ApiError(409,'QUERY_CONFLICT','조회 기준 또는 cursor가 변경되었습니다.',data);
 requireValue(response.ok && data?.engine?.name==='PyreWire' && data.engine?.version && data.engine?.rulesHash===context.rulesHash,503,'ENGINE_UNAVAILABLE','계산 엔진 또는 규칙 검증에 실패했습니다.');
 assertContext(data.context,context);return data;
}
export async function queryGraph(env:Env,context:KnowledgeContext,operation:GraphOperation,targetId?:string,cursor?:string):Promise<GraphResult> {
 const data=await snapshot(env,context);
 const {bundle:_bundle,...engineSnapshot}=data;
 const result=await engineCall<GraphResult>(env,'/query',{context,snapshot:engineSnapshot,query:{operation,...(targetId?{targetId}:{}),cursor}},context);
 assertContext(context,await getKnowledgeContext(env));return result;
}
type AuthorizationResource=DesignatedSource&{id?:string;typeIds:string[];revisionId?:string;currentRevisionId?:string;state:string;authorPersonId?:string;requesterPersonId?:string;reviewerPersonIds?:string[];ownerPersonId?:string;recipientPersonIds?:string[];implementerIds?:string[];auditedPersonIds?:string[];conditions?:Record<string,string|number|boolean>;approvalScope?:ApprovalScope};
export async function authorize(env:Env,actor:ActorContext,action:Action,resource:AuthorizationResource,context:KnowledgeContext):Promise<AuthorizationDecision> {
 return evaluateAuthorization(env,actor,action,resource,context,false);
}
export async function authorizeConditionConfirmation(env:Env,actor:ActorContext,action:'review'|'approve',resource:AuthorizationResource,context:KnowledgeContext):Promise<AuthorizationDecision&{purpose:'condition_confirmation'}> {
 const decision=await evaluateAuthorization(env,actor,action,resource,context,true);
 return {...decision,purpose:'condition_confirmation'};
}
async function evaluateAuthorization(env:Env,actor:ActorContext,action:Action,resource:AuthorizationResource,context:KnowledgeContext,conditionConfirmation:boolean):Promise<AuthorizationDecision> {
 const data=await snapshot(env,context);
 data.policies=data.policies.filter(p=>p.action===action && resource.typeIds.includes(p.resourceTypeId));
 if(!conditionConfirmation)data.policies=data.policies.filter(policy=>policy.approvalScope?policy.approvalScope===(resource.approvalScope??'outcome'):action!=='approve'||(resource.approvalScope??'outcome')==='outcome');
 data.policies=await restrictRecordDesignations(env,context,data.policies,actor.personId,resource);
 // Confirming a source fact must not require that fact (or another control) to
 // satisfy an approval outcome. Keep verified roles, scope, separation and exact
 // revision checks; only this private path omits value predicates for the proof.
 if(conditionConfirmation)data.policies=data.policies.map(policy=>{
  const {conditions:_conditions,...scopeCondition}=policy.scopeCondition;
  return {...policy,conditions:[],scopeCondition};
 });
 const personRow=await env.DB.prepare('SELECT body FROM persons WHERE id=?').bind(actor.personId).first<{body:string}>();
 const person=personRow?JSON.parse(personRow.body):null;
 const admin=!!person&&administratorAssignmentEligible(person,data.assignments);
 const {bundle:_bundle,...engineSnapshot}=data;
 const result=await engineCall<AuthorizationDecision>(env,'/authorize',{context,snapshot:engineSnapshot,actor:{...actor,isAdmin:actor.isAdmin&&admin,active:person?.active===true&&(person.fictional!==true||env.ALLOW_FICTIONAL_PERSONNEL==='true')},action,resource,now:new Date().toISOString()},context);
 assertContext(context,await getKnowledgeContext(env));return result;
}
export async function requireAuthorization(...args:Parameters<typeof authorize>) {
 const decision=await authorize(...args);requireValue(decision.allowed,403,'ACTION_DENIED',decision.reason);return decision;
}
