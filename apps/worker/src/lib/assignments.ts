import type { ActorContext, AppointmentSourceCandidate, AssignmentApplyInput, AssignmentMapping, AssignmentResult, AuthorizationDecision, KnowledgeContext, Person, RoleAssignment } from '../../../packages/contracts/src/index';
import { canonical } from '../../../packages/knowledge/src/index';
import type { Artifact, Env, Revision } from '../types';
import { all, assertContext,assertExpectedContext, commitMutation, event, get, getBundle, getKnowledgeContext, replay, update } from './storage';
import { readRevision, resourceFor } from './artifacts';
import { authorize, requireAuthorization } from './engine';
import { ApiError, requireValue, textField } from './errors';
import { appointmentSourceCandidates, candidateId, cells, fenceAfter } from './appointment-source';
import { requestHash } from './requests';

const requiredColumns = ['personId', 'roleId', 'validFrom', 'validUntil', 'scopeKind', 'scopeIds'];
const columns = [...requiredColumns, 'delegatedFromAssignmentId', 'status', 'replacesAssignmentId', 'grantsAdmin'];
function timestamp(value:string) {
 const match=value.match(/^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/);
 const parsed=Date.parse(value);
 requireValue(match&&Number.isFinite(parsed)&&Number(match[2])>=1&&Number(match[2])<=12&&Number(match[3])>=1&&Number(match[3])<=new Date(Date.UTC(Number(match[1]),Number(match[2]),0)).getUTCDate(),422,'INVALID_ASSIGNMENT_PERIOD','기간은 유효한 날짜와 시간대를 포함한 ISO 시각이어야 합니다.');
 return parsed;
}


type AppointmentData={bundle:Awaited<ReturnType<typeof getBundle>>;persons:Person[];artifacts:Artifact[];decisions:{id:string;revisionId:string;decision:string;sourceSha256:string}[]};
/** Loaded once per request and shared by every appointment record it inspects. */
async function appointmentData(env:Env,context:KnowledgeContext):Promise<AppointmentData> {
 const [bundle,persons,artifacts,decisions]=await Promise.all([getBundle(env,context),all<Person>(env,'persons'),all<Artifact>(env,'artifacts'),all<AppointmentData['decisions'][number]>(env,'decisions')]);
 return {bundle,persons,artifacts,decisions};
}
async function appointmentCandidates(env:Env,revisionId:string,{bundle,persons,artifacts,decisions}:AppointmentData) {
 const revision=await get<Revision>(env,'revisions',revisionId),artifact=await get<Artifact>(env,'artifacts',revision.artifactId);
 requireValue(artifact.kind==='record'&&artifact.recordTypeIds.some(id=>bundle.recordTypes.some(type=>type.id===id&&type.roleAssignment===true)),422,'NOT_APPOINTMENT_RECORD','역할 지정 기록 유형으로 등록된 자료만 적용할 수 있습니다.');
 requireValue(revision.state==='approved'&&artifact.effectiveRevisionId===revision.id&&artifact.workingRevisionId===revision.id,409,'APPOINTMENT_NOT_CURRENT_APPROVED','현재 작업본과 시행본이 같은 승인된 지정 기록이 필요합니다.');
 const decision=decisions.find(item=>item.revisionId===revision.id&&item.decision==='approve'&&item.sourceSha256===revision.sourceSha256);
 requireValue(decision,422,'APPOINTMENT_APPROVAL_MISSING','동일 원본 버전의 승인 결정 근거가 필요합니다.');
 const {markdown}=await readRevision(env,revision.id);
 const sourceCandidates=await appointmentSourceCandidates(markdown,revision,persons);
 const machineAssignments=async()=>{
 const assignments:RoleAssignment[]=[];let header:string[]|undefined;let fence='';
 const lines=markdown.split('\n');
 for(let index=0;index<lines.length;index++){
  const line=lines[index],trimmed=line.trim();
  const next=fenceAfter(line,fence);
  if(fence||next){fence=next;header=undefined;continue}
  if(!trimmed.startsWith('|')){header=undefined;continue}
  const values=cells(line);
  if(values.includes('personId')&&values.includes('roleId')){
   requireValue(requiredColumns.every(name=>values.includes(name))&&new Set(values).size===values.length&&values.every(name=>columns.includes(name)),422,'INVALID_ASSIGNMENT_TABLE','역할 지정 표의 열 이름과 중복 여부를 확인해 주세요.');
   header=values;continue;
  }
  if(!header||values.every(value=>/^:?-+:?$/.test(value)))continue;
  requireValue(values.length<=header.length,422,'INVALID_ASSIGNMENT_TABLE','표 행의 열 수가 머리글과 일치하지 않습니다.');
  const row=Object.fromEntries(header.map((name,i)=>[name,values[i]??'']));
  requireValue(persons.some(person=>person.id===row.personId&&person.active),422,'UNKNOWN_ASSIGNMENT_PERSON','유효한 실제 직원 ID를 지정해 주세요.');
  requireValue(bundle.roles.some(role=>role.id===row.roleId),422,'UNKNOWN_ASSIGNMENT_ROLE','릴리스에 정의된 기능상 역할 ID를 지정해 주세요.');
  const status=row.status||'active';requireValue(['active','revoked'].includes(status),422,'INVALID_ASSIGNMENT_STATUS','지정 상태는 active 또는 revoked입니다.');
  requireValue(!row.grantsAdmin||['true','false'].includes(row.grantsAdmin),422,'INVALID_ADMIN_DESIGNATION','관리자 지정은 명시적인 true 또는 false여야 합니다.');
  requireValue(status!=='revoked'||!!row.replacesAssignmentId,422,'REVOCATION_TARGET_REQUIRED','철회할 기존 지정 ID가 필요합니다.');
  requireValue(!(status==='revoked'&&row.grantsAdmin==='true'),422,'INVALID_ADMIN_DESIGNATION','철회된 지정으로 관리자 자격을 부여할 수 없습니다.');
  if(row.replacesAssignmentId){
   const old=await get<RoleAssignment>(env,'assignments',row.replacesAssignmentId);
   requireValue(old.status==='active'&&old.personId===row.personId&&old.roleId===row.roleId,422,'REPLACEMENT_TARGET_MISMATCH','변경 대상은 같은 직원·역할의 기존 활성 지정이어야 합니다.');
  }
  const start=timestamp(row.validFrom),end=row.validUntil?timestamp(row.validUntil):Infinity;
  requireValue(end>start,422,'INVALID_ASSIGNMENT_PERIOD','종료 시각은 시작 시각 이후여야 합니다.');
  requireValue(['all','system','resource'].includes(row.scopeKind),422,'INVALID_ASSIGNMENT_SCOPE','지정 범위 유형을 확인해 주세요.');
  requireValue(row.grantsAdmin!=='true'||row.scopeKind==='all',422,'ADMIN_SCOPE_REQUIRED','관리자 진입 자격은 전체 범위의 명시적 지정이 필요합니다.');
  const ids=row.scopeIds?row.scopeIds.split(',').map(id=>id.trim()):[];
  requireValue(new Set(ids).size===ids.length&&ids.every(Boolean)&&(row.scopeKind==='all'?ids.length===0:ids.length>0),422,'INVALID_ASSIGNMENT_SCOPE','전체 범위는 ID를 비우고, 한정 범위는 중복 없는 대상 ID를 지정해 주세요.');
  if(row.scopeKind==='system')requireValue(ids.every(id=>bundle.entities.some(entity=>entity.id===id&&entity.type==='AISystem')),422,'UNKNOWN_ASSIGNMENT_SCOPE','등록된 시스템 ID가 필요합니다.');
  if(row.scopeKind==='resource')requireValue(ids.every(id=>artifacts.some(artifact=>artifact.id===id)),422,'UNKNOWN_ASSIGNMENT_SCOPE','등록된 자료 ID가 필요합니다.');
  requireValue(!row.delegatedFromAssignmentId,422,'DELEGATION_NOT_SUPPORTED','위임 권한은 현재 시스템에서 지원하지 않습니다.');
  const assignment:RoleAssignment={id:await candidateId(revision.id,index+1,line),personId:row.personId,roleId:row.roleId,validFrom:row.validFrom,...(row.validUntil?{validUntil:row.validUntil}:{}),scope:{kind:row.scopeKind as RoleAssignment['scope']['kind'],ids},approvedRevisionId:revision.id,approvalDecisionId:decision.id,evidenceRefs:[{revisionId:revision.id,sourceSha256:revision.sourceSha256,lineStart:index+1,lineEnd:index+1,quote:line}],status:status as RoleAssignment['status'],...(row.replacesAssignmentId?{replacesAssignmentId:row.replacesAssignmentId}:{}),...(row.grantsAdmin?{grantsAdmin:row.grantsAdmin==='true'}:{}),...(row.delegatedFromAssignmentId?{delegatedFromAssignmentId:row.delegatedFromAssignmentId}:{})};
  assignments.push(assignment);
 }
 const adminPersons=assignments.filter(item=>item.grantsAdmin!==undefined).map(item=>item.personId);requireValue(new Set(adminPersons).size===adminPersons.length,422,'DUPLICATE_ADMIN_DESIGNATION','한 원문에서 직원별 관리자 지정은 한 번만 명시해 주세요.');
  return assignments;
 };
 // A broken machine table must not hide the Korean candidates of the same record; the machine path still reports it.
 let assignments:RoleAssignment[]=[],assignmentsError:ApiError|undefined;
 try{assignments=await machineAssignments()}catch(error){if(!(error instanceof ApiError)||!sourceCandidates.length)throw error;assignmentsError=error}
 requireValue(assignments.length>0||sourceCandidates.length>0,422,'ASSIGNMENT_TABLE_REQUIRED',`승인 원문에 ${requiredColumns.join('/')} 열의 역할 지정 표가 필요합니다.`);
 return {artifact,revision,assignments,assignmentsError,sourceCandidates,decision};
}

async function mappedAssignments(actor:ActorContext,revision:Revision,decisionId:string,candidates:AppointmentSourceCandidate[],mappings:AssignmentMapping[],requestKey:string,{persons,artifacts,bundle}:AppointmentData,existing:RoleAssignment[]) {
 const result:RoleAssignment[]=[],seen=new Set<string>();
 const sameScope=(a:RoleAssignment['scope'],b:RoleAssignment['scope'])=>a.kind===b.kind&&canonical([...a.ids].sort())===canonical([...b.ids].sort());
 for(const mapping of mappings){
  requireValue(mapping&&typeof mapping==='object'&&Object.keys(mapping).every(key=>['candidateId','personId','roleIds','validFrom','validUntil','scope','reason','replacesAssignmentIds'].includes(key)),422,'INVALID_ASSIGNMENT_MAPPING','한글 대조 입력에 허용되지 않은 필드가 있습니다.');
  const candidate=candidates.find(item=>item.id===mapping.candidateId);
  requireValue(candidate&&!candidate.blockedReason&&candidate.kind==='appointment',422,'ASSIGNMENT_SOURCE_BLOCKED',candidate?.blockedReason??'유효한 원문 후보를 선택해 주세요.');
  requireValue(candidate.personIds.includes(mapping.personId)&&persons.some(person=>person.id===mapping.personId&&person.active),422,'ASSIGNMENT_NAME_MISMATCH','선택한 직원의 이름이 원문 담당자와 일치하지 않습니다.');
  requireValue(mapping.validFrom===candidate.validFrom&&(mapping.validUntil||undefined)===candidate.validUntil,422,'ASSIGNMENT_DATE_MISMATCH','기간은 원문의 지정·해제일과 같은 한국 표준시 시각이어야 합니다.');
  const start=timestamp(mapping.validFrom),end=mapping.validUntil?timestamp(mapping.validUntil):Infinity;
  requireValue(end>start,422,'INVALID_ASSIGNMENT_PERIOD','종료 시각은 시작 시각 이후여야 합니다.');
  requireValue(Array.isArray(mapping.roleIds)&&mapping.roleIds.length>0&&new Set(mapping.roleIds).size===mapping.roleIds.length&&mapping.roleIds.every(id=>bundle.roles.some(role=>role.id===id)),422,'UNKNOWN_ASSIGNMENT_ROLE','현재 릴리스의 중복 없는 역할을 선택해 주세요.');
  const scope=mapping.scope;
  requireValue(scope&&['all','system','resource'].includes(scope.kind)&&Array.isArray(scope.ids)&&scope.ids.every(id=>typeof id==='string'&&id.length>0)&&new Set(scope.ids).size===scope.ids.length&&(scope.kind==='all'?scope.ids.length===0:scope.ids.length>0),422,'INVALID_ASSIGNMENT_SCOPE','전체 또는 명시적인 시스템·자료 범위를 지정해 주세요.');
  if(scope.kind==='system')requireValue(scope.ids.every(id=>bundle.entities.some(entity=>entity.id===id&&entity.type==='AISystem')),422,'UNKNOWN_ASSIGNMENT_SCOPE','등록된 시스템이 필요합니다.');
  if(scope.kind==='resource')requireValue(scope.ids.every(id=>artifacts.some(artifact=>artifact.id===id)),422,'UNKNOWN_ASSIGNMENT_SCOPE','등록된 자료가 필요합니다.');
  const reason=textField(mapping.reason,'역할·범위 대응 사유',2000),replacements=mapping.replacesAssignmentIds??{};
  requireValue(replacements&&typeof replacements==='object'&&!Array.isArray(replacements)&&Object.keys(replacements).every(role=>mapping.roleIds.includes(role)),422,'REPLACEMENT_TARGET_MISMATCH','교체 대상의 역할을 확인해 주세요.');
  for(const roleId of mapping.roleIds){
   const identity=canonical([mapping.personId,roleId,scope.kind,[...scope.ids].sort()]);
   requireValue(!seen.has(identity),422,'DUPLICATE_ASSIGNMENT_MAPPING','같은 직원·역할·범위를 두 번 대조할 수 없습니다.');seen.add(identity);
   const replacesAssignmentId=replacements[roleId];
   if(replacesAssignmentId){const old=existing.find(item=>item.id===replacesAssignmentId);requireValue(old&&old.status==='active'&&old.personId===mapping.personId&&old.roleId===roleId&&!old.grantsAdmin,422,'REPLACEMENT_TARGET_MISMATCH','같은 직원·역할의 활성 지정만 교체할 수 있으며 관리자 지정은 이 경로에서 교체할 수 없습니다.');}
   requireValue(!existing.some(item=>item.status==='active'&&item.personId===mapping.personId&&item.roleId===roleId&&sameScope(item.scope,scope)&&item.id!==replacesAssignmentId),409,'ASSIGNMENT_DUPLICATE_ACTIVE','이미 유효한 지정입니다. 생략하거나 명시적으로 기존 지정을 교체해 주세요.');
   // The request key keeps a revoked mapping re-appliable by a new request; active duplicates are refused above.
   result.push({id:await candidateId(revision.id,candidate.evidenceRefs[0].lineStart,canonical([candidate.id,identity,mapping.validFrom,mapping.validUntil??null,requestKey])),personId:mapping.personId,roleId,scope:{kind:scope.kind,ids:[...scope.ids].sort()},validFrom:mapping.validFrom,...(mapping.validUntil?{validUntil:mapping.validUntil}:{}),approvedRevisionId:revision.id,approvalDecisionId:decisionId,evidenceRefs:candidate.evidenceRefs,status:'active',...(replacesAssignmentId?{replacesAssignmentId}:{}),adminMapping:{candidateId:candidate.id,actorId:actor.personId,at:new Date().toISOString(),reason}});
  }
 }
 return result;
}

export async function listRoleAssignments(env:Env,actor:ActorContext) {
 const context=await getKnowledgeContext(env),[data,items]=await Promise.all([appointmentData(env,context),all<RoleAssignment>(env,'assignments')]),{bundle,artifacts}=data;
 const candidates:Array<{artifactId:string;revisionId:string;assignments:RoleAssignment[];sourceCandidates?:AppointmentSourceCandidate[];authorization?:AuthorizationDecision;error?:string}>=[];
 for(const artifact of artifacts.filter(a=>a.kind==='record'&&a.recordTypeIds.some(id=>bundle.recordTypes.some(type=>type.id===id&&type.roleAssignment===true)))){
  const revision=await get<Revision>(env,'revisions',artifact.workingRevisionId);
  if(revision.state!=='approved')continue;
  try{const candidate=await appointmentCandidates(env,revision.id,data),authorization=await authorize(env,actor,'apply_assignment',resourceFor(artifact,revision),context);candidates.push({artifactId:artifact.id,revisionId:revision.id,assignments:candidate.assignments,sourceCandidates:candidate.sourceCandidates,authorization,...(candidate.assignmentsError?{error:candidate.assignmentsError.message}:{})})}
  catch(error){if(!(error instanceof ApiError)||error.status>=500)throw error;candidates.push({artifactId:artifact.id,revisionId:revision.id,assignments:[],error:error.message})}
 }
 assertContext(context,await getKnowledgeContext(env));return {items,candidates,context,persons:data.persons,roles:bundle.roles,systems:bundle.entities.filter(entity=>entity.type==='AISystem'),resources:artifacts.map(({id,title})=>({id,title}))};
}

export async function applyRoleAssignment(env:Env,actor:ActorContext,input:AssignmentApplyInput):Promise<AssignmentResult> {
 const key=textField(input.requestKey,'requestKey',200),hash=await requestHash('assignment.apply',input);const prior=await replay(env,actor,key,hash);if(prior!==undefined)return prior;
 const context=await getKnowledgeContext(env);assertExpectedContext(input.expectedContext,context);
 requireValue((Array.isArray(input.assignments)&&input.assignments.length>0&&input.mappedAssignments===undefined)||(Array.isArray(input.mappedAssignments)&&input.mappedAssignments.length>0&&input.assignments===undefined),422,'ASSIGNMENTS_REQUIRED','기계용 후보 또는 한글 대조값 중 하나를 선택해 주세요.');
 const [data,existing]=await Promise.all([appointmentData(env,context),all<RoleAssignment>(env,'assignments')]);
 const {artifact,revision,assignments,assignmentsError,sourceCandidates,decision}=await appointmentCandidates(env,textField(input.revisionId,'revisionId'),data);
 if(!input.mappedAssignments&&assignmentsError)throw assignmentsError;
 const selected=input.mappedAssignments?await mappedAssignments(actor,revision,decision.id,sourceCandidates,input.mappedAssignments,key,data,existing):input.assignments!;
 if(!input.mappedAssignments)requireValue(new Set(input.assignments!.map(item=>item.id)).size===input.assignments!.length&&input.assignments!.every(item=>assignments.some(candidate=>canonical(candidate)===canonical(item))),422,'ASSIGNMENT_CANDIDATE_MISMATCH','적용 값이 승인된 원문의 지정 후보와 일치하지 않습니다.');
 const authorization=await requireAuthorization(env,actor,'apply_assignment',resourceFor(artifact,revision),context);
 requireValue(selected.every(item=>!existing.some(old=>old.id===item.id)),409,'ASSIGNMENT_ALREADY_APPLIED','이미 적용한 지정입니다.');
 const replaced=selected.filter(item=>item.replacesAssignmentId).map(item=>item.replacesAssignmentId!);requireValue(new Set(replaced).size===replaced.length,422,'DUPLICATE_REPLACEMENT','같은 기존 지정을 두 번 변경할 수 없습니다.');
 const statements:D1PreparedStatement[]=[];
 for(const item of selected){
  if(item.replacesAssignmentId){const old=existing.find(assignment=>assignment.id===item.replacesAssignmentId)!;statements.push(update(env,'assignments',old.id,{...old,status:'revoked'}))}
  if(item.grantsAdmin!==undefined){const person=await get<Person>(env,'persons',item.personId);statements.push(update(env,'persons',person.id,{...person,isAdmin:item.grantsAdmin,adminAssignmentId:item.grantsAdmin?item.id:null}))}
 }
 const result:AssignmentResult={assignmentIds:selected.map(item=>item.id),context:{...context,dataRevision:context.dataRevision+1,authorityRevision:context.authorityRevision+1}};
 return commitMutation(env,actor,key,hash,context,result,[...statements,...selected.map(item=>env.DB.prepare('INSERT INTO assignments(id,body) VALUES (?,?)').bind(item.id,JSON.stringify(item))),event(env,artifact.id,{kind:'role_assignments_applied',revisionId:revision.id,assignmentIds:result.assignmentIds,actorId:actor.personId,context,authorization})],{authorityRevision:result.context.authorityRevision});
}
