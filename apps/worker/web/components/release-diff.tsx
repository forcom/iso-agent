import { useState, type ReactNode } from 'react';
import { DataValue, MarkdownBody, EvidenceList, ResultDetails, Source } from './ui';
import type { Evidence } from '../api';

type Row = Record<string, unknown>;
type Delta = { beforeCount: number; afterCount: number; added: Row[]; removed: Row[]; changed: {key:string; before:Row; after:Row}[]; unchanged:number };
const categories = [['sources','원문'],['requirements','요구사항'],['entities','개체'],['relations','관계'],['policies','행위 권한'],['wiki','위키']] as const;
function rowTitle(row: Row) { return String(row.title ?? row.label ?? row.name ?? (row.subjectId ? `${row.subjectId} → ${row.type} → ${row.objectId}` : row.resourceTypeId ? `${row.resourceTypeId} · ${row.action} · ${row.roleId}` : row.code ?? row.id ?? row.artifactId)); }
function DeferredDetails({title,children}: {title:string;children:()=>ReactNode}) {
  const [expanded,setExpanded]=useState(false);
  return <details open={expanded} onToggle={event=>{if(event.target===event.currentTarget)setExpanded(event.currentTarget.open);}}><summary>{title}</summary>{expanded?children():null}</details>;
}
function DiffValue({value}: {value:Row}) {
  const metadata=value.metadata as Row | undefined;
  return <div className="stack">
    <strong>{rowTitle(value)}</strong>
    {value.revisionId ? <p className="mono">버전 {String(value.revisionId)}</p> : null}
    {value.markdown ? <DeferredDetails title="원문 내용">{()=><Source markdown={String(value.markdown)} filename={`${value.revisionId ?? value.id ?? "source"}.md`} downloadUrl={value.kind === "index" && value.revisionId ? `/api/source-index/${encodeURIComponent(String(value.revisionId))}?download=1` : value.artifactId && value.revisionId ? `/api/artifacts/${encodeURIComponent(String(value.artifactId))}/revisions/${encodeURIComponent(String(value.revisionId))}/content?download=1` : undefined}/>}</DeferredDetails> : null}
    {metadata?.text ? <MarkdownBody markdown={String(metadata.text)}/> : null}
    {value.action ? <dl className="metadata"><dt>동작</dt><dd>{String(value.action)}</dd><dt>역할</dt><dd>{String(value.roleId)}</dd><dt>상태 조건</dt><dd><DataValue value={value.stateCondition}/></dd><dt>분리 조건</dt><dd><DataValue value={value.separationCondition}/></dd></dl> : null}
    {Array.isArray(value.claims) ? value.claims.map((claim:Row)=><section key={String(claim.id)}><strong>{String(claim.heading)}</strong><MarkdownBody markdown={String(claim.text)}/><EvidenceList items={claim.evidenceRefs as Evidence[]}/></section>) : null}
    {Array.isArray(value.evidenceRefs) && value.evidenceRefs.length>0 && <EvidenceList items={value.evidenceRefs as Evidence[]}/>}
    <ResultDetails value={value} title="전체 값·출처 확인"/>
  </div>;
}
export function ReleaseDiff({value}: {value:unknown}) {
  const diff=value as Record<string,unknown>;
  const available=categories.filter(([key])=>Array.isArray((diff[key] as Delta | undefined)?.added));
  if(!available.length)return <ResultDetails value={value} title="변경 전후 전체 차이"/>;
  return <div className="stack">
    <p className="muted">{String(diff.comparisonNote ?? '각 항목을 펼쳐 변경 전후 내용과 근거를 대조하세요.')}</p>
    <div className="table-wrap"><table aria-label="재구축 변경 요약"><thead><tr><th>구분</th><th>이전</th><th>이후</th><th>추가</th><th>삭제</th><th>변경</th></tr></thead><tbody>{available.map(([key,title])=>{const delta=diff[key] as Delta;return <tr key={key}><th>{title}</th><td>{delta.beforeCount}</td><td>{delta.afterCount}</td><td>{delta.added.length}</td><td>{delta.removed.length}</td><td>{delta.changed.length}</td></tr>})}</tbody></table></div>
    {available.map(([key,title])=>{const delta=diff[key] as Delta;return <DeferredDetails key={key} title={`${title} 변경 항목 · 추가 ${delta.added.length} · 삭제 ${delta.removed.length} · 변경 ${delta.changed.length}`}>{()=><div className="stack">
      {!delta.added.length&&!delta.removed.length&&!delta.changed.length&&<p className="muted">실제 내용의 변경이 없습니다.</p>}
      {delta.added.map((row,i)=><DeferredDetails key={`added-${i}`} title={`추가 · ${rowTitle(row)}`}>{()=><DiffValue value={row}/>}</DeferredDetails>)}
      {delta.removed.map((row,i)=><DeferredDetails key={`removed-${i}`} title={`삭제 · ${rowTitle(row)}`}>{()=><DiffValue value={row}/>}</DeferredDetails>)}
      {delta.changed.map(row=><DeferredDetails key={row.key} title={`변경 · ${rowTitle(row.after)}`}>{()=><div className="diff-columns"><section><h3>이전</h3><DiffValue value={row.before}/></section><section><h3>이후</h3><DiffValue value={row.after}/></section></div>}</DeferredDetails>)}
    </div>}</DeferredDetails>})}
    {Array.isArray(diff.issues)&&diff.issues.length>0&&<ResultDetails value={diff.issues} title="확인이 필요한 매핑"/>}
    {diff.extractionError?<p role="alert" className="notice error">{String(diff.extractionError)}</p>:null}
    <ResultDetails value={diff.assignments} title="영향 검토용 현재 역할 지정"/>
    <ResultDetails value={value} title="변경 전후 전체 차이"/>
  </div>;
}
