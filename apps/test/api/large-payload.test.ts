import {afterEach,expect,it} from 'vitest';
import app from '../../worker/src/index';
import {createTestEnvironment,type TestEnvironment} from '../support/environment';
import {commitMutation,get,getKnowledgeContext,replay} from '../../worker/src/lib/storage';
import {sourceText} from '../support/fixtures';

let env:TestEnvironment;afterEach(async()=>env?.cleanup());
const large='합성'.repeat(400_000);
it('stores a large mutation response outside D1 and replays its exact result without a second mutation',async()=>{
 env=await createTestEnvironment();const actor=await env.select('author'),context=await getKnowledgeContext(env.bindings),result={candidate:{markdown:large},context};
 expect(Buffer.byteLength(JSON.stringify(result))).toBeGreaterThan(2*1024*1024);
 expect(await commitMutation(env.bindings,actor,'large-result','hash',context,result,[])).toEqual(result);
 const stored=await env.bindings.DB.prepare('SELECT result FROM mutation_requests WHERE request_key=?').bind('large-result').first<string>('result');
 expect(Buffer.byteLength(stored!)).toBeLessThan(1024);const ref=JSON.parse(stored!).__r2Json;expect(ref.key).toBe(`mutation-results/${ref.sha256}.json`);
 const after=await getKnowledgeContext(env.bindings);
 expect(await commitMutation(env.bindings,actor,'large-result','hash',context,{wrong:true},[])).toEqual(result);expect(await getKnowledgeContext(env.bindings)).toEqual(after);
 await expect(replay(env.bindings,actor,'large-result','changed')).rejects.toMatchObject({status:409,code:'REQUEST_KEY_CONFLICT'});
 await env.bindings.SOURCES.put(ref.key,'tampered');await expect(replay(env.bindings,actor,'large-result','hash')).rejects.toMatchObject({status:503,code:'JSON_PAYLOAD_CHANGED'});
 await env.bindings.SOURCES.delete(ref.key);await expect(replay(env.bindings,actor,'large-result','hash')).rejects.toMatchObject({status:503,code:'JSON_PAYLOAD_UNAVAILABLE'});
});
it('keeps context fencing and exposes no replay after a failed D1 transaction, retaining immutable orphan bytes safely',async()=>{
 env=await createTestEnvironment();const actor=await env.select('author'),context=await getKnowledgeContext(env.bindings);
 await env.bindings.DB.prepare('UPDATE context SET data_revision=data_revision+1 WHERE id=1').run();const before=await getKnowledgeContext(env.bindings);
 await expect(commitMutation(env.bindings,actor,'failed-large','hash',context,{large},[env.bindings.DB.prepare("INSERT INTO events VALUES('should-not-exist',NULL,'{}')")])).rejects.toMatchObject({status:409,code:'CONTEXT_CONFLICT'});
 expect(await replay(env.bindings,actor,'failed-large','hash')).toBeUndefined();expect(await getKnowledgeContext(env.bindings)).toEqual(before);
 expect(await env.bindings.DB.prepare("SELECT id FROM events WHERE id='should-not-exist'").first()).toBeNull();
 expect((await env.bindings.SOURCES.list({prefix:'mutation-results/'})).objects).toHaveLength(1);
});
it('keeps large build/decision/list/detail responses intact while change and replay rows stay small',async()=>{
 env=await createTestEnvironment();const actor=await env.select('admin'),headers={cookie:`iso_session=${actor.sessionId}`,'X-Session-Version':'1','Content-Type':'application/json'};
 const post=async(path:string,body:any)=>app.request(path,{method:'POST',headers,body:JSON.stringify({requestKey:crypto.randomUUID(),expectedContext:await getKnowledgeContext(env.bindings),...body})},env.bindings);
 const created=await post('/api/admin/regulation-changes',{title:'Synthetic large revision'});expect(created.status).toBe(201);const {changeId}=await created.json() as any,path=`/api/admin/regulation-changes/${changeId}`;
 const form=new FormData();form.set('file',new File([sourceText+'\n'+large+'\n'],'large.md'));for(const [key,value] of Object.entries({artifactId:'test-reg',documentCode:'TEST-PROC',title:'Synthetic large revision',kind:'procedure',requestKey:'large-upload',expectedContext:JSON.stringify(await getKnowledgeContext(env.bindings))}))form.set(key,value);
 const upload=await app.request(`${path}/files`,{method:'POST',headers:{cookie:headers.cookie,'X-Session-Version':'1'},body:form},env.bindings);expect(upload.status).toBe(201);
 const input={requestKey:'large-build',expectedContext:await getKnowledgeContext(env.bindings)},built=await post(`${path}/build`,input);expect(built.status,await built.clone().text()).toBe(200);const result=await built.json() as any;
 expect(result.candidate.sources.find((source:any)=>source.artifactId==='test-reg').markdown).toContain(large);
 expect(Buffer.byteLength(JSON.stringify(result.change.diff))).toBeGreaterThan(2*1024*1024);
 const stored=await get<any>(env.bindings,'regulation_changes',changeId);expect(Buffer.byteLength(JSON.stringify(stored))).toBeLessThan(1024*1024);expect(stored.diff.__r2Json.key).toMatch(/^regulation-diffs\/[a-f0-9]{64}\.json$/);
 expect((await (await app.request(path,{headers},env.bindings)).json() as any).change.diff).toEqual(result.change.diff);
 expect((await (await app.request('/api/admin/regulation-changes',{headers},env.bindings)).json() as any).items.find((change:any)=>change.id===changeId).diff).toEqual(result.change.diff);
 const validated=await post(`${path}/decisions`,{decision:'validate_knowledge',candidateHash:result.change.candidateHash,comment:'Synthetic exact large source checked'});expect(validated.status,await validated.clone().text()).toBe(200);
 expect((await validated.json() as any).change.diff).toEqual(result.change.diff);
 const repeated=await post(`${path}/build`,input);expect(repeated.status).toBe(200);expect(await repeated.json()).toEqual(result);
 const rows=await env.bindings.DB.prepare('SELECT result FROM mutation_requests').all<{result:string}>();expect(rows.results.every(row=>Buffer.byteLength(row.result)<1024*1024)).toBe(true);
 await env.bindings.SOURCES.put(stored.diff.__r2Json.key,'tampered');expect((await app.request(path,{headers},env.bindings)).status).toBe(503);
},60_000);
