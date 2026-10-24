import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { REGULATION_HIERARCHY } from '../../../packages/ontology/src/index';
import { ApiError, api, recalledCitation, label, mutationContext, post, stateOf, type ActionSet, type Artifact, type Collection, type Content, type Detail, type Evidence, type Item, type Person, personId } from '../api';
import { useDirty, useLoad, useSession } from '../session';
import { useWorkspaceTab } from '../workspace-tabs';
import { actionReason, eventLabel, Empty, ErrorNotice, EvidenceList, ItemList, ResultDetails, Loading, Modal, PageTitle, Panel, Source, Status } from '../components/ui';

const documentTypes: Record<string, string> = { ...Object.fromEntries(Object.entries(REGULATION_HIERARCHY).map(([kind, value]) => [kind, value.label])), template: '빈 양식' };
function artifactTypeLabel(artifact: Artifact) { return artifact.kind === 'record' ? '기록' : documentTypes[artifact.regulationType ?? artifact.kind] ?? '유형 미확인'; }

export function ArtifactList({ records = false }: { records?: boolean }) {
  const [params, setParams] = useSearchParams();
  const [upload, setUpload] = useState(false);
  const [query, setQuery] = useState(params.get('q') ?? '');
  const kind = params.get('kind') === 'regulation' ? '' : params.get('kind') ?? '';
  const load = useLoad<Collection<Artifact>>(`/artifacts?${new URLSearchParams({ category: records ? 'records' : 'documents', q: params.get('q') ?? '', kind: records ? 'record' : kind })}`);
  const items = load.data?.items.filter(item => records ? item.kind === 'record' : item.kind !== 'record') ?? [];
  return <><PageTitle title={records ? '기록관리' : '규정·양식'} description={records ? '업로드한 기록과 버전별 검토·승인 이력을 확인합니다.' : '매뉴얼·절차서·지침서·빈 양식과 시행 버전을 확인합니다.'} actions={records ? <button className="primary" onClick={() => setUpload(true)}>기록 업로드</button> : <Link className="button" to="/admin/regulations">규정 제·개정</Link>}/>
    <form className="filter-band" onSubmit={event => { event.preventDefault(); setParams({ q: query, kind }); }}><label>검색어<input value={query} onChange={event => setQuery(event.target.value)} placeholder="문서번호 또는 제목"/></label>{!records && <label>문서 유형<select aria-label="문서 유형" value={kind} onChange={event => setParams({ q: query, kind: event.target.value })}><option value="">전체</option>{Object.entries(documentTypes).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>}<button className="primary">조회</button><button type="button" onClick={() => { setQuery(''); setParams({}); }}>초기화</button></form>
    <ErrorNotice error={load.error} retry={load.refresh}/>{load.loading ? <Loading/> : load.data && <Panel><div className="table-caption">{items.length}개 자료 <span>전체 임직원 공통 열람</span></div><ArtifactTable items={items}/></Panel>}
    {upload && <UploadModal onClose={() => setUpload(false)}/>}
  </>;
}
export function ArtifactTable({ items }: { items: Artifact[] }) { return items.length ? <div className="table-wrap"><table><thead><tr><th>문서번호</th><th>자료명</th><th>유형</th><th>버전</th><th>보기</th></tr></thead><tbody>{items.map(item => <tr key={item.id}><td className="mono">{item.documentCode}</td><td><Link to={`/${item.kind === 'record' ? 'records' : 'documents'}/${item.id}`}>{label(item)}</Link></td><td>{artifactTypeLabel(item)}</td><td>{item.effectiveRevisionId ? (item.kind === 'record' ? '승인·등록본 있음' : '시행본 있음') : item.workingRevisionId ? '작업본' : '미등록'}</td><td><Link to={`/${item.kind === 'record' ? 'records' : 'documents'}/${item.id}`}>원문</Link></td></tr>)}</tbody></table></div> : <Empty/>; }
export function UploadModal({ artifact, research, onClose, onSuccess }: { artifact?: Artifact; research?:{proposalId:string;recordTypeId:string;scope:string;title:string}; onClose: () => void; onSuccess?: () => void }) {
  const { me, refresh: refreshSession } = useSession();
  const navigate = useNavigate();
  const types = useLoad<Collection>('/entities?kind=RecordType');
  const systems = useLoad<Collection>('/entities?kind=AISystem');
  const [recordTypeId,setRecordTypeId] = useState(research?.recordTypeId ?? artifact?.recordTypeIds?.[0] ?? '');
  const [additionalTypes,setAdditionalTypes] = useState<string[]>([]);
  const selectedTypes = artifact?.recordTypeIds ?? [recordTypeId,...additionalTypes.filter(id=>id!==recordTypeId)].filter(Boolean);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const [modified,setModified] = useState(false);
  useDirty(modified || Boolean(file) || busy);
  const close = () => { if ((!file && !modified) || window.confirm('입력한 내용과 선택한 파일은 저장되지 않습니다. 닫으시겠습니까?')) onClose(); };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!file) return;
    if (!file.name.toLowerCase().endsWith('.md')) { setError(new Error('UTF-8 Markdown(.md) 파일을 선택하세요.')); return; }
    const form = new FormData(event.currentTarget); form.set('file', file); form.set('requestKey', crypto.randomUUID()); form.set('expectedContext', JSON.stringify(me?.context)); if (artifact?.workingRevisionId) form.set('expectedRevisionId',artifact.workingRevisionId);
    if(research)form.set('researchProposalId',research.proposalId);
    const recordTypes = selectedTypes;
    if(recordTypes.length>1)form.set('fieldMappings',JSON.stringify(Object.fromEntries(recordTypes.map(id=>[id,String(form.get(`mapping-${id}`)??'')]))));
    form.set('recordTypeIds',JSON.stringify(recordTypes));
    form.set('templateRevisionIds',JSON.stringify(recordTypes.map(id => (types.data?.items.find(item => item.id === id)?.metadata as {templateRevisionId?: string} | undefined)?.templateRevisionId).filter(Boolean)));
    if (artifact) { form.set('documentCode',artifact.documentCode); form.set('title',artifact.title ?? artifact.documentCode); }
    setBusy(true); setError(null);
    try { const result = await api<{ artifact?: Artifact; id?: string; artifactId?: string }>(artifact ? `/records/${artifact.id}/revisions` : '/records', { method: 'POST', body: form }); setFile(null); await refreshSession(); onSuccess?.(); onClose(); const id = result.artifact?.id ?? result.artifactId ?? result.id ?? artifact?.id; if (id) navigate(`/records/${id}`); }
    catch (e) { if ((e as Error).name !== 'AbortError') setError(e as Error); } finally { setBusy(false); }
  }
  return <Modal title={artifact ? '새 버전 업로드' : '기록 업로드'} onClose={close}><form onSubmit={submit} onChange={()=>setModified(true)} className="stack"><p className="muted">UTF-8 Markdown(.md) 원본 파일을 등록합니다. 업로드는 내용 승인이나 수행 증명이 아닙니다.</p>{research&&<p className="notice">선택한 조사 제안과 근거 이력을 연결합니다. 외부 원문 미검증·사내 미확인 항목을 검토한 뒤 파일을 등록하세요.</p>}{!artifact && <><label>문서번호<input required name="documentCode" maxLength={120}/></label><label>기록명<input required name="title" maxLength={240} defaultValue={research?.title}/></label><label>기록 유형<select aria-label="기록 유형" required name="recordTypeId" value={recordTypeId} onChange={event => setRecordTypeId(event.target.value)}><option value="">기록 유형 선택</option>{types.data?.items.map(item => <option key={item.id} value={item.id}>{label(item)}</option>)}</select></label><ErrorNotice error={types.error} retry={types.refresh}/></>}
    {!artifact && <details><summary>여러 양식을 통합한 기록</summary><p className="muted">해당하는 추가 기록 유형을 선택하고 각 유형에 대응하는 원문 항목을 확인합니다.</p>{types.data?.items.filter(item=>item.id!==recordTypeId).map(item=><label className="checkbox" key={item.id}><input type="checkbox" checked={additionalTypes.includes(item.id)} onChange={event=>setAdditionalTypes(ids=>event.target.checked?[...ids,item.id]:ids.filter(id=>id!==item.id))}/>{label(item)}</label>)}</details>}{selectedTypes.length>1 && <fieldset><legend>통합 기록의 항목 대응</legend>{selectedTypes.map(id=><label key={id}>{label(types.data?.items.find(item=>item.id===id)??{id})}의 원문 항목<input required name={`mapping-${id}`} placeholder="파일에 기재된 정확한 항목 문구"/></label>)}</fieldset>}<label>대상 시스템<select aria-label="대상 시스템" name="scope" defaultValue={research?.scope ?? artifact?.systemIds?.[0] ?? ''}><option value="">특정 시스템 없음</option>{systems.data?.items.map(item => <option value={item.id} key={item.id}>{label(item)}</option>)}</select></label><label className="file-field">Markdown 파일<input type="file" accept=".md,text/markdown" required onChange={event => setFile(event.target.files?.[0] ?? null)}/></label>{file && <p>{file.name} · {Math.ceil(file.size / 1024)} KB</p>}<ErrorNotice error={error}/><div className="actions"><button type="button" onClick={close}>취소</button><button className="primary" disabled={busy || !file || types.loading}>{busy ? '업로드 중…' : '파일 등록'}</button></div></form></Modal>;
}
export function ArtifactDetail({ review = false }: { review?: boolean }) {
  const { id, revisionId: reviewRevisionId } = useParams();
  const [params, setParams] = useSearchParams();
  const { visit, dirty } = useSession();
  const citation = recalledCitation(params.get('citation'));
  const load = useLoad<Detail>(review ? `/artifacts/by-revision/${reviewRevisionId}` : `/artifacts/${id}`);
  const artifact = load.data?.artifact;
  const currentTarget=artifact&&(review?load.data?.revisions.some(revision=>revision.id===reviewRevisionId):artifact.id===id)?artifact:undefined;
  const tabPaths=useMemo(()=>currentTarget?[
    `/documents/${currentTarget.id}`,`/records/${currentTarget.id}`,
    ...(load.data?.revisions??[]).flatMap(revision=>[`/sources/${revision.id}`,`/reviews/records/${revision.id}`]),
  ]:undefined,[currentTarget,load.data?.revisions]);
  useWorkspaceTab(currentTarget?`artifact:${currentTarget.id}`:undefined,currentTarget?label(currentTarget):undefined,tabPaths);
  const revisionId = params.get('revision') ?? reviewRevisionId ?? artifact?.workingRevisionId ?? artifact?.effectiveRevisionId ?? load.data?.revisions[0]?.id;
  const currentRevision = load.data?.revisions.find(item => item.id === revisionId);
  const content = useLoad<Content>(artifact && revisionId ? `/artifacts/${artifact.id}/revisions/${revisionId}/content` : null);
  const queue = useLoad<Collection<Artifact>>('/artifacts');
  const actions = useLoad<ActionSet>(artifact?.kind === 'record' ? `/records/${artifact.id}/actions?revisionId=${revisionId}` : null);
  const currentActions = currentTarget && !actions.loading && actions.data?.revisionId === revisionId ? actions.data : null;
  const [upload, setUpload] = useState(false);
  const [pane, setPane] = useState('source');
  const [compare, setCompare] = useState('');
  const comparison = useLoad<Content>(artifact && compare ? `/artifacts/${artifact.id}/revisions/${compare}/content` : null);
  useEffect(() => { setCompare(''); if (artifact) visit(artifact.id, artifact.kind); }, [artifact?.id, visit]);
  const refresh = () => { load.refresh(); content.refresh(); actions.refresh(); };
  if (load.loading && !load.data) return <Loading/>;
  if (reviewRevisionId && load.error instanceof ApiError && load.error.status === 404) return <IndexSource revisionId={reviewRevisionId}/>;
  if (load.error) return <ErrorNotice error={load.error} retry={load.refresh}/>;
  if (!artifact || !load.data) return <Empty/>;
  return <><PageTitle title={label(artifact)} description={`${artifact.documentCode} · ${artifactTypeLabel(artifact)}`} actions={<><Link className="button" to={`/trace?mode=neighbors&id=${artifact.id}`}>주변 관계</Link>{artifact.kind==='record'&&<Link className="button" to={`/research?baseRevisionId=${encodeURIComponent(artifact.workingRevisionId??'')}&${(artifact.recordTypeIds??[]).map(type=>`type=${encodeURIComponent(type)}`).join('&')}&systemId=${encodeURIComponent(artifact.systemIds?.[0]??'')}`}>관련 조사 요청</Link>}{artifact.kind === 'record' && <button disabled={!currentActions?.actions.find(action => action.action === 'revise')?.allowed} onClick={() => setUpload(true)}>새 버전 업로드</button>}</>}/>
    <div className="mobile-panes" role="tablist" aria-label="자료 상세 영역">{[['list','목록'],['source','원문'],['decision','판단·이력']].map(([value,text]) => <button role="tab" aria-selected={pane === value} key={value} onClick={() => setPane(value)}>{text}</button>)}</div>
    <div className={`workbench pane-${pane}`}><aside className="workbench-list panel"><div className="panel-heading"><h2>자료 목록</h2></div><ItemList items={queue.data?.items ?? []} to={item => `/${item.kind === 'record' ? 'records' : 'documents'}/${item.id}`}/></aside>
    <section className="workbench-source panel"><div className="panel-heading"><h2>원문</h2><Status value={stateOf(currentRevision)}/></div><div className="panel-body">{currentRevision?.research && <p><Link to={`/research/jobs/${encodeURIComponent(currentRevision.research.jobId)}`}>조사 제안·근거 보기</Link></p>}<div className="version-toolbar"><label>열람 버전<select aria-label="열람 버전" value={revisionId ?? ''} onChange={event => { if (!dirty || window.confirm('제출하지 않은 의견이 사라집니다. 열람 버전을 변경하시겠습니까?')) setParams({ revision: event.target.value }); }}>{load.data.revisions.map((rev,i) => <option key={rev.id} value={rev.id}>{i + 1} · {rev.createdAt ?? rev.id} · {stateOf(rev)}</option>)}</select></label><label>비교 버전<select aria-label="비교 버전" value={compare} onChange={event => setCompare(event.target.value)}><option value="">비교 안 함</option>{load.data.revisions.filter(rev => rev.id !== revisionId).map(rev => <option key={rev.id} value={rev.id}>{rev.createdAt ?? rev.id}</option>)}</select></label></div><ErrorNotice error={content.error} retry={content.refresh}/>{content.loading && <Loading/>}{content.data && <><p className="meta"><Status value={content.data.evidenceStatus}/><span className="mono">SHA-256 {content.data.revision.sourceSha256 ?? content.data.revision.sourceHash ?? '미제공'}</span></p><Source key={`${content.data.revision.id}:${citation?.quote ?? ""}`} filename={`${artifact.documentCode}-${content.data.revision.id}.md`} downloadUrl={`/api/artifacts/${encodeURIComponent(artifact.id)}/revisions/${encodeURIComponent(content.data.revision.id)}/content?download=1`} markdown={content.data.markdown} citation={citation} sourceHash={content.data.revision.sourceSha256} links={queue.data?.items}/></>}{compare && <Panel title="비교 대상 원문"><ErrorNotice error={comparison.error}/>{comparison.data && <Source key={comparison.data.revision.id} filename={`${artifact.documentCode}-${comparison.data.revision.id}.md`} downloadUrl={`/api/artifacts/${encodeURIComponent(artifact.id)}/revisions/${encodeURIComponent(comparison.data.revision.id)}/content?download=1`} markdown={comparison.data.markdown} links={queue.data?.items}/>}</Panel>}</div></section>
    <aside className="workbench-decision stack">{artifact.kind === 'record' && revisionId && <RecordActions key={`${artifact.id}:${revisionId}`} artifact={artifact} revisionId={revisionId} actions={!content.loading && content.data?.revision.id === revisionId ? currentActions : null} error={actions.error} onSuccess={refresh}/>}<Panel title="버전·결정 이력">{load.data.events.length ? <ol className="timeline">{load.data.events.map(event => <li key={event.id}><strong>{eventLabel(event.action ?? event.kind ?? event.type ?? label(event))}{event.approvalScope === 'record' ? ' · 문서·계획 범위' : ''}</strong><p>{String(event.reason ?? event.comment ?? '')}</p><small>{String(event.createdAt ?? event.at ?? '')} · {String(event.actorName ?? event.actorId ?? '')}</small></li>)}</ol> : <Empty>등록된 결정 이력이 없습니다.</Empty>}</Panel>{load.data.relations?.length ? <ResultDetails value={load.data.relations} title="이 자료의 관계 근거"/> : null}</aside></div>{upload && <UploadModal artifact={artifact} onClose={() => setUpload(false)} onSuccess={refresh}/>}</>;
}
function IndexSource({ revisionId }: { revisionId: string }) {
  const [params] = useSearchParams();
  const load = useLoad<{source: {title: string; code: string; sha256: string}; markdown: string; evidenceStatus: string}>(`/source-index/${encodeURIComponent(revisionId)}`);
  useWorkspaceTab(load.data ? `source-index:${revisionId}` : undefined, load.data?.source.title);
  if (load.loading) return <Loading/>;
  if (load.error) return <ErrorNotice error={load.error} retry={load.refresh}/>;
  if (!load.data) return <Empty/>;
  const {source, markdown, evidenceStatus} = load.data;
  return <><PageTitle title={source.title} description={`${source.code} · 문서체계·목차 원문`}/><Panel title="원문"><p className="meta"><Status value={evidenceStatus}/><span className="mono">SHA-256 {source.sha256}</span></p><Source key={revisionId} filename={`${source.code}.md`} downloadUrl={`/api/source-index/${encodeURIComponent(revisionId)}?download=1`} markdown={markdown} citation={recalledCitation(params.get('citation'))} sourceHash={source.sha256}/></Panel></>;
}
function RecordActions({ artifact, revisionId, actions, error, onSuccess }: { artifact: Artifact; revisionId: string; actions: ActionSet | null; error: Error | null; onSuccess: () => void }) {
  const {refresh: refreshSession} = useSession();
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Error | null>(null);
  const [success, setSuccess] = useState('');
  const [circulation, setCirculation] = useState(false);
  const [approvalScope, setApprovalScope] = useState<'record'|'outcome'|undefined>();
  useDirty(Boolean(comment) || busy);
  const requestedScope = actions?.actions.some(item => item.action === 'submit' && item.allowed) ? approvalScope ?? actions.approvalScope : actions?.approvalScope;
  const labels: Record<string,string> = { submit: '검토 요청', review: '검토 완료', approve: actions?.approvalScope === 'record' ? actions.recordApproval?.label ?? '기록 승인' : '승인', reject: '반려', circulate: '회람 개시', update: '새 버전 등록', create: '기록 등록' };
  async function act(action: string) {
    if (!actions) return;
    if (action === 'circulate') { setCirculation(true); return; }
    setBusy(true); setFailure(null); setSuccess('');
    try { await post(action === 'submit' ? `/records/${artifact.id}/submit` : `/revisions/${revisionId}/decisions`, { ...mutationContext(actions), action, decision: action, approvalScope: action === 'submit' ? approvalScope ?? actions.approvalScope ?? 'outcome' : actions.approvalScope, reason: comment, comment }); setComment(''); await refreshSession(); setSuccess(`${labels[action]} 처리되었습니다.`); onSuccess(); }
    catch (e) { if ((e as Error).name !== 'AbortError') setFailure(e as Error); } finally { setBusy(false); }
  }
  return <Panel title="기록 검토·판단"><p className="meta mono">대상 버전 {revisionId}</p><p className="muted">판단은 이 버전에만 적용됩니다. 직원 선택은 실제 본인 인증이나 전자서명이 아닙니다.</p><ErrorNotice error={error ?? failure}/>{!actions && !error && <Loading/>}{success && <p role="status" className="notice success">{success}</p>}{actions && <><Status value={actions.state}/>{actions.recordApproval && <><p className="notice">{requestedScope === 'record' ? `${actions.recordApproval.label} · ${actions.recordApproval.limitations}` : '최종 결과 승인 범위입니다. 필요한 검토와 통제 이행 확인이 모두 충족되어야 합니다.'}</p>{actions.actions.some(item => item.action === 'submit' && item.allowed) && <label>요청할 승인 범위<select value={approvalScope ?? actions.approvalScope ?? 'outcome'} onChange={event => setApprovalScope(event.target.value as 'record'|'outcome')}><option value="outcome">최종 결과 승인</option><option value="record">{actions.recordApproval.label}</option></select></label>}</>}{actions.conditions?.length ? <ConditionConfirmations artifactId={artifact.id} actions={actions} onSuccess={onSuccess}/> : null}<label>검토 의견<textarea rows={5} value={comment} onChange={event => setComment(event.target.value)} placeholder="검토 내용과 판단 근거를 입력하세요."/></label><div className="decision-actions">{actions.actions.filter(item => ['submit','review','approve','reject','circulate'].includes(item.action)).map(item => <div key={item.action}><button className={item.action === 'approve' ? 'primary' : ''} disabled={!item.allowed || busy} onClick={() => void act(item.action)}>{labels[item.action]}</button>{!item.allowed && <small>{actionReason(item.reason)}</small>}</div>)}</div><details><summary>허용 동작과 규정 근거</summary>{actions.actions.map(item => <div key={item.action}><strong>{labels[item.action] ?? item.action} · {item.allowed ? '허용' : '불허'}</strong><p>{actionReason(item.reason)}</p><EvidenceList items={item.evidenceRefs}/></div>)}</details></>}{circulation && actions && <CirculationModal revisionId={revisionId} actions={actions} onClose={() => setCirculation(false)} onSuccess={onSuccess}/>}</Panel>;
}
function CirculationModal({ revisionId, actions, onClose, onSuccess }: { revisionId: string; actions: ActionSet; onClose: () => void; onSuccess: () => void }) {
  const people = useLoad<Collection<Person>>('/persons');
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  return <Modal title="회람 대상 지정" onClose={onClose}><form className="stack" onSubmit={async event => { event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); try { await post(`/revisions/${revisionId}/circulations`, { ...mutationContext(actions), recipientIds: selected, purpose: form.get('purpose') }); onSuccess(); onClose(); } catch(e) { setError(e as Error); } finally { setBusy(false); } }}><p>수신자와 이 버전을 고정하여 회람합니다.</p><label>전달 목적<input required name="purpose"/></label><fieldset><legend>수신자</legend>{people.data?.items.filter(person => person.active).map(person => <label className="checkbox" key={personId(person)}><input type="checkbox" value={personId(person)} onChange={event => setSelected(ids => event.target.checked ? [...ids,personId(person)] : ids.filter(id => id !== personId(person)))}/>{person.name}</label>)}</fieldset><ErrorNotice error={error ?? people.error}/><div className="actions"><button type="button" onClick={onClose}>취소</button><button className="primary" disabled={busy || !selected.length}>회람 개시</button></div></form></Modal>;
}

function ConditionConfirmations({artifactId,actions,onSuccess}: {artifactId:string;actions:ActionSet;onSuccess:()=>void}) {
  const {refresh} = useSession();
  const people=useLoad<Collection<Person>>('/persons');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<Error|null>(null);
  const [modified,setModified]=useState(false);
  useDirty(modified||busy);
  return <details><summary>적용 조건 확인 · {actions.conditions?.filter(condition=>condition.value===null).length ?? 0}개 미확인</summary><p className="muted">이 버전의 정확한 원문과 확인 의견으로 조건을 검증합니다.</p><form className="stack" onChange={()=>setModified(true)} onSubmit={async event=>{event.preventDefault();const data=new FormData(event.currentTarget);const confirmations=(actions.conditions??[]).filter(condition=>data.getAll(condition.field).some(Boolean)).map(condition=>({field:condition.field,value:condition.kind==='people'?data.getAll(condition.field).map(String).filter(Boolean):condition.kind==='person'?String(data.get(condition.field)):data.get(condition.field)==='true',lineStart:Number(data.get(`${condition.field}-start`)),lineEnd:Number(data.get(`${condition.field}-end`)),quote:String(data.get(`${condition.field}-quote`)),comment:String(data.get(`${condition.field}-comment`))}));setBusy(true);setError(null);try{await post(`/records/${artifactId}/conditions`,{...mutationContext(actions),confirmations});setModified(false);await refresh();onSuccess();}catch(e){setError(e as Error);}finally{setBusy(false);}}}>{actions.conditions?.map(condition=><fieldset key={condition.field}><legend>{condition.reason}</legend><p>현재 값: {condition.value===null?'미확인':condition.kind==='people'?(condition.value as string[]).map(id=>people.data?.items.find(person=>personId(person)===id)?.name??id).join(', '):condition.kind==='person'?(people.data?.items.find(person=>personId(person)===condition.value)?.name??String(condition.value)):condition.value?'해당함':'해당하지 않음'}</p><EvidenceList items={condition.evidenceRefs}/><label>확인 결과<select name={condition.field} multiple={condition.kind==='people'} aria-label={`${condition.reason} 확인 결과`}><option value="">선택 안 함</option>{(condition.kind==='person'||condition.kind==='people')?people.data?.items.map(person=><option key={personId(person)} value={personId(person)}>{person.name}</option>):<><option value="true">해당함</option><option value="false">해당하지 않음</option></>}</select></label><div className="form-grid"><label>시작 행<input name={`${condition.field}-start`} type="number" min="1"/></label><label>끝 행<input name={`${condition.field}-end`} type="number" min="1"/></label></div><label>정확한 원문 인용<textarea name={`${condition.field}-quote`} rows={3}/></label><label>확인 의견<textarea name={`${condition.field}-comment`} rows={2}/></label></fieldset>)}<ErrorNotice error={error}/><button disabled={busy}>조건 확인 제출</button></form></details>;
}
