import {ResearchPage,ResearchJobPage} from './pages/research';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { HashRouter, Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { personId } from './api';
import { SessionProvider, useSession } from './session';
import { Empty, ErrorNotice, Icon, Loading } from './components/ui';
import { HomePage, ReviewsPage } from './pages/home';
import { ArtifactDetail, ArtifactList } from './pages/artifacts';
import { ImpactPage, SearchPage, TracePage, WikiPage } from './pages/knowledge';
import { AssignmentsPage, RegulationChangeDetail, RegulationChangesPage, ReleasesPage } from './pages/admin';
import { WorkspaceTabContext, type WorkspaceTab } from './workspace-tabs';

const nav = [
  { to:'/home',label:'업무 홈',icon:'home' }, { to:'/reviews',label:'검토·회람함',icon:'review' },
  { to:'/documents',label:'규정·양식',icon:'document' }, { to:'/records',label:'기록관리',icon:'records' },
  { to:'/wiki',label:'지식 위키',icon:'wiki' }, { to:'/trace',label:'요구사항 추적·Q&A',icon:'graph' },
  { to:'/research',label:'외부 조사',icon:'search' }, { to:'/impact',label:'영향평가 초안',icon:'impact' }, { to:'/search',label:'통합 검색',icon:'search' },
];
const adminNav = [{to:'/admin/regulations',label:'규정 제·개정',icon:'document'},{to:'/admin/assignments',label:'역할 지정·적용',icon:'review'},{to:'/admin/releases',label:'지식 릴리스',icon:'wiki'}];
const homeTab: WorkspaceTab = { id:'menu:/home', to:'/home', label:'업무 홈' };
function Shell() {
  const { me, people, loading, error, epoch, dirty, changePerson, refresh } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const admin = location.pathname.startsWith('/admin');
  const [menu,setMenu] = useState(false);
  const [search,setSearch] = useState('');
  const [workspace,setWorkspace] = useState<{epoch:number;tabs:WorkspaceTab[]}>({epoch,tabs:[homeTab]});
  const tabs=workspace.epoch===epoch?workspace.tabs:[homeTab];
  const activeId=tabs.find(tab=>tab.to===location.pathname+location.search||tab.paths?.includes(location.pathname))?.id??null;
  const registerTab=useCallback((tab:WorkspaceTab) => {
    setWorkspace(previous => {
      const items=previous.epoch===epoch?previous.tabs:[homeTab];
      const existing=items.find(item=>item.id===tab.id);
      if(existing?.to===tab.to&&existing.label===tab.label&&existing.paths?.join('\n')===tab.paths?.join('\n')&&previous.epoch===epoch)return previous;
      return {epoch,tabs:existing?items.map(item=>item.id===tab.id?tab:item):[...items,tab]};
    });
  },[epoch]);
  useEffect(() => { setWorkspace(previous=>previous.epoch===epoch?previous:{epoch,tabs:[homeTab]}); }, [epoch]);
  useEffect(() => {
    setMenu(false);
    const item = [...nav,...adminNav].find(item => location.pathname===item.to);
    if(item)registerTab({id:`menu:${item.to}`,to:location.pathname+location.search,label:item.label});
  }, [location.pathname,location.search,registerTab]);
  function guard(event: React.MouseEvent) {
    if (!dirty) return;
    const anchor = (event.target as Element).closest('a[href]');
    if(anchor?.getAttribute('href')==='#main-content')return;
    if (anchor && anchor.getAttribute('href') !== `#${location.pathname}` && !window.confirm('전송하지 않은 파일·질문·의견이 사라집니다. 화면을 이동하시겠습니까?')) { event.preventDefault(); event.stopPropagation(); }
  }
  function submitSearch(event: FormEvent) { event.preventDefault(); if (search.trim() && (!dirty || window.confirm('전송하지 않은 파일·질문·의견이 사라집니다. 검색 화면으로 이동하시겠습니까?'))) navigate(`/search?q=${encodeURIComponent(search)}`); }
  return <WorkspaceTabContext.Provider value={registerTab}><div className="app-shell" onClickCapture={guard}><a className="skip-link" href="#main-content" onClick={event=>{event.preventDefault();document.getElementById('main-content')?.focus();}}>본문으로 건너뛰기</a><header className="topbar"><button className="menu-toggle icon-button" aria-label="메뉴 열기" aria-expanded={menu} onClick={() => setMenu(value => !value)}><Icon name="menu"/></button><Link className="brand" to="/home">iso-agent</Link><span className="brand-subtitle">에이아이듀 · AI 경영시스템</span><form className="global-search" onSubmit={submitSearch}><Icon name="search"/><input aria-label="통합 검색어" value={search} onChange={event => setSearch(event.target.value)} placeholder="자료·요구사항 검색"/></form><label className="person-picker"><span>직원 선택</span><select aria-label="직원 선택" value={me?.actor ? personId(me.actor) : ''} disabled={loading} onChange={event => void changePerson(event.target.value)}><option value="">직원 선택 필요</option>{people.filter(person => person.active).map(person => <option key={personId(person)} value={personId(person)}>{person.name}{person.fictional ? ` · ${person.jobTitle} (가상)` : ''}</option>)}</select></label></header>
    <aside className={`sidebar${menu ? ' open' : ''}`} aria-label="주 메뉴"><p className="nav-heading">{admin ? '관리자 모드' : '경영시스템'}</p><nav>{(admin ? adminNav : nav).map(item => <NavLink to={item.to} key={item.to} title={item.label}><Icon name={item.icon}/><span>{item.label}</span></NavLink>)}</nav><div className="sidebar-bottom">{admin ? <Link to="/home"><Icon name="home"/><span>ERP로 돌아가기</span></Link> : me?.actor?.isAdmin ? <Link to="/admin/regulations"><Icon name="admin"/><span>관리자 모드</span></Link> : null}<small>ISO/IEC 42001</small></div></aside>{menu && <button className="menu-overlay" aria-label="메뉴 닫기" onClick={() => setMenu(false)}/>}
    <div className="workspace"><nav className="workspace-tabs" aria-label="열린 화면">{tabs.map(tab => <div className={`workspace-tab${activeId === tab.id ? ' active' : ''}`} key={tab.id}><Link to={tab.to} title={tab.label}>{tab.label}</Link>{tab.id !== homeTab.id && <button aria-label={`${tab.label} 탭 닫기`} onClick={() => { if (dirty && !window.confirm('제출하지 않은 내용을 버리고 탭을 닫으시겠습니까?')) return; setWorkspace(previous=>({...previous,tabs:previous.tabs.filter(item=>item.id!==tab.id)})); if (activeId===tab.id) navigate('/home'); }}>×</button>}</div>)}</nav>{admin && <div className="admin-banner">관리자 모드 · 규정 변경과 권한 적용 <Link to="/home">ERP 복귀</Link></div>}<main id="main-content" tabIndex={-1} key={epoch}>{me?.actor?.fictional && <div className="notice" role="status">가상 조직 구성 · {me.actor.department} · {me.actor.jobTitle}<p>{me.identityNotice}</p></div>}<ErrorNotice error={error} retry={() => void refresh()}/>{loading ? <Loading/> : !me?.actor ? <div className="welcome-state"><Icon name="document"/><h1>AI 경영시스템</h1><p>자료 열람과 업무를 시작하려면 상단에서 직원을 선택하세요.</p>{!people.length && <div className="notice">등록된 운영 직원이 없습니다. 확인된 직원·역할 지정 자료로 배포 구성을 준비해야 합니다.</div>}<p className="muted">직원 선택은 데모 세션입니다. 실제 본인 인증·전자서명을 제공하지 않습니다.</p></div> : <Routes><Route path="/" element={<Navigate to="/home" replace/>}/><Route path="/home" element={<HomePage/>}/><Route path="/reviews" element={<ReviewsPage/>}/><Route path="/reviews/records/:revisionId" element={<ArtifactDetail review/>}/><Route path="/documents" element={<ArtifactList/>}/><Route path="/sources/:revisionId" element={<ArtifactDetail review/>}/><Route path="/documents/:id" element={<ArtifactDetail/>}/><Route path="/records" element={<ArtifactList records/>}/><Route path="/records/:id" element={<ArtifactDetail/>}/><Route path="/wiki" element={<WikiPage/>}/><Route path="/wiki/:id" element={<WikiPage/>}/><Route path="/trace" element={<TracePage/>}/><Route path="/research" element={<ResearchPage/>}/><Route path="/research/jobs/:id" element={<ResearchJobPage/>}/><Route path="/impact" element={<ImpactPage/>}/><Route path="/search" element={<SearchPage/>}/><Route path="/admin/regulations" element={<RegulationChangesPage/>}/><Route path="/admin/changes/:id" element={<RegulationChangeDetail/>}/><Route path="/admin/assignments" element={<AssignmentsPage/>}/><Route path="/admin/releases" element={<ReleasesPage/>}/><Route path="*" element={<Empty>화면을 찾을 수 없습니다. <Link to="/home">업무 홈</Link></Empty>}/></Routes>}</main><footer><span>직원 선택 데모 · 실제 신원 인증 아님</span><span>{me?.context?.releaseId ? `릴리스 ${me.context.releaseId.slice(0,12)} · 자료 세대 ${me.context.dataRevision}` : '지식 릴리스 미설치'}</span></footer></div></div></WorkspaceTabContext.Provider>;
}
export default function App() { return <HashRouter><SessionProvider><Shell/></SessionProvider></HashRouter>; }
