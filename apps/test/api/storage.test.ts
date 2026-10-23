import { describe,it,expect,afterEach } from 'vitest';
import { createTestEnvironment } from '../support/environment';
import { assertExpectedContext, commitMutation, getKnowledgeContext, requestMemo, requestScope } from '../../worker/src/lib/storage';
import { mentionsCode } from '../../worker/src/lib/artifacts';
const cleanups: Array<() => Promise<void>>=[];
afterEach(async()=>{for(const clean of cleanups.splice(0)) await clean()});
describe('storage atomic fences',()=>{
  it('stale context rolls back metadata and event together',async()=>{
    const env=await createTestEnvironment();cleanups.push(env.cleanup);
    const actor=await env.select('author'); const context=await getKnowledgeContext(env.bindings);
    await env.bindings.DB.prepare('UPDATE context SET data_revision=data_revision+1').run();
    await expect(commitMutation(env.bindings,actor,'request-1','hash',context,{ok:true},[env.bindings.DB.prepare("INSERT INTO events(id,artifact_id,body) VALUES ('event1','a','{}')")])).rejects.toMatchObject({status:409});
    expect(await env.bindings.DB.prepare('SELECT COUNT(*) AS n FROM events').first('n')).toBe(0);
  });
  it('same request replays once and changed payload conflicts',async()=>{
    const env=await createTestEnvironment();cleanups.push(env.cleanup);
    const actor=await env.select('author');const context=await getKnowledgeContext(env.bindings);
    const first=await commitMutation(env.bindings,actor,'request-1','hash',context,{ok:true},[]);
    expect(await commitMutation(env.bindings,actor,'request-1','hash',context,{ok:false},[])).toEqual(first);
    await expect(commitMutation(env.bindings,actor,'request-1','other',context,{},[])).rejects.toMatchObject({status:409});
    expect((await getKnowledgeContext(env.bindings)).dataRevision).toBe(context.dataRevision+1);
  });
});
describe('review fixes',()=>{
  it('a changed session is SESSION_CONFLICT, not a data conflict',async()=>{
    const env=await createTestEnvironment();cleanups.push(env.cleanup);
    const actor=await env.select('author');const context=await getKnowledgeContext(env.bindings);
    await env.bindings.DB.prepare('UPDATE sessions SET version=version+1 WHERE id=?').bind(actor.sessionId).run();
    await expect(commitMutation(env.bindings,actor,'request-1','hash',context,{ok:true},[])).rejects.toMatchObject({status:409,code:'SESSION_CONFLICT'});
  });
  it('screens fence on release and authority, not on unrelated data changes',async()=>{
    const env=await createTestEnvironment();cleanups.push(env.cleanup);const context=await getKnowledgeContext(env.bindings);
    expect(()=>assertExpectedContext({...context,dataRevision:context.dataRevision-1},context)).not.toThrow();
    expect(()=>assertExpectedContext({...context,authorityRevision:context.authorityRevision-1},context)).toThrow(expect.objectContaining({code:'CONTEXT_CONFLICT'}));
  });
  it('requestMemo shares one computation per request and retries after a failure',async()=>{
    let calls=0;const compute=async()=>{calls++;if(calls===1)throw new Error('first');return calls};
    await requestScope.run(new Map(),async()=>{
      await expect(requestMemo('k',compute)).rejects.toThrow('first');
      expect(await requestMemo('k',compute)).toBe(2);expect(await requestMemo('k',compute)).toBe(2);
    });
    expect(await requestMemo('k',compute)).toBe(3);
  });
  it('document codes match whole tokens only',()=>{
    expect(mentionsCode('참조: AIDU-AIP-01-F02 양식','AIDU-AIP-01')).toBe(false);
    expect(mentionsCode('참조: AIDU-AIP-01, AIDU-AIP-02','AIDU-AIP-01')).toBe(true);
    expect(mentionsCode('(AIDU-AIP-01)','AIDU-AIP-01')).toBe(true);
  });
});
