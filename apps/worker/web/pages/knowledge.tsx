import { lazy, Suspense, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, label, post, type Answer, type Collection, type Evidence, type GraphResult, type Item } from '../api';
import { useDirty, useLoad } from '../session';
import { useWorkspaceTab } from '../workspace-tabs';
import { Empty, ErrorNotice, EvidenceList, ItemList, ResultDetails, Loading, PageTitle, Panel, Source, Status } from '../components/ui';
const GraphCanvas = lazy(() => import('../components/graph'));

export function Ask({ compact = false }: { compact?: boolean }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  useDirty(Boolean(question) || busy);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null); setAnswer(null);
    try { setAnswer(await post<Answer>('/ask', { question })); }
    catch(e) { if ((e as Error).name !== 'AbortError') { setError(e as Error); if (e instanceof ApiError && e.status === 502) setAnswer(e.details as Answer); } }
    finally { setBusy(false); }
  }
  return <Panel title="근거를 확인하며 질문하기"><form onSubmit={submit} className="stack"><label>질문<textarea value={question} rows={compact ? 3 : 4} required onChange={event => setQuestion(event.target.value)} placeholder="예: 이 기록의 검토·승인 근거는 무엇인가요?"/></label><div className="actions"><span className="muted">현재 규정과 사용 가능한 기록에 근거합니다.</span><button className="primary" disabled={busy || !question.trim()}>{busy ? '근거 확인 중…' : '질문하기'}</button></div></form><ErrorNotice error={error}/>{answer && <div className="answer"><h3>답변</h3>{answer.markdown || answer.answer ? <Source filename="answer.md" markdown={answer.markdown ?? answer.answer ?? ''}/> : <p>생성된 답변이 없습니다.</p>}<h3>인용 근거</h3><EvidenceList items={answer.citations ?? answer.grounding?.sources.flatMap(source => source.evidenceRefs)}/>{(answer.computed ?? answer.graph) && <ResultDetails value={answer.computed ?? answer.graph} title="계산 결과" open/>}<ResultDetails value={answer.context ?? { releaseId: answer.releaseId, dataRevision: answer.dataRevision }} title="답변 기준"/><ResultDetails value={answer} title="응답 전체" filename="answer.json"/></div>}</Panel>;
}
export function TracePage() {
  const [params, setParams] = useSearchParams();
  const entities = useLoad<Collection>('/entities');
  const [result, setResult] = useState<GraphResult | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const mode = params.get('mode') ?? 'trace';
  const targetId = params.get('id') ?? '';
  async function query(cursor?: string) {
    setBusy(true); setError(null);
    if (!cursor) { setResult(null); setSelected(null); }
    try { const next = await post<GraphResult>('/graph/query', { mode, targetId, ...(cursor ? { cursor } : {}) }); setResult(previous => cursor && previous ? { ...next, entities: [...new Map([...previous.entities,...next.entities].map(node => [node.id,node])).values()], relations: [...previous.relations,...next.relations] } : next); }
    catch(e) { if ((e as Error).name !== 'AbortError') setError(e as Error); }
    finally { setBusy(false); }
  }
  const selectedItem = result?.entities.find(node => node.id === selected) ?? result?.relations.find(edge => edge.id === selected);
  return <><PageTitle title="요구사항 추적·Q&A" description="조회 범위와 근거 경로를 확인하고 원문으로 이동합니다."/><form className="filter-band" onSubmit={event => { event.preventDefault(); void query(); }}><label>조회 범위<select aria-label="조회 범위" value={mode} onChange={event => { setParams({ mode: event.target.value, id: targetId }); setResult(null); }}><option value="trace">요구사항 추적</option><option value="neighbors">주변 관계</option><option value="evidence">증거 후보</option><option value="missing">연결 미확인</option><option value="impact">변경 영향</option></select></label><label className="grow">대상<select required value={targetId} onChange={event => { setParams({ mode, id: event.target.value }); setResult(null); }}><option value="">자료·요구사항 선택</option>{entities.data?.items.map(item => <option key={item.id} value={item.id}>{label(item)} · {item.type ?? item.kind}</option>)}</select></label><button className="primary" disabled={busy || entities.loading || !targetId}>{busy ? '계산 중…' : '조회'}</button></form><ErrorNotice error={error ?? entities.error} retry={() => void query()}/>
    {result ? <Panel title="근거 관계" actions={<button onClick={() => void query()} disabled={busy}>현재 기준으로 재조회</button>}><p className="meta">릴리스 <code>{result.context.releaseId}</code> · 자료 세대 {result.context.dataRevision} · 관계 {result.relations.length} / 전체 {result.totalRelations ?? result.relations.length}</p><p className="muted">화면 배치는 의미상의 경로가 아닙니다. 표와 그래프는 같은 조회 결과를 표시합니다.</p><Suspense fallback={<Loading/>}><GraphCanvas result={result} selected={selected} onSelect={setSelected}/></Suspense><div className="graph-tables"><section><h3>노드</h3><div className="table-wrap"><table><thead><tr><th>대상</th><th>유형</th></tr></thead><tbody>{result.entities.map(node => <tr className={selected === node.id ? 'selected' : ''} key={node.id}><td><button className="link-button" onClick={() => setSelected(node.id)}>{node.label}</button></td><td>{node.type}</td></tr>)}</tbody></table></div></section><section><h3>관계와 경로</h3><div className="table-wrap"><table><thead><tr><th>관계</th><th>출발 → 도착</th><th>구분</th></tr></thead><tbody>{result.relations.map(edge => <tr className={selected === edge.id ? 'selected' : ''} key={edge.id}><td><button className="link-button" onClick={() => setSelected(edge.id)}>{edge.type}</button></td><td>{result.entities.find(node => node.id === edge.subjectId)?.label ?? edge.subjectId} → {result.entities.find(node => node.id === edge.objectId)?.label ?? edge.objectId}</td><td>{result.paths.some(path => path.derived && path.relationIds.includes(edge.id)) ? '도출 경로' : '직접'}</td></tr>)}</tbody></table></div></section></div>{result.cursor && <button onClick={() => void query(result.cursor ?? undefined)} disabled={busy}>다음 관계 불러오기</button>}{selectedItem && <Panel title="선택한 대상과 근거"><strong>{label(selectedItem)}</strong><EvidenceList items={selectedItem.evidenceRefs as Evidence[] | undefined}/><ResultDetails value={selectedItem}/></Panel>}<ResultDetails value={{ queryId: result.queryId, engine: result.engine, excluded: result.excluded, unknown: result.unknown }} title="엔진·제외·미확인 사항"/></Panel> : !busy && !error && <Empty>대상을 선택하면 확인된 관계와 여러 근거 경로를 조회합니다.</Empty>}
    <Ask/>
  </>;
}
export function WikiPage() {
  const { id } = useParams();
  const load = useLoad<Collection>('/wiki');
  const detail = useLoad<Item>(id ? `/wiki/${id}` : null);
  useWorkspaceTab(id&&detail.data?.id===id?`wiki:${id}`:undefined,id&&detail.data?.id===id?label(detail.data):undefined);
  return <><PageTitle title="지식 위키" description="유효 릴리스의 설명과 원문 근거를 함께 확인합니다."/><ErrorNotice error={load.error} retry={load.refresh}/><div className="split-view"><Panel title="지식 목록">{load.loading ? <Loading/> : <ItemList items={load.data?.items ?? []} to={item => `/wiki/${item.id}`}/>}</Panel><Panel title={detail.data ? label(detail.data) : '지식 내용'}>{detail.loading ? <Loading/> : detail.error ? <ErrorNotice error={detail.error} retry={detail.refresh}/> : detail.data ? <><p className="meta">릴리스 {String(detail.data.releaseId ?? '미제공')}</p>{((detail.data.claims ?? []) as { id: string; heading: string; text: string; evidenceRefs: Evidence[]; origin: string; reviewStatus: string }[]).map(claim => <section key={claim.id}><h3>{claim.heading}</h3><Source markdown={claim.text} filename={`${claim.id}.md`}/><p className="meta">{claim.origin === 'product_policy' ? '제품 정책 결정' : '규정 근거'} · <Status value={claim.reviewStatus}/></p><EvidenceList items={claim.evidenceRefs}/></section>)}{detail.data.unknown ? <ResultDetails value={detail.data.unknown} title="미확인 사항"/> : null}</> : <Empty>왼쪽에서 지식을 선택하세요.</Empty>}</Panel></div></>;
}
export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const [query,setQuery] = useState(params.get('q') ?? '');
  const q = params.get('q') ?? '';
  const load = useLoad<Collection>(q ? `/search?q=${encodeURIComponent(q)}` : null);
  function destination(item: Item) { if (item.type === 'wiki' || item.type === 'WikiPage' || item.kind === 'WikiPage') return `/wiki/${item.id}`; if (item.type === 'Requirement') return `/trace?mode=trace&id=${item.id}`; return `/${item.kind === 'record' || item.type === 'record' || item.type === 'Record' ? 'records' : 'documents'}/${item.artifactId ?? item.id}`; }
  return <><PageTitle title="통합 검색" description="규정·양식·기록·위키·요구사항을 검색합니다."/><form className="filter-band" onSubmit={event => { event.preventDefault(); setParams({ q: query }); }}><label className="grow">검색어<input required value={query} onChange={event => setQuery(event.target.value)} placeholder="문서번호, 제목 또는 내용"/></label><button className="primary">검색</button></form><ErrorNotice error={load.error} retry={load.refresh}/>{load.loading ? <Loading/> : load.data ? <Panel title={`검색 결과 · ${load.data.items.length}건`}><ItemList items={load.data.items} to={destination} empty="일치하는 자료가 없습니다."/></Panel> : <Empty>검색어를 입력하세요.</Empty>}</>;
}
export function ImpactPage() {
  const systems = useLoad<Collection>('/entities?kind=AISystem');
  const forms = useLoad<Collection>('/artifacts?kind=template');
  const [description, setDescription] = useState('');
  const [targetId, setTargetId] = useState('');
  const [result,setResult] = useState<Answer | null>(null);
  const [error,setError] = useState<Error | null>(null);
  const [busy,setBusy] = useState(false);
  useDirty(Boolean(description) || busy);
  const draft = result?.markdown ?? result?.draft;
  const exportText = draft ? `# 영향평가 초안\n\n미승인 초안이며 자동 기록 발행·적합성 판단이 아닙니다.\n\n조회 기준: ${JSON.stringify(result?.context ?? { releaseId: result?.releaseId, dataRevision: result?.dataRevision })}\n\n${draft}` : '';
  return <><PageTitle title="영향평가 초안" description="Edu Score 변경의 계산된 영향 범위와 생성 초안을 구분하여 확인합니다."/><div className="notice">초안은 검토 자료입니다. F01~F04 자동 완성, 자동 승인·기록 발행과 적합성 판정은 제공하지 않습니다.</div><Panel title="변경 내용"><form className="stack" onSubmit={async event => { event.preventDefault(); setBusy(true); setResult(null); setError(null); try { setResult(await post<Answer>('/impact/draft', { targetId, description })); } catch(e) { if ((e as Error).name !== 'AbortError') { setError(e as Error); if(e instanceof ApiError && e.status === 502) setResult(e.details as Answer); } } finally { setBusy(false); } }}><label>대상 시스템<select aria-label="대상 시스템" required value={targetId} onChange={event => setTargetId(event.target.value)}><option value="">등록된 시스템 선택</option>{systems.data?.items.map(item => <option value={item.id} key={item.id}>{label(item)}</option>)}</select></label><label>변경 설명<textarea required value={description} rows={4} onChange={event => setDescription(event.target.value)} placeholder="변경하는 작동원리, 대상과 예상 영향을 입력하세요."/></label><div className="actions"><button className="primary" disabled={busy || !targetId || !description.trim()}>{busy ? '영향 계산·초안 생성 중…' : '영향평가 초안 생성'}</button></div></form><ErrorNotice error={systems.error}/>{systems.data && !systems.data.items.length && <p className="muted">평가할 시스템이 등록되지 않았습니다.</p>}</Panel><ErrorNotice error={error}/>{result && <div className="split-view"><Panel title="계산된 영향 범위">{result.impactSet ? <><p>검증된 변경 의존 관계로 계산한 결과입니다.</p><ResultDetails value={result.computed ?? result.impactSet} title="영향 대상과 모든 근거 경로" open/></> : <Empty>반환된 영향 집합이 없습니다.</Empty>}<EvidenceList items={result.citations ?? result.grounding?.sources.flatMap(source => source.evidenceRefs)}/></Panel><Panel title="생성 초안" actions={<Status value="draft"/>}>{draft ? <><Source markdown={draft} exportText={exportText} filename="impact-draft.md"/><div className="actions"><button onClick={() => void navigator.clipboard.writeText(exportText)}>초안 복사</button></div></> : <Empty>초안 생성이 완료되지 않았습니다.</Empty>}<p className="muted">LLM의 추가 제안은 계산된 영향 집합에 포함되지 않습니다.</p><ResultDetails value={result} title="응답 전체" filename="impact-result.json"/></Panel></div>}<Panel title="관련 양식"><ItemList items={(forms.data?.items ?? []).filter(item => /06-02-F0[1-4]/.test(String(item.documentCode)))} to={item => `/documents/${item.id}`} empty="등록된 F01~F04 양식이 없습니다."/></Panel></>;
}
