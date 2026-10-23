import {requestHash} from './requests';
import type { ActorContext, KnowledgeContext, Relation, RecordUpload, RecordRevisionResult } from '../../../packages/contracts/src/index';
import type {Artifact,Env,Revision} from '../types';
import {all,get,getBundle,getKnowledgeContext,assertContext,assertExpectedContext,replay,commitMutation,event,update} from './storage';
import {requireAuthorization} from './engine';
import {parseMarkdown,sha256} from './markdown';
import {ApiError,requireValue,stringList,textField} from './errors';
import {canonical} from '../../../packages/knowledge/src/index';
export function resourceFor(artifact:Artifact,revision:Revision) {
 return {id:artifact.id,typeIds:artifact.kind==='record'?artifact.recordTypeIds:[artifact.regulationType!],revisionId:revision.id,currentRevisionId:artifact.workingRevisionId,state:revision.state,systemIds:revision.systemIds,authorPersonId:revision.createdBy,reviewerPersonIds:revision.reviewedBy??[],requesterPersonId:revision.requesterPersonId,implementerIds:revision.implementerIds,auditedPersonIds:revision.auditedPersonIds,conditions:revision.conditions};
}
export async function readRevision(env:Env,id:string) {
 const revision=await get<Revision>(env,'revisions',id);const object=await env.SOURCES.get(revision.objectKey);
 if(!object)throw new ApiError(422,'SOURCE_UNAVAILABLE','원본을 확보할 수 없습니다.',{revision});
 const bytes=new Uint8Array(await object.arrayBuffer());requireValue(await sha256(bytes)===revision.sourceSha256,422,'SOURCE_CHANGED','원본 해시가 일치하지 않습니다.');
 const parsed=await parseMarkdown(revision.filename,bytes);
 requireValue(parsed.textSha256===revision.textSha256,422,'SOURCE_CHANGED','추출 텍스트 해시가 일치하지 않습니다.');
 return {revision,markdown:parsed.markdown,evidenceStatus:'verified' as const};
}
export async function registerRecord(env:Env,actor:ActorContext,input:RecordUpload,artifactId?:string,expectedRevisionId?:string):Promise<RecordRevisionResult> {
 const parsed=await parseMarkdown(input.filename,input.file);const key=textField(input.requestKey,'requestKey',200);
 const hash=await requestHash(artifactId?'record.revise':'record.create',{...input,file:parsed.sha256,artifactId,expectedRevisionId});
 const prior=await replay(env,actor,key,hash);if(prior!==undefined)return prior;
 const context=await getKnowledgeContext(env);assertExpectedContext(input.expectedContext,context);
 const bundle=await getBundle(env,context);
 requireValue(!input.scope || bundle.entities.some(e=>e.id===input.scope&&e.type==='AISystem'),422,'UNKNOWN_SYSTEM','등록된 대상 시스템을 선택해 주세요.');
 const types=stringList(input.recordTypeIds,'recordTypeIds');requireValue(types.length>0,422,'RECORD_TYPE_REQUIRED','기록 유형을 선택해 주세요.');
 const recordTypes=types.map(id=>bundle.recordTypes.find(t=>t.id===id));requireValue(recordTypes.every(Boolean),422,'UNKNOWN_RECORD_TYPE','등록된 기록 유형이 아닙니다.');
 requireValue(input.templateRevisionIds.length===types.length && recordTypes.every(t=>input.templateRevisionIds.includes(t!.templateRevisionId)),422,'TEMPLATE_MISMATCH','각 기록 유형에 맞는 시행 양식 버전을 지정해 주세요.');
 if(types.length>1)requireValue(types.every(id=>input.fieldMappings?.[id] && parsed.markdown.includes(input.fieldMappings[id])),422,'TYPE_MAPPING_REQUIRED','통합 기록의 유형별 항목과 원문을 대응해 주세요.');
 const code=textField(input.documentCode,'documentCode',200),title=textField(input.title,'title',500);
 const declaredCode=parsed.markdown.match(/^document_code:\s*["']?([^\n"']+)/m)?.[1].trim();
 requireValue(!declaredCode||declaredCode===code,422,'IDENTITY_CONFLICT','파일 기재 문서번호와 입력이 다릅니다.');
 const declaredType=parsed.markdown.match(/^record_type_id:\s*["']?([^\n"']+)/m)?.[1].trim();
 requireValue(!declaredType||types.includes(declaredType),422,'TYPE_CONFLICT','파일 기재 유형과 선택 유형이 다릅니다.');
 let artifact:Artifact|undefined;
 if(artifactId){
  artifact=await get<Artifact>(env,'artifacts',artifactId);
  requireValue(artifact.kind==='record' && artifact.recordTypeIds.length===types.length && artifact.recordTypeIds.every(id=>types.includes(id)),422,'TYPE_CHANGE_FORBIDDEN','새 버전에서 기록 유형을 바꿀 수 없습니다.');
  requireValue(artifact.documentCode===code,422,'IDENTITY_CONFLICT','새 버전은 같은 문서번호를 사용합니다.');
  requireValue(artifact.workingRevisionId===expectedRevisionId,409,'REVISION_CONFLICT','작업 버전이 변경되었습니다.');
 }else requireValue(!(await env.DB.prepare('SELECT id FROM artifacts WHERE document_code=?').bind(code).first()),422,'DUPLICATE_CODE','문서번호가 이미 등록되어 있습니다. 새 버전 등록을 사용해 주세요.');
 const previous=artifact?await get<Revision>(env,'revisions',artifact.workingRevisionId):undefined;
 const authorization=await requireAuthorization(env,actor,artifact?'revise':'create',artifact&&previous?resourceFor(artifact,previous):{typeIds:types,state:'new',systemIds:input.scope?[input.scope]:[],conditions:{}},context);
 const nextSystemIds=input.scope?[input.scope]:[];
 if(artifact&&previous&&canonical(nextSystemIds)!==canonical(previous.systemIds))await requireAuthorization(env,actor,'revise',{...resourceFor(artifact,previous),systemIds:nextSystemIds},context);
 const id=artifact?.id??crypto.randomUUID(),revisionId=crypto.randomUUID(),at=new Date().toISOString();
 const state=recordTypes.some(t=>t!.approvalRequired||t!.reviewRequired||t!.approvalCondition||t!.reviewCondition||t!.applicabilityCondition)?'draft':'registered';
 const objectKey=`sources/${revisionId}/${parsed.sha256}.md`,textKey=`text/${revisionId}/${parsed.textSha256}.txt`;
 const revision:Revision={id:revisionId,artifactId:id,filename:input.filename,sourceSha256:parsed.sha256,textSha256:parsed.textSha256,objectKey,textKey,state,createdAt:at,createdBy:actor.personId,previousRevisionId:previous?.id??null,templateRevisionIds:input.templateRevisionIds,systemIds:input.scope?[input.scope]:[],conditions:{},fieldMappings:input.fieldMappings??{},evidenceStatus:'verified'};
 const next:Artifact={id,documentCode:code,title,kind:'record',recordTypeIds:types,workingRevisionId:revisionId,effectiveRevisionId:state==='registered'?revisionId:artifact?.effectiveRevisionId??null,systemIds:revision.systemIds};
 const lines=parsed.markdown.split('\n'),firstLine=lines.findIndex(line=>line.trim().length>0);
 const citation=(line:number)=>({revisionId,sourceSha256:parsed.sha256,lineStart:line+1,lineEnd:line+1,quote:lines[line]});
 const evidence=citation(firstLine);
 const relations:Relation[]=[];
 const add=(subjectId:string,objectId:string,type:Relation['type'],origin:Relation['origin']='explicit_metadata',reviewStatus:Relation['reviewStatus']='validated',ref=evidence)=>relations.push({id:crypto.randomUUID(),subjectId,objectId,type,origin,evidenceRefs:[ref],releaseId:context.releaseId,reviewStatus});
 add(id,revisionId,'has_revision');for(const type of types)add(id,type,'record_of_type');for(const tpl of input.templateRevisionIds)add(revisionId,tpl,'uses_template');if(previous)add(revisionId,previous.id,'supersedes');
 if(input.scope)add(revisionId,input.scope,'about_system');
 for(const known of await all<Artifact>(env,'artifacts'))if(known.id!==id){const line=lines.findIndex(line=>mentionsCode(line,known.documentCode));if(line>=0)add(revisionId,known.id,'references','reference_extraction','candidate',citation(line))}
 const statements=[artifact?update(env,'artifacts',id,next):env.DB.prepare('INSERT INTO artifacts VALUES(?,?,?,?)').bind(id,code,'record',JSON.stringify(next)),env.DB.prepare('INSERT INTO revisions VALUES(?,?,?)').bind(revisionId,id,JSON.stringify(revision)),...relations.map(r=>env.DB.prepare('INSERT INTO relations VALUES(?,?)').bind(r.id,JSON.stringify(r))),event(env,id,{kind:'record_registered',revisionId,actorId:actor.personId,context,authorization})];
 const result={artifactId:id,revisionId,status:state,context:{...context,dataRevision:context.dataRevision+1}};
 return withSourceCleanup(env,revisionId,[objectKey,textKey],async()=>{
  await env.SOURCES.put(objectKey,input.file as Uint8Array<ArrayBuffer>,{customMetadata:{uploadedAt:at}});await env.SOURCES.put(textKey,parsed.markdown,{customMetadata:{uploadedAt:at}});
  return commitMutation(env,actor,key,hash,context,result,statements);
 });
}
/** A code counts only as a whole token, so AIDU-AIP-01 is not found inside AIDU-AIP-01-F02. */
export function mentionsCode(line:string,code:string) {
 return new RegExp(`(?<![A-Za-z0-9-])${code.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?![A-Za-z0-9-])`).test(line);
}
/** Objects keyed by a fresh revision ID are deleted only when D1 confirms that revision was never
 * registered: a failed commit, or a replay that returned an earlier request's revision. */
export async function withSourceCleanup<T>(env:Env,revisionId:string,keys:string[],storeAndCommit:()=>Promise<T>):Promise<T> {
 try{return await storeAndCommit()}finally{
  try{if(!(await env.DB.prepare('SELECT 1 FROM revisions WHERE id=?').bind(revisionId).first()))await env.SOURCES.delete(keys)}catch{/* keep objects when registration state is unknown */}
 }
}
