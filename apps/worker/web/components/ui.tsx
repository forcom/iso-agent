import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, rememberCitation, type Evidence, type Item, label } from '../api';

export { Source, Download, ResultDetails, DataValue, MarkdownBody } from './content';

const states: Record<string, string> = { draft: '초안', registered: '등록 완료', built: '구축 완료', submitted: '검토 요청', in_review: '검토 중', reviewed: '검토 완료', approved: '승인', rejected: '반려', effective: '시행 중', published: '시행 중', verified: '근거 확인', changed: '근거 변경', unavailable: '근거 미확보', unrecorded: '근거 미기록', validated: '검증 완료', candidate: '검토 후보', building: '재구축 중', failed: '실패', pending: '확인 대기', received: '수령 확인', understood: '이해 확인' };
export function Status({ value }: { value?: string }) { return <span className={`status status-${value ?? 'unknown'}`}>{states[value ?? ''] ?? value ?? '미확인'}</span>; }
export function Empty({ children = '등록된 자료가 없습니다.' }: { children?: ReactNode }) { return <div className="empty">{children}</div>; }
export function ErrorNotice({ error, retry }: { error: Error | null; retry?: () => void }) {
  if (!error) return null;
  const apiError = error instanceof ApiError ? error : null;
  return <div className="notice error" role="alert"><strong>{apiError?.code === 'ENGINE_UNAVAILABLE' ? '계산 엔진에 연결할 수 없습니다.' : apiError?.code === 'LLM_UNAVAILABLE' ? '답변 생성에 실패했습니다. 계산 근거는 아래에서 확인하세요.' : '요청을 처리하지 못했습니다.'}</strong><p>{error.message}</p>{apiError && <code>{apiError.status} · {apiError.code}</code>}{retry && <button onClick={retry}>다시 조회</button>}</div>;
}
export function Loading() { return <div role="status" className="empty">자료를 불러오는 중입니다…</div>; }
export function PageTitle({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) { return <div className="page-title"><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="actions">{actions}</div>}</div>; }
export function Panel({ title, children, actions, className = '' }: { title?: string; children: ReactNode; actions?: ReactNode; className?: string }) { return <section className={`panel ${className}`}>{title && <div className="panel-heading"><h2>{title}</h2>{actions}</div>}<div className="panel-body">{children}</div></section>; }
export function ItemList({ items, to, empty }: { items: Item[]; to: (item: Item) => string; empty?: string }) { return items.length ? <ul className="item-list">{items.map(item => <li key={item.id}><Link to={to(item)}><span>{label(item)}<small>{String(item.documentCode ?? item.code ?? item.id)}</small></span><Status value={String(item.state ?? item.status ?? 'candidate')}/></Link></li>)}</ul> : <Empty>{empty}</Empty>; }
export function EvidenceList({ items = [] }: { items?: Evidence[] }) { return items.length ? <ul className="evidence-list">{items.map((item, i) => <li key={`${item.id ?? item.revisionId}-${i}`}><Link to={`/sources/${encodeURIComponent(item.revisionId)}?line=${item.lineStart ?? ''}&citation=${encodeURIComponent(`${item.revisionId}:${item.lineStart}:${item.lineEnd}`)}`} onClick={() => rememberCitation(`${item.revisionId}:${item.lineStart}:${item.lineEnd}`,item)}>{item.revisionId}{item.lineStart ? ` · ${item.lineStart}–${item.lineEnd ?? item.lineStart}행` : ''}</Link>{item.quote && <blockquote>{item.quote}</blockquote>}<small>{(item.sourceSha256 ?? item.sourceHash) ? `SHA-256 ${item.sourceSha256 ?? item.sourceHash}` : '해시 정보 미제공'}</small></li>)}</ul> : <p className="muted">연결된 인용이 없습니다.</p>; }
export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef(document.activeElement as HTMLElement);
  useEffect(() => { const dialog=ref.current; dialog?.showModal(); return () => { dialog?.close(); returnFocus.current?.focus(); }; }, []);
  return <dialog ref={ref} onCancel={event => { event.preventDefault(); onClose(); }}><div className="panel-heading"><h2>{title}</h2><button className="icon-button" aria-label="대화상자 닫기" onClick={onClose}>×</button></div><div className="panel-body">{children}</div></dialog>;
}
export function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = { home: 'M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9', document: 'M7 3h7l4 4v14H5V3h2m7 0v5h4M8 12h7M8 16h7', review: 'M8 4H5v17h14V4h-3M9 3h6v4H9V3m-1 11 3 3 5-6', records: 'M5 3h14v18H5V3m3 5h8m-8 4h8m-8 4h5', wiki: 'M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1m0-15c3-2 6-2 9-1v15c-3-1-6-1-9 1V5', graph: 'M4 4h5v5H4V4m11 0h5v5h-5V4M9 6h6M12 6v11m-3 0h6v5H9v-5', impact: 'M5 3h11l3 3v15H5V3m4 8h6m-6 4h6m-3-7v10', search: 'M17 17l5 5M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0', admin: 'M3 7h18M3 17h18M8 3v8m8 2v8', menu: 'M3 6h18M3 12h18M3 18h18' };
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.document}/></svg>;
}

export function actionReason(reason?: string) { return reason === 'NO_VALID_POLICY_ASSIGNMENT_OR_CONDITION' ? '유효한 역할 지정 또는 적용 조건이 없습니다.' : reason ?? '권한이 없습니다.'; }
export function eventLabel(value: unknown) { const labels: Record<string,string> = {validate_knowledge:'지식·권한·위키 검증',record_registered:'기록 등록',submit:'검토 요청',review:'검토 완료',approve:'승인',reject:'반려',circulation_created:'회람 개시',receipt_received:'수령 확인',receipt_understood:'이해 확인'}; return labels[String(value)] ?? String(value ?? '이벤트'); }
