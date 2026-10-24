import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {posix} from 'node:path';
import type {KnowledgeContext,RecordType} from '../../packages/contracts/src/index';
import {stable} from './client';
import {permissionCandidates,type PermissionOracle} from './permissions';

export const DEMO_URL='https://iso-agent-demo.your-e37.workers.dev';
export const DRAFT_ONLY='AIDU-AIP-09-03-F01-2026-001';
export type Target='local'|'remote';
export type Confirmation={field:string;value:boolean|string|string[];quote:string;lineStart:number;lineEnd:number;comment:string;personId:string};
export type InventoryRow={
 sourcePath:string;sourceSha256:string;informationId:string;formId:string;templateVersion:string;title:string;
 recordTypeId:string;templateRevisionId:string;targetSystemId:string;targetSystemCode?:string;draftOnly:boolean;
 actors:{author:string;submitter:string;reviewers:string[];approvers:string[];circulator:string;recipients:string[]};
 confirmations:Confirmation[];issues:string[];
};
export type Inventory={schemaVersion:1;target:Target;baseUrl:string;context:KnowledgeContext;oraclePath:string;oracleSha256:string;policySha256:string;
 persons:Array<{id:string;name:string;personaId?:string}>;recordTypes:RecordType[];rows:InventoryRow[];
 prerequisites:{localAcceptanceReport?:{path:string;sha256:string};resetRehearsalReport?:{path:string;sha256:string};remoteBackupReport?:{path:string;sha256:string}};
};
export const hash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
export function targetUrl(target:string,url?:string):string {
 assert.ok(target==='local'||target==='remote','--target local|remote is required');
 if(target==='remote'){assert.ok(!url||url===DEMO_URL,'Remote acceptance URL is pinned');return DEMO_URL;}
 const parsed=new URL(url??'http://127.0.0.1:5173');
 assert.ok(['127.0.0.1','localhost','[::1]'].includes(parsed.hostname)&&parsed.protocol==='http:'&&!parsed.username&&!parsed.password&&parsed.pathname==='/'&&!parsed.search&&!parsed.hash&&parsed.port!=='4173','Local target must be an explicit loopback ERP origin (not the synthetic 4173 server)');
 return parsed.origin;
}
export function requestKey(runId:string,target:Target,informationId:string,action:string):string {
 assert.match(runId,/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/,'Invalid run-id');
 return `acceptance:${hash(stable([runId,target,informationId,action]))}`;
}
export function metadata(bytes:Uint8Array):Record<string,string> {
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/\r\n?/g,'\n');
 const front=text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1];assert.ok(front,'Missing frontmatter');
 const fields:Record<string,string>={};
 for(const line of front.split('\n')){
  const match=line.match(/^([A-Za-z_][\w-]*):\s*(.*?)\s*$/);if(!match)continue;
  assert.ok(!(match[1] in fields),`Duplicate metadata ${match[1]}`);
  fields[match[1]]=match[2].replace(/^(["'])(.*)\1$/,'$2');
 }
 for(const key of ['information_id','form_id','template_version'])assert.ok(fields[key],`Missing ${key}`);
 return fields;
}
export async function validateSources(rows:InventoryRow[],read:(path:string)=>Promise<Uint8Array>) {
 for(const row of rows){
  assert.ok(row.sourcePath.startsWith('docs/records/')&&posix.normalize(row.sourcePath)===row.sourcePath&&row.sourcePath.endsWith('.md')&&!row.sourcePath.includes('\\')&&!row.sourcePath.endsWith('/README.md'),'Invalid source path');
  const bytes=await read(row.sourcePath);assert.equal(hash(bytes),row.sourceSha256,`Source hash changed: ${row.sourcePath}`);
  const meta=metadata(bytes);
  for(const [key,value] of [['information_id',row.informationId],['form_id',row.formId],['template_version',row.templateVersion]])assert.equal(meta[key],value,`Source ${key} mismatch: ${row.sourcePath}`);
  const lines=new TextDecoder().decode(bytes).replace(/\r\n?/g,'\n').split('\n');
  for(const proof of row.confirmations??[]){assert.ok(Number.isInteger(proof.lineStart)&&proof.lineStart>0&&Number.isInteger(proof.lineEnd)&&proof.lineEnd>=proof.lineStart&&proof.lineEnd<=lines.length&&proof.quote&&proof.comment,'Invalid condition evidence');assert.equal(lines.slice(proof.lineStart-1,proof.lineEnd).join('\n'),proof.quote,'Condition quote mismatch');}
 }
}
export function assertInventory(plan:Inventory,count=74) {
 assert.equal(plan.schemaVersion,1);assert.equal(plan.baseUrl,targetUrl(plan.target,plan.baseUrl));assert.equal(plan.rows.length,count,'Expected 74 original records');
 assert.equal(new Set(plan.rows.map(row=>row.sourcePath)).size,count,'Duplicate source path');assert.equal(new Set(plan.rows.map(row=>row.informationId)).size,count,'Duplicate information_id');
 if(count===74)assert.equal(new Set(plan.rows.map(row=>row.formId)).size,54,'Expected 54 form types');
 for(const row of plan.rows){
  assert.equal(row.draftOnly,row.informationId===DRAFT_ONLY,'Draft-only record policy mismatch');assert.deepEqual(row.issues,[],`Unresolved preparation: ${row.informationId}`);
  const type=plan.recordTypes.find(type=>type.id===row.recordTypeId);assert.ok(type,'Missing installed type');assert.equal(type.code,row.formId);assert.equal(type.templateRevisionId,row.templateRevisionId);
  for(const condition of [type.applicabilityCondition,type.reviewCondition,type.approvalCondition].filter(Boolean))if(!row.draftOnly)assert.ok(row.confirmations.some(proof=>proof.field===condition!.field&&typeof proof.value==='boolean'),`Missing condition ${condition!.field}`);
  assert.ok(row.actors.author&&row.actors.submitter&&row.actors.reviewers.length,'Missing actor selection');
  if(!row.draftOnly&&(type.approvalRequired||type.approvalCondition&&row.confirmations.some(proof=>proof.field===type.approvalCondition!.field&&proof.value===type.approvalCondition!.equals)))assert.ok(row.actors.approvers.length,'Missing required approver');
  if(!row.draftOnly)assert.ok(row.actors.circulator&&row.actors.recipients.length,'Missing circulation selection');
 }
}
export function validateActors(plan:Inventory,oracle:PermissionOracle):void {
 for(const row of plan.rows){
  const allowed=(action:string,id:string)=>{
   const person=plan.persons.find(person=>person.id===id);assert.ok(person,`Unknown actor ${id}`);
   const permission=oracle.rows.find(permission=>permission.formCode===row.formId&&permission.action===action);
   if(permission?.recordCases&&!row.targetSystemId)return false;
   return permissionCandidates(permission,{informationId:row.informationId,sourcePath:row.sourcePath,sourceSha256:row.sourceSha256,systemCode:row.targetSystemCode??row.targetSystemId}).some(candidate=>candidate.personaId===person.personaId&&candidate.name===person.name&&(candidate.scope==='all'||!!row.targetSystemId&&candidate.scope===(row.targetSystemCode??row.targetSystemId)));
  };
  for(const [action,ids] of [['create',[row.actors.author]],['submit',[row.actors.submitter]],['review',row.actors.reviewers],['approve',row.actors.approvers],['circulate',[row.actors.circulator]]] as Array<[string,string[]]>){
   if(row.draftOnly&&action!=='create')continue;
   for(const id of ids)assert.ok(allowed(action,id),`Actor ${id} is absent from independent oracle ${row.formId}:${action}`);
  }
  for(const proof of row.confirmations)assert.ok(allowed('review',proof.personId)||allowed('approve',proof.personId),`Condition actor absent from oracle: ${proof.personId}`);
  for(const id of row.actors.recipients)assert.ok(plan.persons.some(person=>person.id===id),`Unknown recipient ${id}`);
 }
}
