import {DRAFT_ONLY,hash,metadata,type Inventory,type InventoryRow,type Target} from './inventory';
import type {Client,Http} from './client';
import {permissionCandidates,type PermissionOracle} from './permissions';
import type {RecordType} from '../../packages/contracts/src/index';

export async function prepareInventory(input:{target:Target;baseUrl:string;http:Http;client:Client;oracle:PermissionOracle;oraclePath:string;oracleSha256:string;policySha256:string;sources:Array<{path:string;bytes:Uint8Array}>}):Promise<Inventory> {
 const {http,client,oracle}=input;
 const context=(await http('/api/me',{client})).body.context,persons=(await http('/api/persons',{client})).body.items;
 const entities=(await http('/api/entities',{client})).body.items;
 const recordTypes:RecordType[]=entities.filter((entity:any)=>entity.type==='RecordType').map((entity:any)=>entity.metadata);
 const templates=new Map<string,string>(),rows:InventoryRow[]=[];
 for(const source of input.sources){
  const meta=metadata(source.bytes),text=new TextDecoder().decode(source.bytes),type=recordTypes.find(type=>type.code===meta.form_id),issues:string[]=[];
  const caseScopes=[...new Set(oracle.rows.filter(row=>row.formCode===meta.form_id).flatMap(row=>(row.recordCases??[]).filter(item=>item.informationId===meta.information_id&&item.sourcePath===source.path&&item.sourceSha256===hash(source.bytes)).map(item=>item.systemCode)))];
  if(caseScopes.length>1)issues.push('Conflicting target systems in independent record cases');
  const systemCode=meta.system_id??meta.target_system??(caseScopes.length===1?caseScopes[0]:''),system=entities.find((entity:any)=>entity.type==='AISystem'&&(entity.id===systemCode||entity.metadata?.code===systemCode||entity.metadata?.systemKey===systemCode||entity.label===systemCode));
  if(systemCode&&!system)issues.push(`Resolve installed target system: ${systemCode}`);
  if(!systemCode)issues.push('Confirm target system; set targetSystemId/code or retain empty for organization-wide scope and resolve this issue');
  if(!type)issues.push(`Missing installed record type: ${meta.form_id}`);
  else {
   if(!templates.has(type.templateRevisionId)){
    const content=(await http(`/api/artifacts/${type.templateArtifactId}/revisions/${type.templateRevisionId}/content`,{client})).body;
    if(content.evidenceStatus!=='verified')issues.push('Installed template evidence is not verified');
    templates.set(type.templateRevisionId,content.markdown??'');
   }
   const version=templates.get(type.templateRevisionId)!.match(/^template_version:\s*["']?([^\n"']+)/m)?.[1].trim();
   if(version!==meta.template_version)issues.push(`Installed template version mismatch: ${version??'missing'} != ${meta.template_version}`);
   if([type.applicabilityCondition,type.reviewCondition,type.approvalCondition].some(Boolean))issues.push('Supply independently verified condition values with exact source lines and reviewer');
  }
  const candidates=(action:string)=>[...new Set(permissionCandidates(oracle.rows.find(row=>row.formCode===meta.form_id&&row.action===action),{informationId:meta.information_id,sourcePath:source.path,sourceSha256:hash(source.bytes),systemCode}).filter(person=>person.scope==='all'||person.scope===systemCode).flatMap(person=>persons.filter((installed:any)=>installed.personaId===person.personaId&&installed.name===person.name).map((installed:any)=>installed.id)))] as string[];
  const author=candidates('create')[0]??'',reviewers=candidates('review'),approvers=candidates('approve');
  if(!author||!reviewers.length)issues.push('Resolve author/reviewer from independent permissions');
  const row:InventoryRow={sourcePath:source.path,sourceSha256:hash(source.bytes),informationId:meta.information_id,formId:meta.form_id,templateVersion:meta.template_version,title:meta.title??text.match(/^#\s+(.+)$/m)?.[1]??meta.information_id,recordTypeId:type?.id??'',templateRevisionId:type?.templateRevisionId??'',targetSystemId:system?.id??'',targetSystemCode:systemCode,draftOnly:meta.information_id===DRAFT_ONLY,actors:{author,submitter:candidates('submit')[0]??'',reviewers,approvers,circulator:candidates('circulate')[0]??'',recipients:[]},confirmations:[],issues};
  if(!row.draftOnly)issues.push('Select required reviewers/approvers and circulation recipients from independent oracle; resolve separation and source conditions');
  rows.push(row);
 }
 return {schemaVersion:1,target:input.target,baseUrl:input.baseUrl,context,oraclePath:input.oraclePath,oracleSha256:input.oracleSha256,policySha256:input.policySha256,persons,recordTypes,rows,prerequisites:{}};
}
