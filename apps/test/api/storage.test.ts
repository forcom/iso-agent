import { describe,it,expect,afterEach } from 'vitest';
import { createTestEnvironment } from '../support/environment';
import { commitMutation, getKnowledgeContext } from '../../worker/src/lib/storage';
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
