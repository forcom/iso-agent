import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ApiError, api, cancelRequests, personId, post, setSessionVersion, type Collection, type Me, type Person } from './api';

type Session = { me: Me | null; people: Person[]; loading: boolean; error: Error | null; epoch: number; refresh: () => Promise<void>; changePerson: (id: string) => Promise<void>; dirty: boolean; markDirty: (id:string,value: boolean) => void; recent: { id: string; kind: string; at: string }[]; visit: (id: string, kind: string) => void };
const SessionContext = createContext<Session | null>(null);
export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [dirty, setDirty] = useState(false);
  const dirtyForms = useRef(new Set<string>());
  const markDirty = useCallback((id:string,value:boolean) => { if(value)dirtyForms.current.add(id);else dirtyForms.current.delete(id);setDirty(dirtyForms.current.size>0); },[]);
  const clearDirty = useCallback(() => { dirtyForms.current.clear();setDirty(false); },[]);
  const [recent, setRecent] = useState<Session['recent']>([]);
  const channel = useRef<BroadcastChannel | null>(null);
  const version = useRef<number | null>(null);
  const refreshSequence = useRef(0);
  const refresh = useCallback(async () => {
    const sequence=++refreshSequence.current;
    try {
      const next = await api<Me>('/me');
      if(sequence!==refreshSequence.current)return;
      if (version.current !== null && next.sessionVersion !== version.current) { cancelRequests(); setEpoch(value => value + 1); clearDirty(); setRecent([]); }
      version.current = next.sessionVersion; setSessionVersion(next.sessionVersion); setMe(next); setError(null);
    } catch (e) { if (e instanceof ApiError && e.code === 'PERSON_REQUIRED') { setMe(null); setError(null); } else if ((e as Error).name !== 'AbortError') setError(e as Error); }
    finally { if(sequence===refreshSequence.current)setLoading(false); }
  }, [clearDirty]);
  useEffect(() => {
    void refresh();
    void api<Collection<Person>>('/persons').then(data => setPeople(data.items)).catch(e => { if (e.name !== 'AbortError') setError(e); });
    channel.current = new BroadcastChannel('iso-agent-session');
    channel.current.onmessage = () => { cancelRequests(); setMe(null); clearDirty(); setRecent([]); setEpoch(value => value + 1); void refresh(); };
    const focus = () => { void refresh(); };
    window.addEventListener('focus', focus);
    window.addEventListener('iso-session-conflict', focus);
    return () => { channel.current?.close(); window.removeEventListener('focus', focus); window.removeEventListener('iso-session-conflict', focus); cancelRequests(); };
  }, [refresh,clearDirty]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);
  const changePerson = async (id: string) => {
    if (dirty && !window.confirm('전송하지 않은 파일과 의견이 사라집니다. 사용자를 변경하시겠습니까?')) return;
    refreshSequence.current++; cancelRequests(); clearDirty(); setMe(null); setRecent([]); setEpoch(value => value + 1); setLoading(true);
    try {
      const next = await post<Me>('/session', { personId: id, expectedSessionVersion: version.current });
      version.current = next.sessionVersion; setSessionVersion(next.sessionVersion); setMe(next); setError(null);
      channel.current?.postMessage({ version: next.sessionVersion });
    } catch (e) { setError(e as Error); await refresh(); }
    finally { setLoading(false); }
  };
  const visit = useCallback((id: string, kind: string) => setRecent(items => [{ id, kind, at: new Date().toISOString() }, ...items.filter(item => item.id !== id)].slice(0, 5)), []);
  return <SessionContext.Provider value={{ me, people, loading, error, epoch, refresh, changePerson, dirty, markDirty, recent, visit }}>{children}</SessionContext.Provider>;
}
export function useSession() { const context = useContext(SessionContext); if (!context) throw new Error('SessionProvider is required'); return context; }
export function useLoad<T>(path: string | null, refreshInterval = 0) {
  const { epoch, dirty } = useSession();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [reload, setReload] = useState({ version: 0, automatic: false });
  const previousKey = useRef('');
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const refresh = useCallback(() => setReload(value => ({ version: value.version + 1, automatic: false })), []);
  useEffect(() => {
    if (!path || !refreshInterval || dirty || loading) return;
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') setReload(value => ({ version: value.version + 1, automatic: true })); }, refreshInterval);
    return () => window.clearInterval(timer);
  }, [path, refreshInterval, dirty, loading]);
  useEffect(() => {
    const key=`${epoch}:${path}`;
    const background = reload.automatic && previousKey.current === key;
    if (previousKey.current !== key) setData(null);
    previousKey.current=key; setError(null); setLoading(Boolean(path));
    if (!path) return;
    const controller = new AbortController();
    void api<T>(path, { signal: controller.signal }).then(value => {
      // Editing can begin after an automatic read has already started.
      if (!background || !dirtyRef.current) setData(value);
    }).catch(e => { if (e.name !== 'AbortError') setError(e); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path, epoch, reload, refreshInterval]);
  return { data, error, loading, refresh };
}
export function useDirty(value: boolean) {
  const { markDirty } = useSession();
  const id=useId();
  useEffect(() => { markDirty(id,value); return () => markDirty(id,false); }, [id,value,markDirty]);
}
