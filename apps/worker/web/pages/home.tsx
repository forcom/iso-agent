import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, label, personId, post, type Me, type Collection, type Artifact, type Item, type Evidence } from '../api';
import { useLoad, useSession } from '../session';
import { Empty, ErrorNotice, EvidenceList, Icon, ItemList, Loading, Modal, PageTitle, Panel, Status } from '../components/ui';
import { Ask } from './knowledge';
import { UploadModal } from './artifacts';

export function HomePage() {
  const { me, recent } = useSession();
  const recentArtifacts=useLoad<Collection<Artifact>>(recent.length?'/artifacts':null);
  const reviews = useLoad<Collection>('/reviews');
  const circulations = useLoad<Collection>('/circulations');
  const [upload,setUpload] = useState(false);
  return <><PageTitle title="업무 홈" description="문서와 근거를 확인하고, 필요한 검토를 시작하세요."/><div className="quick-links"><Link to="/documents"><Icon name="document"/><span>문서 찾아보기</span></Link><button onClick={() => setUpload(true)}><Icon name="records"/><span>기록 업로드</span></button><Link to="/impact"><Icon name="impact"/><span>영향평가 초안</span></Link></div><div className="home-columns"><div className="stack"><Ask compact/><Panel title="최근 확인한 자료" actions={<Link to="/documents">전체 자료 보기</Link>}>{recent.length ? <ul className="item-list">{recent.map(item => <li key={item.id}><Link to={`/${item.kind === 'record' ? 'records' : 'documents'}/${item.id}`}><span>{label(recentArtifacts.data?.items.find(artifact=>artifact.id===item.id)??{id:item.id})}</span><small>{new Date(item.at).toLocaleTimeString('ko-KR')}</small></Link></li>)}</ul> : <Empty>이 세션에서 열람한 자료가 없습니다.</Empty>}</Panel></div><div className="stack"><Panel title="내 검토 대기" actions={<Link to="/reviews">검토함</Link>}><ErrorNotice error={reviews.error} retry={reviews.refresh}/>{reviews.loading ? <Loading/> : reviews.data && <ItemList items={reviews.data.items} to={item => `/reviews/records/${item.revisionId ?? item.id}`} empty="검토할 대상이 없습니다."/>}</Panel><Panel title="내 회람확인" actions={<Link to="/reviews?tab=circulations">회람함</Link>}><ErrorNotice error={circulations.error} retry={circulations.refresh}/>{circulations.loading ? <Loading/> : circulations.data && <p>지정된 회람 {circulations.data.items.length}건</p>}</Panel><Panel title="현재 역할과 근거">{me?.roles.length ? me.roles.map(role => <div className="role-summary" key={role.id}><strong>{String(role.roleName ?? role.roleId ?? label(role))}</strong><EvidenceList items={role.evidenceRefs as Evidence[] | undefined}/></div>) : <Empty>유효한 역할 지정이 없습니다.</Empty>}<p className="muted">임직원 공통 열람과 기능별 변경 권한은 별도로 판단합니다.</p></Panel></div></div>{upload && <UploadModal onClose={() => setUpload(false)}/>}</>;
}
export function ReviewsPage() {
  const {me} = useSession();
  const artifacts=useLoad<Collection<Artifact>>('/artifacts?kind=record');
  const reviews = useLoad<Collection>('/reviews');
  const circulations = useLoad<Collection>('/circulations');
  const [selected,setSelected] = useState<Item | null>(null);
  return <><PageTitle title="검토·회람함" description="해당 버전에 대한 판단 권한과 지정 수신자 여부를 확인합니다."/><div className="split-view"><Panel title="기록 검토·승인"><ErrorNotice error={reviews.error} retry={reviews.refresh}/>{reviews.loading ? <Loading/> : reviews.data && <ItemList items={reviews.data.items} to={item => `/reviews/records/${item.revisionId ?? item.id}`} empty="판단 권한이 있는 검토 대상이 없습니다."/>}</Panel><Panel title="내 회람확인"><ErrorNotice error={circulations.error} retry={circulations.refresh}/>{circulations.loading ? <Loading/> : circulations.data?.items.length ? <ul className="item-list">{circulations.data.items.map(item => <li key={item.id}><button className="row-button" onClick={() => setSelected({...item,title:artifacts.data?.items.find(artifact=>artifact.id===item.artifactId)?.title})}><span>{label(artifacts.data?.items.find(artifact=>artifact.id===item.artifactId)??item)}<small>대상 버전 {String(item.revisionId)}</small></span><Status value={String(((item.receipts ?? []) as Item[]).filter(receipt => receipt.personId === me?.actor?.personId).some(receipt => receipt.kind === 'understood') ? 'understood' : ((item.receipts ?? []) as Item[]).filter(receipt => receipt.personId === me?.actor?.personId).some(receipt => receipt.kind === 'received') ? 'received' : 'pending')}/></button></li>)}</ul> : circulations.data && <Empty>지정된 회람이 없습니다.</Empty>}</Panel></div>{selected && <ReceiptModal item={selected} onClose={() => setSelected(null)} onSuccess={circulations.refresh}/>}</>;
}
function ReceiptModal({ item, onClose, onSuccess }: { item: Item; onClose: () => void; onSuccess: () => void }) {
  const { me, refresh } = useSession();
  const [received,setReceived] = useState(false);
  const [understood,setUnderstood] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState<Error | null>(null);
  return <Modal title="본인 회람확인" onClose={onClose}><form className="stack" onSubmit={async event => { event.preventDefault(); setBusy(true); try { await post(`/circulations/${item.id}/receipts`, { revisionId: item.revisionId, kind: 'received', expectedContext: me?.context }); if (understood) { const current=await api<Me>('/me'); await post(`/circulations/${item.id}/receipts`, { revisionId: item.revisionId, kind: 'understood', expectedContext: current.context }); } await refresh(); onSuccess(); onClose(); } catch(e) { setError(e as Error); } finally { setBusy(false); } }}><h3>{label(item)}</h3><p>{String(item.purpose ?? '')}</p>{item.approvalScope === 'record' && <p className="notice">문서·계획 승인본입니다. 후속 조치 완료나 실제 운영·종결 승인을 뜻하지 않습니다.</p>}<p className="mono">대상 버전 {String(item.revisionId)}</p><Link to={`/records/${item.artifactId}?revision=${item.revisionId}`} onClick={onClose}>지정된 원문 열기</Link><p>확인자: {me?.actor?.name}. 이 확인은 승인이나 ISO 적합성 판단이 아닙니다.</p><label className="checkbox"><input type="checkbox" checked={received} onChange={event => { setReceived(event.target.checked); if (!event.target.checked) setUnderstood(false); }}/>이 버전의 자료를 수령했습니다.</label><label className="checkbox"><input type="checkbox" checked={understood} disabled={!received} onChange={event => setUnderstood(event.target.checked)}/>전달 내용을 이해했습니다.</label><ErrorNotice error={error}/><div className="actions"><button type="button" onClick={onClose}>취소</button><button className="primary" disabled={!received || busy}>본인 확인 제출</button></div></form></Modal>;
}
