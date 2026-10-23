import type {EvidenceRef} from '../../../packages/contracts/src/index';
import type {Env} from '../types';
import {readRevision} from '../lib/artifacts';
import {requireValue,textField,stringList} from '../lib/errors';
import {publicSourceUrl} from './schedule';
import type {ResearchJob,ResearchResult} from './types';

function items(value:unknown,name:string,max:number):any[]{requireValue(Array.isArray(value)&&value.length<=max,422,'INVALID_RESULT',`${name} 목록을 확인해 주세요.`);return value}
const optionalText=(value:unknown,name:string,max=4000)=>value===''?'':textField(value,name,max);
export async function verifyInternalEvidence(env:Env,refs:EvidenceRef[]) {
 for(const ref of refs){
  requireValue(ref&&typeof ref==='object'&&typeof ref.revisionId==='string',422,'INVALID_CITATION','내부 원문 인용이 필요합니다.');
  const {revision,markdown}=await readRevision(env,ref.revisionId),lines=markdown.split('\n');
  requireValue(ref.sourceSha256===revision.sourceSha256&&Number.isInteger(ref.lineStart)&&Number.isInteger(ref.lineEnd)&&ref.lineStart>=1&&ref.lineEnd>=ref.lineStart&&ref.lineEnd<=lines.length&&lines.slice(ref.lineStart-1,ref.lineEnd).join('\n')===ref.quote,422,'INVALID_CITATION','내부 근거의 해시·행·인용을 확인해 주세요.');
 }
}
export async function parseResearchResult(env:Env,job:ResearchJob,value:unknown):Promise<ResearchResult> {
 requireValue(value&&typeof value==='object'&&!Array.isArray(value),422,'INVALID_RESULT','구조화된 조사 결과가 필요합니다.');
 const v=value as Record<string,unknown>;
 requireValue(['complete','partial','no_change'].includes(String(v.coverage)),422,'INVALID_RESULT','조사 범위를 표시해 주세요.');
 const sources=items(v.sources,'출처',job.definition.maxSources).map(s=>({id:textField(s.id,'출처 ID',100),url:publicSourceUrl(s.url),title:textField(s.title,'출처 제목',500),publisher:textField(s.publisher,'발행자',500),accessedAt:textField(s.accessedAt,'조회 시각',80),quote:optionalText(s.quote,'발췌',10000),verification:'unverified' as const,reason:'에이전트 보고입니다. ERP에서 원문을 독립적으로 확보·대조하지 않았습니다.'}));
 requireValue(new Set(sources.map(s=>s.id)).size===sources.length&&sources.every(s=>/T.*(?:Z|[+-]\d\d:\d\d)$/.test(s.accessedAt)&&Number.isFinite(Date.parse(s.accessedAt))),422,'INVALID_RESULT','출처 식별자·조회 시각을 확인해 주세요.');
 const findings=items(v.findings,'발견사항',100).map(f=>{
  requireValue(['external_fact','company_relevance','interpretation','proposal','unknown'].includes(f.kind),422,'INVALID_RESULT','사실·해석·제안을 구분해 주세요.');
  const sourceIds=stringList(items(f.sourceIds,'발견사항 출처',100),'출처');
  requireValue(sourceIds.every(id=>sources.some(s=>s.id===id)),422,'INVALID_RESULT','존재하지 않는 출처를 참조했습니다.');
  return {kind:f.kind,text:textField(f.text,'발견사항',10000),sourceIds};
 });
 const internalEvidence=items(v.internalEvidence,'내부 근거',100) as EvidenceRef[];await verifyInternalEvidence(env,internalEvidence);
 const drafts=items(v.drafts,'기록 초안',60).map(d=>{
  requireValue(job.templates[d.recordTypeId]===d.templateRevisionId&&job.definition.recordTypeIds.includes(d.recordTypeId),422,'INVALID_RESULT','요청한 기록 유형과 양식 버전으로 초안을 제출해 주세요.');
  return {recordTypeId:String(d.recordTypeId),templateRevisionId:String(d.templateRevisionId),title:textField(d.title,'초안 제목',200),markdown:textField(d.markdown,'Markdown 초안',50000)};
 });
 requireValue(new Set(drafts.map(d=>d.recordTypeId)).size===drafts.length,422,'INVALID_RESULT','기록 유형별 초안은 한 건씩 제출해 주세요.');
 const actions=items(v.actions,'조치 제안',100).map(a=>({text:textField(a.text,'조치 제안',4000),reason:textField(a.reason,'제안 이유',4000),ownerSuggestion:optionalText(a.ownerSuggestion,'담당 제안',200),dueSuggestion:optionalText(a.dueSuggestion,'기한 제안',200),verificationMethod:textField(a.verificationMethod,'검증 방법',4000)}));
 const questions=items(v.questions,'확인 질문',100).map(q=>textField(q,'확인 질문',2000)),failedSources=items(v.failedSources,'실패 출처',100).map(q=>textField(q,'실패 출처',2000));
 requireValue(v.coverage==='partial'||failedSources.length===0,422,'INVALID_RESULT','조사 실패가 남으면 부분 결과로 제출해 주세요.');
 requireValue(v.coverage!=='no_change'||sources.length+internalEvidence.length>0,422,'INVALID_RESULT','변경 없음에도 확인한 근거가 필요합니다.');
 return {coverage:v.coverage as ResearchResult['coverage'],summary:textField(v.summary,'조사 요약',10000),findings,sources,internalEvidence,drafts,actions,questions,failedSources,checkedScope:textField(v.checkedScope,'실제 확인 범위',4000)};
}
