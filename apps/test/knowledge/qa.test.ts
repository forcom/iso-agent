import {it,expect,afterEach,vi} from 'vitest';
import {createTestEnvironment,type TestEnvironment} from '../support/environment';
import {answerQuestion,selectGrounding} from '../../worker/src/lib/llm';
import {getKnowledgeContext} from '../../worker/src/lib/storage';
let env:TestEnvironment;afterEach(async()=>{vi.restoreAllMocks();await env?.cleanup()});
it('changed or unavailable originals excluded, no hash never verified',async()=>{
 env=await createTestEnvironment();const context=await getKnowledgeContext(env.bindings);
 const before=await selectGrounding(env.bindings,context);expect(before.sources).toHaveLength(3);
 const row=await env.bindings.DB.prepare("SELECT body FROM revisions WHERE id='test-reg-rev'").first<{body:string}>();await env.bindings.SOURCES.delete(JSON.parse(row!.body).objectKey);
 const after=await selectGrounding(env.bindings,context);expect(after.sources).toHaveLength(2);expect(after.excluded[0].reason).toBe('SOURCE_UNAVAILABLE');
});
it('engine down never calls LLM; LLM failure preserves calculated grounding',async()=>{
 env=await createTestEnvironment();const actor=await env.select('reader');env.bindings.OPENAI_API_KEY='synthetic-key';
 const original=globalThis.fetch;let calls=0;
 vi.spyOn(globalThis,'fetch').mockImplementation((input,init)=>{if(String(input).startsWith('https://api.openai.com')){calls++;return Promise.resolve(new Response('{}',{status:500}))}return original(input,init)});
 await expect(answerQuestion({...env.bindings,ENGINE_URL:'http://127.0.0.1:1'},actor,'시험 질문')).rejects.toMatchObject({status:503});expect(calls).toBe(0);
 try{await answerQuestion(env.bindings,actor,'시험 질문');throw new Error('expected failure')}catch(e:any){expect(e.status).toBe(502);expect(e.details.grounding.sources.length).toBe(3);expect(e.details.computed.engine.name).toBe('PyreWire')}
 expect(calls).toBe(1);
});
