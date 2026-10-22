import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTestEnvironment, type TestEnvironment } from '../support/environment';
import { startTestEngine } from '../support/engine';
import {canonical,sha256} from '../../packages/knowledge/src/index';
import { authorize, requireAuthorization } from '../../worker/src/lib/engine';
import { getKnowledgeContext } from '../../worker/src/lib/storage';

let stopEngine: () => Promise<void>;
const cleanups: Array<() => Promise<void>> = [];
beforeAll(async () => { stopEngine = await startTestEngine(); });
afterAll(async () => { await stopEngine?.(); });
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function environment(): Promise<TestEnvironment> { const env = await createTestEnvironment(); cleanups.push(env.cleanup); return env; }
const resource = { id: 'synthetic-record', typeIds: ['test-F01'], revisionId: 'synthetic-revision', currentRevisionId: 'synthetic-revision', state: 'reviewed', systemIds: [] };

describe('type-specific authorization through real engine', () => {
  it('uses different approvers for distinct types and denies reader/admin role substitution', async () => {
    const env = await environment(); const context = await getKnowledgeContext(env.bindings);
    const approver = await env.select('approver');
    expect((await authorize(env.bindings, approver, 'approve', resource, context)).allowed).toBe(true);
    expect((await authorize(env.bindings, approver, 'approve', { ...resource, typeIds: ['test-F02'] }, context)).allowed).toBe(false);
    const director = await env.select('director');
    expect((await authorize(env.bindings, director, 'approve', { ...resource, typeIds: ['test-F02'] }, context)).allowed).toBe(true);
    for (const person of ['reader', 'admin']) expect((await authorize(env.bindings, await env.select(person), 'approve', resource, context)).allowed).toBe(false);
  });

  it('missing policy source prevents permission and leaves decisions untouched', async () => {
    const env = await environment(); const actor = await env.select('approver'); const context = await getKnowledgeContext(env.bindings);
    const source = env.bundle.sources.find(source => source.revisionId === 'test-reg-rev')!; await env.bindings.SOURCES.delete(`sources/${source.revisionId}/${source.sha256}.md`);
    await expect(requireAuthorization(env.bindings, actor, 'approve', resource, context)).rejects.toMatchObject({ status: 403 });
    expect(await env.bindings.DB.prepare('SELECT COUNT(*) AS n FROM decisions').first('n')).toBe(0);
    expect(await getKnowledgeContext(env.bindings)).toEqual(context);
  });

  it('a missing role-designation source cannot retain active authority', async () => {
    const env = await environment(); const actor = await env.select('approver'); const context = await getKnowledgeContext(env.bindings);
    const row = await env.bindings.DB.prepare("SELECT body FROM assignments WHERE id='test-assignment-approver'").first<{body:string}>();
    const assignment = JSON.parse(row!.body);
    assignment.approvedRevisionId = 'missing-designation-revision';
    assignment.evidenceRefs = [{ ...env.bundle.policies[0].evidenceRefs[0], revisionId: 'missing-designation-revision' }];
    await env.bindings.DB.prepare('UPDATE assignments SET body=? WHERE id=?').bind(JSON.stringify(assignment), assignment.id).run();
    expect((await authorize(env.bindings, actor, 'approve', resource, context)).allowed).toBe(false);
  });

  it('an explicit approval event ID requires that exact decision, revision and source hash',async()=>{
    const env=await environment(),actor=await env.select('approver'),context=await getKnowledgeContext(env.bindings);
    const assignment=JSON.parse((await env.bindings.DB.prepare("SELECT body FROM assignments WHERE id='test-assignment-approver'").first<{body:string}>())!.body);
    assignment.approvalDecisionId='explicit-appointment-approval';
    await env.bindings.DB.prepare('UPDATE assignments SET body=? WHERE id=?').bind(JSON.stringify(assignment),assignment.id).run();
    expect((await authorize(env.bindings,actor,'approve',resource,context)).allowed).toBe(false);
    const revision=JSON.parse((await env.bindings.DB.prepare("SELECT body FROM revisions WHERE id='test-reg-rev'").first<{body:string}>())!.body);
    const decision={id:assignment.approvalDecisionId,revisionId:revision.id,decision:'approve',sourceSha256:revision.sourceSha256};
    await env.bindings.DB.prepare('INSERT INTO decisions VALUES(?,?,?)').bind(decision.id,revision.id,JSON.stringify(decision)).run();
    expect((await authorize(env.bindings,actor,'approve',resource,context)).allowed).toBe(true);
    for(const change of [{revisionId:'test-tpl-rev-1'},{decision:'review'},{sourceSha256:'incorrect-hash'}]){
      const invalid={...decision,...change,id:crypto.randomUUID()};
      await env.bindings.DB.prepare('INSERT INTO decisions VALUES(?,?,?)').bind(invalid.id,invalid.revisionId,JSON.stringify(invalid)).run();
      await env.bindings.DB.prepare('UPDATE assignments SET body=? WHERE id=?').bind(JSON.stringify({...assignment,approvalDecisionId:invalid.id}),assignment.id).run();
      expect((await authorize(env.bindings,actor,'approve',resource,context)).allowed).toBe(false);
    }
  });

  it('initial external approval needs an explicit installer confirmation on the same source revision',async()=>{
    const env=await environment(),actor=await env.select('approver'),context=await getKnowledgeContext(env.bindings);
    const assignment=JSON.parse((await env.bindings.DB.prepare("SELECT body FROM assignments WHERE id='test-assignment-approver'").first<{body:string}>())!.body);
    delete assignment.approvalDecisionId;
    await env.bindings.DB.prepare('UPDATE assignments SET body=? WHERE id=?').bind(JSON.stringify(assignment),assignment.id).run();
    const revision=JSON.parse((await env.bindings.DB.prepare("SELECT body FROM revisions WHERE id='test-reg-rev'").first<{body:string}>())!.body);
    delete revision.externalDesignation;
    await env.bindings.DB.prepare('UPDATE revisions SET body=? WHERE id=?').bind(JSON.stringify(revision),revision.id).run();
    expect((await authorize(env.bindings,actor,'approve',resource,context)).allowed).toBe(false);
  });

  it('policy quotes must match the exact cited source lines', async () => {
    const env = await environment(); const actor = await env.select('approver'); const context = await getKnowledgeContext(env.bindings);
    const policy = env.bundle.policies.find(item => item.id === 'test-F01-approve')!;
    policy.evidenceRefs = [{ ...policy.evidenceRefs[0], quote: 'This permission was never in the source.' }];
    env.bundle.manifest.manifestHash='';env.bundle.manifest.manifestHash=await sha256(canonical(env.bundle));
    await env.bindings.SOURCES.put('releases/test-release.json', JSON.stringify(env.bundle));
    await env.bindings.DB.prepare('UPDATE releases SET body=? WHERE id=?').bind(JSON.stringify(env.bundle.manifest),env.bundle.manifest.releaseId).run();
    expect((await authorize(env.bindings, actor, 'approve', resource, context)).allowed).toBe(false);
  });

  it('same revision is required and role revocation is re-read', async () => {
    const env = await environment(); const actor = await env.select('approver'); const context = await getKnowledgeContext(env.bindings);
    expect((await authorize(env.bindings, actor, 'approve', { ...resource, currentRevisionId: 'new-revision' }, context)).allowed).toBe(false);
    await env.bindings.DB.prepare("DELETE FROM assignments WHERE id='test-assignment-approver'").run();
    expect((await authorize(env.bindings, actor, 'approve', resource, context)).allowed).toBe(false);
  });
});
