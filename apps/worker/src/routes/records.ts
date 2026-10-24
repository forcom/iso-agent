import {Hono} from 'hono';
import type {Action,KnowledgeContext} from '../../../packages/contracts/src/index';
import type {AppEnv,Artifact,Revision} from '../types';
import {get,getBundle,getKnowledgeContext} from '../lib/storage';
import {authorizeRecordAction,confirmConditions,revisionVersion,typeConditions} from '../lib/conditions';
import {registerRecord,resourceFor} from '../lib/artifacts';
import {authorize} from '../lib/engine';
import {requireValue,stringList,textField} from '../lib/errors';
export const recordRoutes=new Hono<AppEnv>();
export async function uploadInput(req:Request) {
 const size=Number(req.headers.get('content-length'));requireValue(!size||size<=10*1024*1024+64*1024,413,'FILE_TOO_LARGE','파일은 최대 10 MiB입니다.');
 const form=await req.formData(),file=form.get('file');requireValue(file && typeof file!=='string',422,'FILE_REQUIRED','Markdown 파일을 선택해 주세요.');
 const parse=(key:string,fallback:unknown)=>form.get(key)?JSON.parse(String(form.get(key))):fallback;
 return {file:new Uint8Array(await file.arrayBuffer()),filename:file.name,documentCode:String(form.get('documentCode')??''),title:String(form.get('title')??''),recordTypeIds:stringList(parse('recordTypeIds',form.get('recordTypeId')?[String(form.get('recordTypeId'))]:[]),'recordTypeIds'),scope:String(form.get('scope')??parse('systemIds',[])[0]??''),templateRevisionIds:stringList(parse('templateRevisionIds',[]),'templateRevisionIds'),requestKey:textField(form.get('requestKey'),'requestKey',200),expectedContext:parse('expectedContext',null) as KnowledgeContext,fieldMappings:parse('fieldMappings',{}),expectedRevisionId:form.get('expectedRevisionId')?String(form.get('expectedRevisionId')):undefined,kind:form.get('kind')?String(form.get('kind')):undefined,researchProposalId:form.get('researchProposalId')?String(form.get('researchProposalId')):undefined,artifactId:form.get('artifactId')?String(form.get('artifactId')):undefined};
}
recordRoutes.post('/records',async c=>c.json(await registerRecord(c.env,c.get('actor'),await uploadInput(c.req.raw)),201));
recordRoutes.post('/records/:id/revisions',async c=>{const input=await uploadInput(c.req.raw);return c.json(await registerRecord(c.env,c.get('actor'),input,c.req.param('id'),input.expectedRevisionId),201)});
recordRoutes.post('/records/:id/conditions',async c=>c.json(await confirmConditions(c.env,c.get('actor'),c.req.param('id'),await c.req.json())));
recordRoutes.get('/records/:id/actions',async c=>{
 const artifact=await get<Artifact>(c.env,'artifacts',c.req.param('id')),revision=await get<Revision>(c.env,'revisions',c.req.query('revisionId')??artifact.workingRevisionId);requireValue(revision.artifactId===artifact.id,404,'NOT_FOUND','해당 자료의 버전이 아닙니다.');
 const context=await getKnowledgeContext(c.env);const actions=[];
 for(const action of ['revise','submit','review','approve','reject','circulate'] as Action[]){
  const decision=await authorizeRecordAction(c.env,c.get('actor'),artifact,revision,context,action);actions.push({action,...decision});
 }const bundle=await getBundle(c.env,context);const conditions:any[]=typeConditions(bundle,artifact.recordTypeIds).map(condition=>({...condition,value:revision.conditions[condition.field]??null}));
 const requesterRule=bundle.policies.find(p=>artifact.recordTypeIds.includes(p.resourceTypeId)&&p.separationCondition==='not_requester');if(requesterRule)conditions.push({field:'requesterPersonId',kind:'person',reason:'자원 접근 신청자와 승인자 분리',value:revision.requesterPersonId??null,evidenceRefs:requesterRule.evidenceRefs});
 for(const [field,separation,reason] of [['implementerIds','not_implementer','조치 수행자와 효과성 검증자의 독립성'],['auditedPersonIds','independent_auditor','피심사자와 내부심사원의 독립성']] as const){const policy=bundle.policies.find(p=>artifact.recordTypeIds.includes(p.resourceTypeId)&&p.separationCondition===separation);if(policy)conditions.push({field,kind:'people',reason,value:revision[field]??null,evidenceRefs:policy.evidenceRefs})}
 const types=bundle.recordTypes.filter(type=>artifact.recordTypeIds.includes(type.id));
 const recordApproval=types.length===artifact.recordTypeIds.length&&types.every(type=>type.recordApproval)?{label:[...new Set(types.map(type=>type.recordApproval!.label))].join(' · '),limitations:[...new Set(types.map(type=>type.recordApproval!.limitations))].join(' ')}:undefined;
 return c.json({actions,context,revisionId:revision.id,revisionVersion:await revisionVersion(revision),state:revision.state,conditions,approvalScope:revision.approvalScope??'outcome',recordApproval});
});
