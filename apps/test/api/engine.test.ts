import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { createTestEnvironment, type TestEnvironment } from '../support/environment';
import { startTestEngine } from '../support/engine';
import { engineCall, queryGraph, snapshot } from '../../worker/src/lib/engine';
import { getKnowledgeContext } from '../../worker/src/lib/storage';
import { canonical,sha256 } from '../../packages/knowledge/src/index';

let stopEngine: () => Promise<void>;
const cleanups: Array<() => Promise<void>> = [];
beforeAll(async () => { stopEngine = await startTestEngine(); });
afterAll(async () => { await stopEngine?.(); });
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function environment(): Promise<TestEnvironment> { const env = await createTestEnvironment(); cleanups.push(env.cleanup); return env; }

describe('actual PyreWire API boundary', () => {
  it('returns measured graph provenance and keeps source references separate from dependencies', async () => {
    const env = await environment(); const context = await getKnowledgeContext(env.bindings);
    const base = { origin: 'explicit_metadata', evidenceRefs: [env.bundle.policies[0].evidenceRefs[0]], releaseId: context.releaseId, reviewStatus: 'validated' };
    for (const relation of [
      { ...base, id: 'test-dependency', subjectId: 'test-tpl-rev-1', objectId: 'test-reg-rev', type: 'change_depends_on' },
      { ...base, id: 'test-reference', subjectId: 'test-tpl-rev-2', objectId: 'test-reg-rev', type: 'references' }
    ]) await env.bindings.DB.prepare('INSERT INTO relations(id,body) VALUES (?,?)').bind(relation.id, JSON.stringify(relation)).run();
    const result = await queryGraph(env.bindings, context, 'impact', 'test-reg-rev');
    expect(result.relations.map(r => r.id)).toEqual(['test-dependency']);
    expect(result.impactSet).toEqual(['test-tpl-rev-1']);
    expect(result.context).toEqual(context);
    expect(result.engine).toEqual({ name: 'PyreWire', version: '1.1.2', rulesHash: context.rulesHash });
    expect(result.totalRelations).toBe(1);
    expect(result.entities.map(n => n.id)).toEqual(['test-reg-rev', 'test-tpl-rev-1']);
    expect(result.paths).toHaveLength(1);
  });

  it('source availability overlays release nodes and excludes unsupported graph relations', async () => {
    const env = await environment(); const context = await getKnowledgeContext(env.bindings);
    const relation = { id: 'unavailable-dependency', subjectId: 'test-tpl-rev-1', objectId: 'test-reg-rev', type: 'change_depends_on', origin: 'explicit_metadata', evidenceRefs: env.bundle.policies[0].evidenceRefs, releaseId: context.releaseId, reviewStatus: 'validated' };
    await env.bindings.DB.prepare('INSERT INTO relations(id,body) VALUES (?,?)').bind(relation.id, JSON.stringify(relation)).run();
    const source = env.bundle.sources.find(source => source.revisionId === 'test-reg-rev')!; await env.bindings.SOURCES.delete(`sources/${source.revisionId}/${source.sha256}.md`);
    const result = await queryGraph(env.bindings, context, 'impact', 'test-reg-rev');
    expect(result.relations).toEqual([]);
    expect(result.excluded).toContainEqual({ id: relation.id, reason: 'SOURCE_UNAVAILABLE' });
    expect(result.entities.find(entity => entity.id === 'test-reg-rev')?.metadata?.evidenceStatus).toBe('unavailable');
  });

  it('a previously verified relation is rechecked against its separate evidence source', async () => {
    const env = await environment(); const context = await getKnowledgeContext(env.bindings);
    const relation = { id: 'stale-evidence', subjectId: 'test-tpl-rev-1', objectId: 'test-tpl-rev-2', type: 'change_depends_on', origin: 'explicit_metadata', evidenceStatus: 'verified', evidenceRefs: env.bundle.policies[0].evidenceRefs, releaseId: context.releaseId, reviewStatus: 'validated' };
    await env.bindings.DB.prepare('INSERT INTO relations(id,body) VALUES (?,?)').bind(relation.id, JSON.stringify(relation)).run();
    const source = env.bundle.sources.find(source => source.revisionId === 'test-reg-rev')!; await env.bindings.SOURCES.delete(`sources/${source.revisionId}/${source.sha256}.md`);
    const result = await queryGraph(env.bindings, context, 'impact', 'test-tpl-rev-2');
    expect(result.relations).toEqual([]);
    expect(result.excluded).toContainEqual({ id: relation.id, reason: 'SOURCE_UNAVAILABLE' });
  });

  it('keeps old record classification after a new release removes its active type', async () => {
    const env=await environment();const context=await getKnowledgeContext(env.bindings);
    const {registerRecord}=await import('../../worker/src/lib/artifacts');
    const record=await registerRecord(env.bindings,await env.select('author'),{file:new TextEncoder().encode('# Synthetic record'),filename:'record.md',documentCode:'SYNTHETIC-CROSS-RELEASE',title:'Synthetic',recordTypeIds:['test-F01'],scope:'',templateRevisionIds:['test-tpl-rev-1'],requestKey:'cross-release',expectedContext:context});
    const next=structuredClone(env.bundle);next.manifest.releaseId='next-release';next.recordTypes=next.recordTypes.filter(type=>type.id!=='test-F01');next.entities=next.entities.filter(entity=>entity.id!=='test-F01');next.relations=next.relations.filter(relation=>relation.subjectId!=='test-F01'&&relation.objectId!=='test-F01').map(relation=>({...relation,releaseId:'next-release'}));
    next.manifest.manifestHash='';next.manifest.manifestHash=await sha256(canonical(next));
    await env.bindings.SOURCES.put('releases/next-release.json',JSON.stringify(next));
    await env.bindings.DB.prepare('INSERT INTO releases VALUES(?,?,?)').bind('next-release','releases/next-release.json',JSON.stringify(next.manifest)).run();
    await env.bindings.DB.prepare("UPDATE context SET release_id='next-release',data_revision=data_revision+1,authority_revision=authority_revision+1").run();
    const result=await queryGraph(env.bindings,await getKnowledgeContext(env.bindings),'neighbors',record.artifactId);
    const classification=result.relations.find(relation=>relation.type==='record_of_type')!;
    expect(classification.releaseId).toBe('next-release');expect(classification.createdReleaseId).toBe(context.releaseId);
    expect(result.entities.find(entity=>entity.id==='test-F01')?.metadata?.currentDefinition).toBe(false);
    const stored=JSON.parse((await env.bindings.DB.prepare('SELECT body FROM relations WHERE id=?').bind(classification.id).first<{body:string}>())!.body);expect(stored.releaseId).toBe(context.releaseId);
  });

  it('projects verified registration and immutable decisions and role assignments as direct edges', async () => {
    const env=await environment(),context=await getKnowledgeContext(env.bindings);
    const relation={id:'registration-no-quote',subjectId:'test-reg',objectId:'test-reg-rev',type:'has_revision',origin:'explicit_metadata',evidenceRefs:[],releaseId:context.releaseId,reviewStatus:'validated'};
    await env.bindings.DB.prepare('INSERT INTO relations VALUES(?,?)').bind(relation.id,JSON.stringify(relation)).run();
    await env.bindings.DB.prepare('INSERT INTO relations VALUES(?,?)').bind('registration-wrong-artifact',JSON.stringify({...relation,id:'registration-wrong-artifact',subjectId:'test-tpl-1'})).run();
    await env.bindings.DB.prepare('INSERT INTO decisions VALUES(?,?,?)').bind('synthetic-decision-event','test-reg-rev',JSON.stringify({id:'synthetic-decision-event',revisionId:'test-reg-rev',decision:'review',actorId:'reviewer'})).run();
    await env.bindings.DB.prepare('INSERT INTO circulations VALUES(?,?,?)').bind('synthetic-circulation','test-reg-rev',JSON.stringify({id:'synthetic-circulation',revisionId:'test-reg-rev',recipientIds:['reader']})).run();
    await env.bindings.DB.prepare('INSERT INTO receipts VALUES(?,?,?,?,?)').bind('synthetic-receipt-event','synthetic-circulation','reader','received',JSON.stringify({id:'synthetic-receipt-event',revisionId:'test-reg-rev',personId:'reader',kind:'received'})).run();
    const recordGraph=await queryGraph(env.bindings,context,'neighbors','test-reg-rev');
    expect(recordGraph.relations.some(item=>item.id===relation.id)).toBe(true);
    expect(recordGraph.relations.some(item=>item.type==='decision_on'&&item.subjectId==='synthetic-decision-event')).toBe(true);
    expect(recordGraph.relations.some(item=>item.type==='receipt_for'&&item.subjectId==='synthetic-receipt-event')).toBe(true);
    expect(recordGraph.relations.some(item=>item.id==='registration-wrong-artifact')).toBe(false);
    const roleGraph=await queryGraph(env.bindings,context,'neighbors','test-assignment-approver');
    expect(roleGraph.relations.map(item=>item.type).sort()).toEqual(['assignment_person','assignment_role']);
  });

  it('returns 422 for invalid graph targets instead of engine outage',async()=>{
    const env=await environment();await expect(queryGraph(env.bindings,await getKnowledgeContext(env.bindings),'neighbors','unknown-target')).rejects.toMatchObject({status:422});
  });

  it('engine outage is 503 with no registry mutation or cached graph', async () => {
    const env = await environment(); const context = await getKnowledgeContext(env.bindings);
    env.bindings.ENGINE_URL = 'http://127.0.0.1:1';
    await expect(queryGraph(env.bindings, context, 'neighbors')).rejects.toMatchObject({ status: 503, code: 'ENGINE_UNAVAILABLE' });
    expect(await getKnowledgeContext(env.bindings)).toEqual(context);
    expect(await env.bindings.DB.prepare('SELECT COUNT(*) AS n FROM events').first('n')).toBe(0);
  });

  it('rejects mismatched snapshot generations instead of returning a fresh-looking result', async () => {
    const env = await environment(); const context = await getKnowledgeContext(env.bindings);
    const data = await snapshot(env.bindings, context);
    await expect(engineCall(env.bindings, '/query', {
      context, snapshot: { ...data, context: { ...context, authorityRevision: context.authorityRevision + 1 } }, query: { operation: 'neighbors' }
    }, context)).rejects.toMatchObject({ status: 409 });
  });

  it('rejects a changed authority generation after real engine calculation', async () => {
    const env = await environment(); const context = await getKnowledgeContext(env.bindings);
    const engineUrl = env.bindings.ENGINE_URL!;
    env.bindings.ENGINE = { idFromName: () => 'test', get: () => ({ fetch: async (url: string, init: RequestInit) => {
      const response = await fetch(`${engineUrl}${new URL(url).pathname}`, init);
      await env.bindings.DB.prepare('UPDATE context SET authority_revision=authority_revision+1').run();
      return response;
    } }) } as unknown as DurableObjectNamespace;
    await expect(queryGraph(env.bindings, context, 'neighbors')).rejects.toMatchObject({ status: 409 });
  });

  it('malformed engine transport responses are ENGINE_UNAVAILABLE', async () => {
    const env = await environment(); const context = await getKnowledgeContext(env.bindings);
    const server = createServer((_request, response) => { response.writeHead(200); response.end('not JSON'); });
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    cleanups.push(() => new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done())));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No local server port');
    env.bindings.ENGINE_URL = `http://127.0.0.1:${address.port}`;
    await expect(queryGraph(env.bindings, context, 'neighbors')).rejects.toMatchObject({ status: 503, code: 'ENGINE_UNAVAILABLE' });
  });
});
