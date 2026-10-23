import { afterEach, expect, it } from 'vitest';
import app from '../../worker/src/index';
import { createTestEnvironment, type TestEnvironment } from '../support/environment';
import { getKnowledgeContext } from '../../worker/src/lib/storage';
import { buildRelease, sha256 } from '../../packages/knowledge/src/index';

let env: TestEnvironment;
afterEach(async () => { await env?.cleanup(); });
async function headers() {
  const actor = await env.select('admin');
  return { cookie: `iso_session=${actor.sessionId}`, 'X-Session-Version': '1' };
}
async function post(path: string, body: object) {
  return app.request(path, { method: 'POST', headers: { ...await headers(), 'Content-Type': 'application/json' }, body: JSON.stringify({ requestKey: crypto.randomUUID(), expectedContext: await getKnowledgeContext(env.bindings), ...body }) }, env.bindings);
}
async function indexChange(raw: string, stored: string | null) {
  env = await createTestEnvironment();
  const index = { artifactId: 'synthetic-index', revisionId: 'synthetic-index-rev', code: 'SYNTHETIC-INDEX', title: 'Synthetic index', path: 'synthetic/index.md', kind: 'index' as const, bytes: new TextEncoder().encode(raw), sha256: await sha256(raw) };
  const mappings = structuredClone(env.bundle.mappings);
  mappings.sources.push({ sourceCode: index.code, revisionId: index.revisionId, sourceSha256: index.sha256, reviewStatus: 'validated', reviewedBy: 'synthetic fixture', reviewedAt: '2026-01-01', clauses: [] });
  const rules = new Uint8Array(await (await env.bindings.SOURCES.get(`definitions/rules/${env.bundle.manifest.rulesHash}`))!.arrayBuffer());
  const schema = new Uint8Array(await (await env.bindings.SOURCES.get(`definitions/schema/${env.bundle.manifest.schemaHash}`))!.arrayBuffer());
  const bundle = await buildRelease({ sourceMode: 'synthetic', sources: [...env.bundle.sources.map(({ markdown, textSha256: _textHash, ...source }) => ({ ...source, bytes: new TextEncoder().encode(markdown) })), index], mappings, rules, schema, schemaVersion: env.bundle.manifest.schemaVersion });
  const releaseKey = `releases/synthetic-index-${bundle.manifest.releaseId}.json`;
  await env.bindings.SOURCES.put(releaseKey, JSON.stringify(bundle));
  await env.bindings.DB.prepare('INSERT INTO releases VALUES(?,?,?)').bind(bundle.manifest.releaseId, releaseKey, JSON.stringify(bundle.manifest)).run();
  await env.bindings.DB.prepare('UPDATE context SET release_id=? WHERE id=1').bind(bundle.manifest.releaseId).run();
  if (stored !== null) await env.bindings.SOURCES.put(`sources/${index.revisionId}/${index.sha256}.md`, stored);
  // Indexes are navigation inputs, not ERP artifacts/revisions, including after installation.
  expect(await env.bindings.DB.prepare('SELECT id FROM revisions WHERE id=?').bind(index.revisionId).first()).toBeNull();
  const created = await post('/api/admin/regulation-changes', { title: 'Index regression' });
  expect(created.status).toBe(201);
  const { changeId } = await created.json() as { changeId: string };
  const original = bundle.sources.find(source => source.code === 'TEST-PROC')!;
  const form = new FormData();
  form.set('file', new File([(original.markdown + '\nSynthetic appendix\n').replace(/\n/g, '\r\n')], 'reg.md'));
  for (const [key, value] of Object.entries({ artifactId: original.artifactId, documentCode: original.code, title: original.title, kind: 'procedure', requestKey: crypto.randomUUID(), expectedContext: JSON.stringify(await getKnowledgeContext(env.bindings)) })) form.set(key, value);
  expect((await app.request(`/api/admin/regulation-changes/${changeId}/files`, { method: 'POST', headers: await headers(), body: form }, env.bindings)).status).toBe(201);
  return { path: `/api/admin/regulation-changes/${changeId}`, index };
}

it('downloads index source bytes with hash verification and session protection', async () => {
  const raw = '\uFEFF# Index\r\nNavigation only.\r\n';
  const { index } = await indexChange(raw, raw);
  const path = `/api/source-index/${index.revisionId}?download=1`;
  const response = await app.request(path, { headers: await headers() }, env.bindings);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/markdown');
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(new TextEncoder().encode(raw));
  expect((await app.request(path, {}, env.bindings)).status).toBe(401);
  await env.bindings.SOURCES.put(`sources/${index.revisionId}/${index.sha256}.md`, '# Tampered');
  expect((await app.request(path, { headers: await headers() }, env.bindings)).status).toBe(422);
});

it.each([
  { name: 'legacy LF index without a stored original', raw: '# Index\nNavigation only.\n', stored: null },
  { name: 'stored BOM/CRLF index original', raw: '\uFEFF# Index\r\nNavigation only.\r\n', stored: '\uFEFF# Index\r\nNavigation only.\r\n' },
])('rebuilds and validates with $name', async ({ raw, stored }) => {
  const { path, index } = await indexChange(raw, stored);
  const built = await post(`${path}/build`, {});
  expect(built.status).toBe(200);
  const candidate = await built.json() as any;
  const validated = await post(`${path}/decisions`, { decision: 'validate_knowledge', candidateHash: candidate.change.candidateHash, comment: 'Synthetic source review' });
  expect(validated.status).toBe(200);
  const result = await validated.json() as any;
  expect(result.candidate.sources.find((source: any) => source.kind === 'index')).toMatchObject({ sha256: index.sha256, markdown: '# Index\nNavigation only.\n' });
  expect(result.change.validation.valid).toBe(true);
});

it.each([
  { name: 'missing BOM/CRLF original', raw: '\uFEFF# Index\r\nNavigation only.\r\n', stored: null },
  { name: 'tampered stored original', raw: '# Index\nNavigation only.\n', stored: '# Altered index\n' },
])('rejects $name instead of substituting normalized bytes', async ({ raw, stored }) => {
  const { path } = await indexChange(raw, stored);
  const context = await getKnowledgeContext(env.bindings);
  const built = await post(`${path}/build`, {});
  expect(built.status).toBe(422);
  expect(await getKnowledgeContext(env.bindings)).toEqual(context);
});
