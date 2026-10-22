import type { ActorContext, AssignmentApplyInput, AssignmentResult, KnowledgeContext, Person, RoleAssignment } from '../../../packages/contracts/src/index';
import { canonical } from '../../../packages/knowledge/src/index';
import type { Artifact, Env, Revision } from '../types';
import { all, assertContext, commitMutation, event, get, getBundle, getKnowledgeContext, replay, update } from './storage';
import { readRevision, resourceFor } from './artifacts';
import { requireAuthorization, snapshot } from './engine';
import { ApiError, requireValue, textField } from './errors';
import { sha256 } from './markdown';
import { requestHash } from './requests';

const requiredColumns = ['personId', 'roleId', 'validFrom', 'validUntil', 'scopeKind', 'scopeIds'];
const columns = [...requiredColumns, 'delegatedFromAssignmentId', 'status', 'replacesAssignmentId', 'grantsAdmin'];
function timestamp(value:string) {
 const match=value.match(/^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/);
 const parsed=Date.parse(value);
 requireValue(match&&Number.isFinite(parsed)&&Number(match[2])>=1&&Number(match[2])<=12&&Number(match[3])>=1&&Number(match[3])<=new Date(Date.UTC(Number(match[1]),Number(match[2]),0)).getUTCDate(),422,'INVALID_ASSIGNMENT_PERIOD','기간은 유효한 날짜와 시간대를 포함한 ISO 시각이어야 합니다.');
 return parsed;
}
function cells(line:string) { return line.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(cell=>cell.trim()); }
async function candidateId(revisionId:string,line:number,quote:string) {
 const hash=await sha256(`${revisionId}\n${line}\n${quote}`);
 return `${hash.slice(0,8)}-${hash.slice(8,12)}-8${hash.slice(13,16)}-${((parseInt(hash[16],16)&3)|8).toString(16)}${hash.slice(17,20)}-${hash.slice(20,32)}`;
}

async function appointmentCandidates(env:Env,revisionId:string,context:KnowledgeContext) {
 const revision=await get<Revision>(env,'revisions',revisionId),artifact=await get<Artifact>(env,'artifacts',revision.artifactId),bundle=await getBundle(env,context);
 requireValue(artifact.kind==='record'&&artifact.recordTypeIds.some(id=>bundle.recordTypes.some(type=>type.id===id&&type.roleAssignment===true)),422,'NOT_APPOINTMENT_RECORD','역할 지정 기록 유형으로 등록된 자료만 적용할 수 있습니다.');
 requireValue(revision.state==='approved'&&artifact.effectiveRevisionId===revision.id&&artifact.workingRevisionId===revision.id,409,'APPOINTMENT_NOT_CURRENT_APPROVED','현재 작업본과 시행본이 같은 승인된 지정 기록이 필요합니다.');
 const decision=(await all<{id:string;revisionId:string;decision:string;sourceSha256:string}>(env,'decisions')).find(item=>item.revisionId===revision.id&&item.decision==='approve'&&item.sourceSha256===revision.sourceSha256);
 requireValue(decision,422,'APPOINTMENT_APPROVAL_MISSING','동일 원본 버전의 승인 결정 근거가 필요합니다.');
 const {markdown}=await readRevision(env,revision.id);
 const [persons,artifacts]=await Promise.all([all<Person>(env,'persons'),all<Artifact>(env,'artifacts')]);
 let effectiveAssignments:RoleAssignment[]|undefined;
 const assignments:RoleAssignment[]=[];let header:string[]|undefined;let fence:string|undefined;
 const lines=markdown.split('\n');
 for(let index=0;index<lines.length;index++){
  const line=lines[index],trimmed=line.trim();
  const delimiter=trimmed.match(/^(`{3,}|~{3,})/)?.[1];
  if(delimiter){if(!fence)fence=delimiter;else if(delimiter[0]===fence[0]&&delimiter.length>=fence.length)fence=undefined;header=undefined;continue}
  if(fence)continue;
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
  if(row.delegatedFromAssignmentId){
   effectiveAssignments??=(await snapshot(env,context)).assignments;
   let parentId=row.delegatedFromAssignmentId;const visited=new Set<string>();
   while(parentId){
    requireValue(!visited.has(parentId),422,'DELEGATION_CYCLE','순환 위임은 적용할 수 없습니다.');visited.add(parentId);
    const parent=effectiveAssignments.find(item=>item.id===parentId);
    requireValue(parent&&parent.status==='active'&&parent.roleId===row.roleId&&persons.some(person=>person.id===parent.personId&&person.active)&&timestamp(parent.validFrom)<=start&&(!parent.validUntil||end<=timestamp(parent.validUntil)),422,'INVALID_DELEGATION','기존 유효 지정의 근거·역할·기간 안에서만 위임할 수 있습니다.');
    requireValue(parent.scope.kind==='all'||parent.scope.kind===row.scopeKind&&ids.every(id=>parent.scope.ids.includes(id)),422,'DELEGATION_SCOPE_EXCEEDED','위임 범위는 기존 지정 범위를 넓힐 수 없습니다.');
    parentId=parent.delegatedFromAssignmentId??'';
   }
  }
  const assignment:RoleAssignment={id:await candidateId(revision.id,index+1,line),personId:row.personId,roleId:row.roleId,validFrom:row.validFrom,...(row.validUntil?{validUntil:row.validUntil}:{}),scope:{kind:row.scopeKind as RoleAssignment['scope']['kind'],ids},approvedRevisionId:revision.id,approvalDecisionId:decision.id,evidenceRefs:[{revisionId:revision.id,sourceSha256:revision.sourceSha256,lineStart:index+1,lineEnd:index+1,quote:line}],status:status as RoleAssignment['status'],...(row.replacesAssignmentId?{replacesAssignmentId:row.replacesAssignmentId}:{}),...(row.grantsAdmin?{grantsAdmin:row.grantsAdmin==='true'}:{}),...(row.delegatedFromAssignmentId?{delegatedFromAssignmentId:row.delegatedFromAssignmentId}:{})};
  assignments.push(assignment);
 }
 const adminPersons=assignments.filter(item=>item.grantsAdmin!==undefined).map(item=>item.personId);requireValue(new Set(adminPersons).size===adminPersons.length,422,'DUPLICATE_ADMIN_DESIGNATION','한 원문에서 직원별 관리자 지정은 한 번만 명시해 주세요.');
 requireValue(assignments.length>0,422,'ASSIGNMENT_TABLE_REQUIRED',`승인 원문에 ${requiredColumns.join('/')} 열의 역할 지정 표가 필요합니다.`);
 return {artifact,revision,assignments};
}

export async function listRoleAssignments(env:Env,actor:ActorContext) {
 requireValue(actor.isAdmin,403,'ADMIN_REQUIRED','관리자 자격이 필요합니다.');
 const context=await getKnowledgeContext(env),bundle=await getBundle(env,context);
 const [items,artifacts]=await Promise.all([all<RoleAssignment>(env,'assignments'),all<Artifact>(env,'artifacts')]);
 const candidates:Array<{artifactId:string;revisionId:string;assignments:RoleAssignment[];error?:string}>=[];
 for(const artifact of artifacts.filter(a=>a.kind==='record'&&a.recordTypeIds.some(id=>bundle.recordTypes.some(type=>type.id===id&&type.roleAssignment===true)))){
  const revision=await get<Revision>(env,'revisions',artifact.workingRevisionId);
  if(revision.state!=='approved')continue;
  try{const candidate=await appointmentCandidates(env,revision.id,context);candidates.push({artifactId:artifact.id,revisionId:revision.id,assignments:candidate.assignments})}
  catch(error){if(!(error instanceof ApiError))throw error;candidates.push({artifactId:artifact.id,revisionId:revision.id,assignments:[],error:error.message})}
 }
 assertContext(context,await getKnowledgeContext(env));return {items,candidates,context};
}

export async function applyRoleAssignment(env:Env,actor:ActorContext,input:AssignmentApplyInput):Promise<AssignmentResult> {
 requireValue(actor.isAdmin,403,'ADMIN_REQUIRED','관리자 자격이 필요합니다.');
 const key=textField(input.requestKey,'requestKey',200),hash=await requestHash('assignment.apply',input);const prior=await replay(env,actor,key,hash);if(prior!==undefined)return prior;
 const context=await getKnowledgeContext(env);assertContext(input.expectedContext,context);
 requireValue(Array.isArray(input.assignments)&&input.assignments.length>0,422,'ASSIGNMENTS_REQUIRED','대조한 지정 후보를 선택해 주세요.');
 const {artifact,revision,assignments}=await appointmentCandidates(env,textField(input.revisionId,'revisionId'),context);
 requireValue(new Set(input.assignments.map(item=>item.id)).size===input.assignments.length&&input.assignments.every(item=>assignments.some(candidate=>canonical(candidate)===canonical(item))),422,'ASSIGNMENT_CANDIDATE_MISMATCH','적용 값이 승인된 원문의 지정 후보와 일치하지 않습니다.');
 const authorization=await requireAuthorization(env,actor,'apply_assignment',resourceFor(artifact,revision),context);
 const existing=await all<RoleAssignment>(env,'assignments');requireValue(input.assignments.every(item=>!existing.some(old=>old.id===item.id)),409,'ASSIGNMENT_ALREADY_APPLIED','이미 적용한 지정입니다.');
 const replaced=input.assignments.filter(item=>item.replacesAssignmentId).map(item=>item.replacesAssignmentId!);requireValue(new Set(replaced).size===replaced.length,422,'DUPLICATE_REPLACEMENT','같은 기존 지정을 두 번 변경할 수 없습니다.');
 const statements:D1PreparedStatement[]=[];
 for(const item of input.assignments){
  if(item.replacesAssignmentId){const old=existing.find(assignment=>assignment.id===item.replacesAssignmentId)!;statements.push(update(env,'assignments',old.id,{...old,status:'revoked'}))}
  if(item.grantsAdmin!==undefined){const person=await get<Person>(env,'persons',item.personId);statements.push(update(env,'persons',person.id,{...person,isAdmin:item.grantsAdmin,adminAssignmentId:item.grantsAdmin?item.id:null}))}
 }
 const result:AssignmentResult={assignmentIds:input.assignments.map(item=>item.id),context:{...context,dataRevision:context.dataRevision+1,authorityRevision:context.authorityRevision+1}};
 return commitMutation(env,actor,key,hash,context,result,[...statements,...input.assignments.map(item=>env.DB.prepare('INSERT INTO assignments(id,body) VALUES (?,?)').bind(item.id,JSON.stringify(item))),event(env,artifact.id,{kind:'role_assignments_applied',revisionId:revision.id,assignmentIds:result.assignmentIds,actorId:actor.personId,context,authorization})],{authorityRevision:result.context.authorityRevision});
}
