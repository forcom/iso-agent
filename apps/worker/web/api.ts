import type { RegulationType } from '../../packages/contracts/src/index';

export type Item = { id: string; title?: string; name?: string; label?: string; kind?: string; type?: string; [key: string]: unknown };
export type Evidence = { id?: string; artifactId?: string; revisionId: string; sourceHash?: string; sourceSha256?: string; quote?: string; lineStart?: number; lineEnd?: number; [key: string]: unknown };
export type Context = { releaseId: string | null; dataRevision: number; authorityRevision?: number; rulesHash?: string };
export type Person = { id?: string; personId?: string; name: string; active: boolean; isAdmin?: boolean; fictional?: boolean; personaId?:string; department?:string; jobTitle?:string };
export type Me = { actor: Person | null; roles: Item[]; context: Context | null; sessionVersion: number; identityNotice?:string };
export type Artifact = Item & { documentCode: string; kind: string; regulationType?: RegulationType; recordTypeId?: string; recordTypeIds?: string[]; systemIds?: string[]; workingRevisionId?: string; effectiveRevisionId?: string };
export type Revision = Item & { artifactId: string; state?: string; status?: string; sourceHash?: string; sourceSha256?: string; createdAt?: string; evidenceStatus?: string };
export type Action = { action: string; allowed: boolean; reason?: string; policyIds: string[]; evidenceRefs: Evidence[] };
export type ActionSet = { conditions?: {field: string; kind?: 'person' | 'people'; reason: string; evidenceRefs: Evidence[]; value: boolean | string | string[] | null}[]; actions: Action[]; context: Context; revisionId: string; revisionVersion: string; state: string };
export type Detail = { artifact: Artifact; revisions: Revision[]; events: Item[]; relations?: Item[] };
export type Content = { revision: Revision; markdown: string; evidenceStatus: string };
export type Collection<T = Item> = { items: T[]; total?: number; cursor?: string | null };
export type { GraphResult } from '../../packages/contracts/src/index';
import type { GraphResult } from '../../packages/contracts/src/index';
export type Answer = { markdown?: string; answer?: string; draft?: string; citations?: Evidence[]; graph?: GraphResult; impactSet?: string[]; computed?: GraphResult; grounding?: { sources: {revisionId: string; markdown: string; evidenceRefs: Evidence[]}[]; excluded: {revisionId: string; reason: string}[] }; context?: Context; [key: string]: unknown };

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}
let sessionVersion = 0;
let generation = 0;
const pending = new Set<AbortController>();
const citations = new Map<string,Evidence>();
export function rememberCitation(key:string,evidence:Evidence) { citations.set(key,evidence); }
export function recalledCitation(key:string|null) { return key ? citations.get(key) : undefined; }
export function setSessionVersion(value: number) { sessionVersion = value; }
export function cancelRequests() { citations.clear(); generation++; for (const controller of pending) controller.abort(); pending.clear(); }
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const atGeneration = generation;
  pending.add(controller);
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  const headers = new Headers(options.headers);
  if (options.method && options.method !== 'GET') headers.set('X-Session-Version', String(sessionVersion));
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  try {
    const response = await fetch(`/api${path}`, { ...options, headers, credentials: 'same-origin', signal: controller.signal });
    const data = await response.json();
    if (atGeneration !== generation) throw new DOMException('사용자가 변경되었습니다.', 'AbortError');
    if (!response.ok) {
      const error = typeof data.error === 'object' ? data.error : data;
      if (error.code === 'SESSION_CONFLICT') window.dispatchEvent(new Event('iso-session-conflict'));
      throw new ApiError(response.status, error.code ?? data.code ?? 'REQUEST_FAILED', error.message ?? data.message ?? String(data.error ?? '요청을 처리하지 못했습니다.'), error.details ?? data);
    }
    return data as T;
  } finally { pending.delete(controller); options.signal?.removeEventListener('abort', abort); }
}
export function post<T>(path: string, data: object): Promise<T> { return api(path, { method: 'POST', body: JSON.stringify({ ...data, requestKey: crypto.randomUUID() }) }); }
export function label(item: {id: string; title?: string; name?: string; label?: string}) { return item.title ?? item.name ?? item.label ?? item.id; }
export function personId(person: Person) { return person.personId ?? person.id ?? ''; }
export function stateOf(revision?: Revision) { return revision?.state ?? revision?.status ?? 'draft'; }
export function mutationContext(actions?: ActionSet) {
  return actions ? { revisionId: actions.revisionId, expectedRevisionVersion: actions.revisionVersion, expectedState: actions.state, expectedContext: actions.context } : {};
}
