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
  it.each([
    ['SYN-REC-2031-004·007·009','SYN-REC-2031-007',true],
    ['SYN-REC-2031-004·007·009','SYN-REC-2031-009',true],
    ['(SYN-REC-2031-004·007)','SYN-REC-2031-004',true],
    ['SYN-REC-2031-004·007','SYN-REC-2031-005',false],
    ['SYN-REC-2031-004~007','SYN-REC-2031-007',true],
    ['SYN-REC-2031-004,007','SYN-REC-2031-007',false],
    ['SYN-REC-2031-004·7','SYN-REC-2031-007',false],
    ['SYN-REC-2031-004·0070','SYN-REC-2031-007',false],
    ['SYN-REC-2031-004·007-extra','SYN-REC-2031-007',false],
    ['XSYN-REC-2031-004·007','SYN-REC-2031-007',false],
    ['SYN-REC-2031-004·OTHER-REC-2031-007','SYN-REC-2031-007',false],
    ['SYN-REC-F01·F02-2031-007','SYN-REC-F01-2031-007',true],
    ['SYN-REC-2031-004 (별도 항목 007)','SYN-REC-2031-007',false],
    ['SYN-REC-2031-004~007','SYN-REC-2031-005',true],
    ['SYN-REC-2031-007~004','SYN-REC-2031-005',false],
    ['SYN-REC-2031-001~999','SYN-REC-2031-005',false],
    ['SYN-REC-2031-004~7','SYN-REC-2031-005',false],
    ['SYN-REC-2031-004~~007','SYN-REC-2031-005',false],
    ['SYN-REC-2031-004~007-extra','SYN-REC-2031-005',false],
    ['SYN-REC-F01·F03-2031-007','SYN-REC-F03-2031-007',true],
    ['SYN-REC-F01·F03-2031-007','SYN-REC-F02-2031-007',false],
    ['SYN-REC-F01·F03-2031-007','SYN-REC-F01',false],
    ['SYN-REC-F01~F04-2031-007','SYN-REC-F02-2031-007',true],
    ['SYN-REC-F01~F04-2031-007','SYN-REC-F02-2032-007',false],
    ['SYN-REC-F04~F01-2031-007','SYN-REC-F02-2031-007',false],
    ['SYN-REC-F01·OTHER-F03-2031-007','SYN-REC-F03-2031-007',false],
    ['SYN-FORM-F01·F03~F04','SYN-FORM-F04',true],
    ['SYN-FORM-F01~F04','SYN-FORM-F02',true],
    ['SYN-FORM-F01~F99','SYN-FORM-F02',false],
    ['SYN-FORM-F01~F4','SYN-FORM-F02',false],
    ['SYN-FORM-F01~F04','SYN-FORM-F05',false],
    ['SYN-MAN-01-01~08','SYN-MAN-01-06',true],
    ['SYN-PROC-06-01·07-01~07-03','SYN-PROC-06-01',true],
    ['SYN-PROC-06-01·07-01~07-03','SYN-PROC-07-02',true],
    ['SYN-PROC-06-01·07-01~07-03','SYN-PROC-06-02',false],
    ['SYN-PROC-06-01~07-03','SYN-PROC-07-02',false],
    ['SYN-PROC-06-01·OTHER-07-01','SYN-PROC-07-01',false],
    ['참조: 한글-001','한글-001',true],
    ['참조: R&D-001','R&D-001',true],
    ['FULL-CODE-A·FULL-CODE-B','FULL-CODE-A',true],
    ['FULL-CODE-A·FULL-CODE-B','FULL-CODE-B',true],
    ['SYN-REC-2031-004·OTHER-REC-2031-007','OTHER-REC-2031-007',true],
    ['SYN-PROC-06-01·7-01','SYN-PROC-07-01',false],
  ])('matches explicit bounded code lists and ranges without inventing a prefix: %s → %s', (line,code,expected)=>{
    expect(mentionsCode(line,code)).toBe(expected);
  });
});
