import { afterEach, expect, it } from 'vitest';
import app from '../../worker/src/index';
import { createTestEnvironment, type TestEnvironment } from '../support/environment';

let env: TestEnvironment;
afterEach(async () => { await env?.cleanup(); });

it('filters the four document types by stored classification while combining search and category', async () => {
  env = await createTestEnvironment();
  for (const kind of ['manual', 'guide', 'record']) {
    const artifact = { id: kind, documentCode: `SYNTHETIC-${kind}`, title: '동일 제목', kind: kind === 'record' ? 'record' : 'regulation', ...(kind !== 'record' ? { regulationType: kind } : {}) };
    await env.bindings.DB.prepare('INSERT INTO artifacts VALUES(?,?,?,?)').bind(artifact.id, artifact.documentCode, artifact.kind, JSON.stringify(artifact)).run();
  }
  const actor = await env.select('reader');
  const list = async (query: string) => {
    const response = await app.request(`/api/artifacts?${query}`, { headers: { cookie: `iso_session=${actor.sessionId}` } }, env.bindings);
    expect(response.status).toBe(200);
    return ((await response.json()) as { items: { id: string }[] }).items.map(item => item.id).sort();
  };
  for (const [kind, ids] of [['manual', ['manual']], ['procedure', ['test-reg']], ['guide', ['guide']], ['template', ['test-tpl-1', 'test-tpl-2']]] as const) {
    expect(await list(`category=documents&kind=${kind}`)).toEqual([...ids]);
  }
  expect(await list('category=documents&kind=manual&q=SYNTHETIC')).toEqual(['manual']);
  expect(await list('category=documents&kind=manual&q=missing')).toEqual([]);
  expect(await list('category=records&kind=manual')).toEqual([]);
  expect(await list('category=records')).toEqual(['record']);
  expect(await list('category=documents&kind=regulation')).toEqual(['guide', 'manual', 'test-reg']);
});
