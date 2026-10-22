import type {Env,Artifact,Revision} from '../types';
import type {RoleAssignment} from '../../../packages/contracts/src/index';
import {canonical} from '../../../packages/knowledge/src/index';
import {all,getBundle,getKnowledgeContext} from './storage';
import {parseMarkdown,sha256} from './markdown';
import {requireValue} from './errors';

export interface FictionalPersonnelInput {
 fictional:true;configurationId:string;authorizedAt:string;authorizationReference:string;
 persons:Array<{personaId:string;name:string;department:string;jobTitle:string;reportsTo:string|null;admin:boolean;roles:Array<{name:string;scope:'all'|'edu-score'}>}>;
 sources:Array<{kind:'company_profile'|'personas'|'assignment_configuration';path:string;title:string;markdown:string}>;
}
async function stableId(value:string){const h=await sha256(value);return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`}

// Deployment-only setup for explicitly enabled local or remote demos; no ERP HTTP route.
export async function provisionFictionalPersonnel(env:Env,input:FictionalPersonnelInput){
 requireValue(env.ALLOW_FICTIONAL_PERSONNEL==='true'&&input.fictional===true,403,'FICTIONAL_SETUP_DISABLED','가상 구성원 설치가 허용된 데모 환경이 아닙니다.');
 requireValue(input.configurationId&&Number.isFinite(Date.parse(input.authorizedAt))&&/^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+(?:#issuecomment-\d+)?$/.test(input.authorizationReference),422,'PERSONNEL_AUTHORIZATION','사용자가 요청한 가상 구성의 출처와 적용 시점이 필요합니다.');
 const inputHash=await sha256(canonical(input)),eventId=await stableId(`fictional-personnel:${input.configurationId}`);
 const prior=(await all<any>(env,'events')).find(event=>event.id===eventId);
 if(prior){requireValue(prior.inputHash===inputHash,409,'PERSONNEL_CONFIGURATION_CHANGED','같은 구성 ID의 내용이 바뀌었습니다. 기존 지정을 덮어쓰지 않습니다.');return {...prior.result,alreadyApplied:true}}
 const context=await getKnowledgeContext(env),bundle=await getBundle(env,context);
 requireValue((await all(env,'persons')).length===0&&(await all(env,'assignments')).length===0,409,'PERSONNEL_EXISTS','이미 직원·역할 지정이 있습니다. 초기 구성으로 덮어쓰지 않습니다.');
 requireValue(input.persons.length>0&&new Set(input.persons.map(p=>p.personaId)).size===input.persons.length&&input.persons.filter(p=>p.admin).length===1,422,'PERSONNEL_LIST','중복 없는 구성원과 최초 관리자 한 명이 필요합니다.');
 requireValue(input.sources.length===3&&new Set(input.sources.map(s=>s.kind)).size===3,422,'PERSONNEL_SOURCES','회사소개서·페르소나·역할 구성표가 필요합니다.');
 const sources=await Promise.all(input.sources.map(async source=>{
  const parsed=await parseMarkdown(source.path.split('/').at(-1)!,new TextEncoder().encode(source.markdown));
  const artifactId=await stableId(`${input.configurationId}:${source.kind}`),revisionId=await stableId(`${artifactId}:${parsed.sha256}`);
  const artifact:Artifact={id:artifactId,documentCode:`DEMO-${input.configurationId}-${source.kind}`,title:`[가상 조직 설정] ${source.title}`,kind:'record',recordTypeIds:[],workingRevisionId:revisionId,effectiveRevisionId:null,systemIds:[]};
  const revision:Revision={id:revisionId,artifactId,filename:source.path.split('/').at(-1)!,sourceSha256:parsed.sha256,textSha256:parsed.textSha256,objectKey:`sources/${revisionId}/${parsed.sha256}.md`,textKey:`text/${revisionId}/${parsed.textSha256}.txt`,state:'registered',createdAt:input.authorizedAt,createdBy:'fictional-personnel-configuration',previousRevisionId:null,templateRevisionIds:[],systemIds:[],conditions:{},fieldMappings:{},evidenceStatus:'verified',fictionalDesignation:{authorizationReference:input.authorizationReference,sourceSha256:parsed.sha256,configurationId:input.configurationId}};
  return {source,parsed,artifact,revision};
 }));
 const configuration=sources.find(s=>s.source.kind==='assignment_configuration')!,personas=sources.find(s=>s.source.kind==='personas')!;
 const ids=new Map(await Promise.all(input.persons.map(async p=>[p.personaId,await stableId(`aidu-person:${p.personaId}`)] as const)));
 const systems=bundle.entities.filter(e=>e.type==='AISystem'&&e.label==='Edu Score');
 const statements:D1PreparedStatement[]=[],assignments:RoleAssignment[]=[];
 for(const person of input.persons){
  requireValue(person.name.trim()&&person.department.trim()&&person.jobTitle.trim()&&person.roles.length>0&&(!person.reportsTo||ids.has(person.reportsTo))&&person.reportsTo!==person.personaId,422,'PERSONNEL_FIELDS','직무·보고 체계·역할을 확인해 주세요.');
  const path=new Set<string>();let manager:string|null=person.personaId;while(manager){requireValue(!path.has(manager),422,'REPORTING_CYCLE','보고 체계에 순환이 있습니다.');path.add(manager);manager=input.persons.find(p=>p.personaId===manager)!.reportsTo}
  const match=(markdown:string)=>markdown.split('\n').findIndex(line=>line.startsWith(`| ${person.personaId} |`)&&line.split('|')[2]?.trim()===person.name);
  const line=match(configuration.parsed.markdown);requireValue(line>=0&&match(personas.parsed.markdown)>=0,422,'PERSONNEL_SOURCE_MISMATCH','이름·ID가 원문 구성원 표와 다릅니다.');
  const evidence={revisionId:configuration.revision.id,sourceSha256:configuration.parsed.sha256,lineStart:line+1,lineEnd:line+1,quote:configuration.parsed.markdown.split('\n')[line]};
  const cells=evidence.quote.split('|').slice(1,-1).map(cell=>cell.trim()),managerName=person.reportsTo?`${person.reportsTo} ${input.persons.find(p=>p.personaId===person.reportsTo)!.name}`:'없음';
  const expectedRoles=person.roles.map(role=>`${role.name}${role.scope==='edu-score'?'(Edu Score)':''}`).sort();
  requireValue(cells.length===8&&cells[2]===person.department&&cells[3]===person.jobTitle&&cells[4]===managerName&&cells[6]===(person.admin?'예':'아니오')&&canonical(cells[5].split(',').map(role=>role.trim()).sort())===canonical(expectedRoles),422,'PERSONNEL_SOURCE_MISMATCH','구성표의 소속·직책·보고 대상·역할 범위·운영자 지정이 입력과 다릅니다.');
  const roleIds=new Set<string>();let adminAssignmentId:string|undefined;
  for(const role of person.roles){
   const definition=bundle.roles.find(r=>r.name===role.name);requireValue(definition&&!roleIds.has(definition.id)&&evidence.quote.includes(role.name),422,'PERSONNEL_ROLE','원문 구성표와 현재 규정에 정의된 역할을 확인해 주세요.');roleIds.add(definition.id);
   requireValue(role.scope==='all'||role.scope==='edu-score'&&systems.length===1,422,'PERSONNEL_SCOPE','역할 범위와 Edu Score 대상을 확인해 주세요.');
   const id=await stableId(`${input.configurationId}:${person.personaId}:${definition.id}`),grantsAdmin=person.admin&&role.scope==='all'&&!adminAssignmentId;if(grantsAdmin)adminAssignmentId=id;
   assignments.push({id,personId:ids.get(person.personaId)!,roleId:definition.id,scope:role.scope==='all'?{kind:'all',ids:[]}:{kind:'system',ids:[systems[0].id]},validFrom:input.authorizedAt,approvedRevisionId:configuration.revision.id,evidenceRefs:[evidence],status:'active',basis:'fictional_configuration',...(grantsAdmin?{grantsAdmin:true}:{})});
  }
  requireValue(!person.admin||adminAssignmentId,422,'PERSONNEL_ADMIN_SCOPE','최초 관리자의 전사 범위 기능 역할이 필요합니다.');
  statements.push(env.DB.prepare('INSERT INTO persons VALUES(?,?)').bind(ids.get(person.personaId)!,JSON.stringify({id:ids.get(person.personaId),name:person.name,active:true,fictional:true,personaId:person.personaId,department:person.department,jobTitle:person.jobTitle,reportsToId:person.reportsTo?ids.get(person.reportsTo):null,isAdmin:person.admin,adminAssignmentId,evidenceRefs:[evidence],operatorDesignation:person.admin?{basis:'fictional_configuration',authorizationReference:input.authorizationReference,designatedAt:input.authorizedAt}:undefined})));
 }
 for(const source of sources){
  const {revision,artifact,parsed}=source;
  statements.push(env.DB.prepare('INSERT INTO artifacts VALUES(?,?,?,?)').bind(artifact.id,artifact.documentCode,artifact.kind,JSON.stringify(artifact)),env.DB.prepare('INSERT INTO revisions VALUES(?,?,?)').bind(revision.id,artifact.id,JSON.stringify(revision)));
  for(const [key,value] of [[revision.objectKey,source.source.markdown],[revision.textKey,parsed.markdown]]){const existing=await env.SOURCES.get(key);requireValue(!existing||await existing.text()===value,409,'PERSONNEL_SOURCE_CHANGED','동일한 원본 객체의 내용이 다릅니다.');if(!existing)await env.SOURCES.put(key,value)}
 }
 for(const assignment of assignments)statements.push(env.DB.prepare('INSERT INTO assignments VALUES(?,?)').bind(assignment.id,JSON.stringify(assignment)));
 const result={configurationId:input.configurationId,personCount:input.persons.length,assignmentCount:assignments.length,roleCount:new Set(assignments.map(a=>a.roleId)).size,administrator:input.persons.find(p=>p.admin)!.personaId,fictional:true,companyApprovalCreated:false,context:{...context,dataRevision:context.dataRevision+1,authorityRevision:context.authorityRevision+1}};
 statements.push(env.DB.prepare('INSERT INTO events VALUES(?,?,?)').bind(eventId,null,JSON.stringify({id:eventId,kind:'fictional_personnel_configured',at:new Date().toISOString(),authorizationReference:input.authorizationReference,inputHash,result})),env.DB.prepare('UPDATE context SET data_revision=data_revision+1,authority_revision=authority_revision+1 WHERE id=1'));
 // A failed condition deliberately collides with the existing primary key inside the same batch.
 const fence=env.DB.prepare('INSERT INTO context SELECT * FROM context WHERE id=1 AND (release_id<>? OR data_revision<>? OR authority_revision<>? OR rules_hash<>? OR EXISTS(SELECT 1 FROM persons) OR EXISTS(SELECT 1 FROM assignments))').bind(context.releaseId,context.dataRevision,context.authorityRevision,context.rulesHash);
 const committed=await env.DB.batch([fence,...statements]);requireValue(committed.every(r=>r.success),500,'PERSONNEL_INSTALL_FAILED','가상 구성 등록을 완료하지 못했습니다.');
 return {...result,alreadyApplied:false};
}
