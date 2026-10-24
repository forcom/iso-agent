import type {Action,ActionPolicy,KnowledgeContext,RecordDesignation,RecordDesignationRegistry,RecordDesignationReference} from '../../../packages/contracts/src/index';
import type {Env} from '../types';
import {ApiError,requireValue} from './errors';
import {requestMemo} from './storage';
import {sha256} from './markdown';

export interface DesignatedSource {documentCode?:string;filename?:string;sourceSha256?:string;systemIds?:string[]}
const actions=new Set<Action>(['read','create','revise','submit','review','approve','reject','circulate','confirm_receipt','apply_assignment','publish']);
const fields=['recordTypeId','action','personId','roleId','documentCode','filename','sourceSha256','systemIds'];
const text=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.trim()===value;
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const invalid=()=>new ApiError(503,'RECORD_DESIGNATION_INVALID','기록별 담당자 지정의 참조 또는 무결성을 확인할 수 없습니다.');
export function parseRecordDesignations(value:unknown):RecordDesignationRegistry {
 if(!object(value)||Object.keys(value).some(key=>!['version','designations'].includes(key))||value.version!==1||!Array.isArray(value.designations))throw invalid();
 for(const row of value.designations){
  if(!object(row)||Object.keys(row).length!==fields.length||Object.keys(row).some(key=>!fields.includes(key))||fields.filter(field=>field!=='systemIds').some(field=>!text(row[field]))||!actions.has(row.action as Action)||!/^[a-f0-9]{64}$/.test(String(row.sourceSha256))||!Array.isArray(row.systemIds)||!row.systemIds.every(text)||new Set(row.systemIds).size!==row.systemIds.length)throw invalid();
 }
 return value as unknown as RecordDesignationRegistry;
}
export async function getRecordDesignations(env:Env,context:KnowledgeContext):Promise<RecordDesignationRegistry|undefined> {
 return requestMemo(`record-designations:${context.releaseId}`,async()=>{
  const row=await env.DB.prepare('SELECT body FROM releases WHERE id=?').bind(context.releaseId).first<{body:string}>();
  requireValue(row,503,'RECORD_DESIGNATION_INVALID','담당자 지정의 릴리스가 없습니다.');
  let metadata:RecordDesignationReference;
  try{const value:unknown=JSON.parse(row.body);if(!object(value))throw invalid();metadata=value;}catch{throw invalid();}
  const key=metadata.recordDesignationKey,digest=metadata.recordDesignationSha256;
  if(key===undefined&&digest===undefined)return undefined;
  if(typeof key!=='string'||typeof digest!=='string'||!/^[a-f0-9]{64}$/.test(digest)||key!==`record-designations/${digest}.json`)throw invalid();
  const stored=await env.SOURCES.get(key);if(!stored)return undefined;
  const bytes=new Uint8Array(await stored.arrayBuffer());if(await sha256(bytes)!==digest)throw invalid();
  try{return parseRecordDesignations(JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes)));}catch{throw invalid();}
 });
}
function matches(row:RecordDesignation,policy:ActionPolicy,personId:string,source:DesignatedSource){
 return row.recordTypeId===policy.resourceTypeId&&row.action===policy.action&&row.personId===personId&&row.roleId===policy.roleId&&row.documentCode===source.documentCode&&row.filename===source.filename&&row.sourceSha256===source.sourceSha256&&source.systemIds!==undefined&&row.systemIds.length===source.systemIds.length&&row.systemIds.every(id=>source.systemIds!.includes(id));
}
export async function restrictRecordDesignations(env:Env,context:KnowledgeContext,policies:ActionPolicy[],personId:string,source:DesignatedSource){
 if(!policies.some(policy=>policy.requiresRecordDesignation))return policies;
 const registry=await getRecordDesignations(env,context);
 return policies.filter(policy=>!policy.requiresRecordDesignation||registry?.designations.some(row=>matches(row,policy,personId,source)));
}
