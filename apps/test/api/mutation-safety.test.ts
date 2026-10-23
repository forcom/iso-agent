import {it,expect,afterEach} from 'vitest';
import {createTestEnvironment,type TestEnvironment} from '../support/environment';
import {getKnowledgeContext,get,getBundle} from '../../worker/src/lib/storage';
import {registerRecord} from '../../worker/src/lib/artifacts';
import {decideRevision} from '../../worker/src/lib/decisions';
import type {Artifact,Revision} from '../../worker/src/types';
let env:TestEnvironment;afterEach(async()=>env?.cleanup());
async function record(){const actor=await env.select('author');return registerRecord(env.bindings,actor,{file:new TextEncoder().encode('# 시험 기록\n시험 내용'),filename:'record.md',documentCode:'TEST-X',title:'시험',recordTypeIds:['test-F01'],scope:'',templateRevisionIds:['test-tpl-rev-1'],requestKey:'create-key',expectedContext:await getKnowledgeContext(env.bindings)})}
it('missing source cannot acquire a fresh decision',async()=>{
 env=await createTestEnvironment();const r=await record();const revision=await get<Revision>(env.bindings,'revisions',r.revisionId);await env.bindings.SOURCES.delete(revision.objectKey);
 await expect(decideRevision(env.bindings,await env.select('author'),{artifactId:r.artifactId,revisionId:r.revisionId,decision:'submit',comment:'',requestKey:'submit',expectedContext:await getKnowledgeContext(env.bindings)})).rejects.toMatchObject({status:422});
 expect(await env.bindings.DB.prepare('SELECT COUNT(*) n FROM decisions').first('n')).toBe(0);
});
it('R2 succeeded but D1 failed never registers a partial artifact or event and removes the unlinked upload',async()=>{
 env=await createTestEnvironment();const stored=(await env.bindings.SOURCES.list()).objects.length;await env.bindings.DB.prepare("CREATE TRIGGER inject_failure BEFORE INSERT ON revisions WHEN json_extract(NEW.body,'$.createdBy')='author' BEGIN SELECT RAISE(ABORT,'INJECTED_FAILURE'); END").run();
 await expect(record()).rejects.toThrow('INJECTED_FAILURE');
 expect(await env.bindings.DB.prepare("SELECT COUNT(*) n FROM artifacts WHERE kind='record'").first('n')).toBe(0);expect(await env.bindings.DB.prepare('SELECT COUNT(*) n FROM events').first('n')).toBe(0);
 expect((await env.bindings.SOURCES.list()).objects.length).toBe(stored);
});
it('unknown proposed system scope cannot be assigned on a new revision',async()=>{
 env=await createTestEnvironment();const r=await record();
 await expect(registerRecord(env.bindings,await env.select('author'),{file:new TextEncoder().encode('# 시험 변경'),filename:'new.md',documentCode:'TEST-X',title:'시험',recordTypeIds:['test-F01'],scope:'unknown-system',templateRevisionIds:['test-tpl-rev-1'],requestKey:'new-key',expectedContext:await getKnowledgeContext(env.bindings)},r.artifactId,r.revisionId)).rejects.toMatchObject({status:422});
 expect((await get<Artifact>(env.bindings,'artifacts',r.artifactId)).workingRevisionId).toBe(r.revisionId);
});
it('changed active policies cannot pass by retaining the release identifier and claimed hash',async()=>{
 env=await createTestEnvironment();const altered=structuredClone(env.bundle);altered.policies[0].roleId='reader';await env.bindings.SOURCES.put('releases/test-release.json',JSON.stringify(altered));
 await expect(getBundle(env.bindings,await getKnowledgeContext(env.bindings))).rejects.toMatchObject({status:503,code:'KNOWLEDGE_CHANGED'});
 await expect(record()).rejects.toMatchObject({status:503,code:'KNOWLEDGE_CHANGED'});
 expect(await env.bindings.DB.prepare("SELECT COUNT(*) n FROM artifacts WHERE kind='record'").first('n')).toBe(0);
});
it('a ten MiB Markdown file retains bounded metadata citations and remains submittable',async()=>{
 env=await createTestEnvironment();const heading='# large synthetic record\n',line='a'.repeat(1023)+'\n',body=heading+line.repeat(Math.floor((10*1024*1024-heading.length)/line.length));
 const bytes=new TextEncoder().encode(body.padEnd(10*1024*1024,'a'));
 const r=await registerRecord(env.bindings,await env.select('author'),{file:bytes,filename:'large.md',documentCode:'TEST-LARGE',title:'합성 최대 크기',recordTypeIds:['test-F01'],scope:'',templateRevisionIds:['test-tpl-rev-1'],requestKey:'large-create',expectedContext:await getKnowledgeContext(env.bindings)});
 const relations=(await env.bindings.DB.prepare('SELECT body FROM relations').all<{body:string}>()).results.map(row=>JSON.parse(row.body));
 expect(relations.every(relation=>relation.evidenceRefs[0].quote===heading.trim())).toBe(true);
 const result=await decideRevision(env.bindings,await env.select('author'),{artifactId:r.artifactId,revisionId:r.revisionId,decision:'submit',comment:'',requestKey:'large-submit',expectedContext:await getKnowledgeContext(env.bindings)}) as any;
 expect(result.status).toBe('in_review');
});
