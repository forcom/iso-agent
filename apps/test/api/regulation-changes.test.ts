import {it,expect,afterEach,vi} from 'vitest';
import app from '../../worker/src/index';
import {createTestEnvironment,type TestEnvironment} from '../support/environment';
import {getKnowledgeContext,get,getBundle} from '../../worker/src/lib/storage';
let env:TestEnvironment;afterEach(async()=>{vi.restoreAllMocks();await env?.cleanup()});
async function headers(personId:string){const a=await env.select(personId);return {cookie:`iso_session=${a.sessionId}`,'X-Session-Version':'1'}}
async function post(path:string,person:string,body:any){return app.request(path,{method:'POST',headers:{...await headers(person),'Content-Type':'application/json'},body:JSON.stringify({requestKey:crypto.randomUUID(),expectedContext:await getKnowledgeContext(env.bindings),...body})},env.bindings)}
it('admin proposal, full rebuild, separate knowledge validation and old-policy publication',async()=>{
 env=await createTestEnvironment();
 expect((await post('/api/admin/regulation-changes','author',{title:'시험 개정'})).status).toBe(403);
 const created=await post('/api/admin/regulation-changes','admin',{title:'시험 개정'});expect(created.status).toBe(201);const {changeId}=await created.json() as any;
 const data=new FormData();const original=env.bundle.sources.find(s=>s.code==='TEST-PROC')!;
 data.set('file',new File([original.markdown+'\n시험 개정 부기\n'],'reg.md'));data.set('artifactId',original.artifactId);data.set('documentCode',original.code);data.set('title',original.title);data.set('kind','procedure');data.set('requestKey',crypto.randomUUID());data.set('expectedContext',JSON.stringify(await getKnowledgeContext(env.bindings)));
 const upload=await app.request(`/api/admin/regulation-changes/${changeId}/files`,{method:'POST',headers:await headers('admin'),body:data},env.bindings);expect(upload.status).toBe(201);
 const built=await post(`/api/admin/regulation-changes/${changeId}/build`,'admin',{});expect(built.status).toBe(200);let candidate=await built.json() as any;
 expect((await post(`/api/admin/regulation-changes/${changeId}/decisions`,'admin',{decision:'approve',candidateHash:candidate.change.candidateHash,comment:'권한 없음'})).status).toBe(403);
 const validated=await post(`/api/admin/regulation-changes/${changeId}/decisions`,'admin',{decision:'validate_knowledge',candidateHash:candidate.change.candidateHash,comment:'전체 조항과 권한 후보를 확인함'});expect(validated.status).toBe(200);candidate=await validated.json() as any;
 expect((await post(`/api/admin/regulation-changes/${changeId}/decisions`,'reviewer',{decision:'review',candidateHash:candidate.change.candidateHash,comment:'검토'})).status).toBe(200);
 expect((await post(`/api/admin/regulation-changes/${changeId}/decisions`,'director',{decision:'approve',candidateHash:candidate.change.candidateHash,comment:'승인'})).status).toBe(200);
 const before=await getKnowledgeContext(env.bindings);
 const published=await post(`/api/admin/regulation-changes/${changeId}/publish`,'director',{candidateHash:candidate.change.candidateHash});expect(published.status).toBe(200);
 const after=await getKnowledgeContext(env.bindings);expect(after.releaseId).not.toBe(before.releaseId);expect(after.authorityRevision).toBe(before.authorityRevision+1);
 const history=await env.bindings.DB.prepare("SELECT COUNT(*) AS n FROM revisions WHERE artifact_id='test-reg'").first('n');expect(history).toBe(2);
});
it('withdrawal rejects malformed extraction and preserves historical originals after an approved release',async()=>{
 env=await createTestEnvironment();env.bindings.OPENAI_API_KEY='synthetic-key';
 const original=env.bundle.sources.find(s=>s.code==='test-F02')!;
 const {changeId}=await (await post('/api/admin/regulation-changes','admin',{title:'시험 양식 철회'})).json() as any;
 const path=`/api/admin/regulation-changes/${changeId}`;
 expect((await post(`${path}/withdrawals`,'admin',{artifactId:original.artifactId,reason:'다른 양식으로 통합'})).status).toBe(200);
 const fetchOriginal=globalThis.fetch;let extraction:any={policies:[null]};
 vi.spyOn(globalThis,'fetch').mockImplementation((input,init)=>String(input).startsWith('https://api.openai.com')?Promise.resolve(Response.json({choices:[{message:{content:JSON.stringify(extraction)}}]})):fetchOriginal(input,init));
 expect((await post(`${path}/build`,'admin',{})).status).toBe(422);
 const unchanged=await getKnowledgeContext(env.bindings);expect(unchanged.releaseId).toBe(env.bundle.manifest.releaseId);
 extraction={...env.bundle.mappings,sources:env.bundle.mappings.sources.filter(s=>s.sourceCode!==original.code),recordTypes:env.bundle.recordTypes.filter(t=>t.id!=='test-F02'),policies:env.bundle.policies.filter(p=>p.resourceTypeId!=='test-F02')};
 const built=await post(`${path}/build`,'admin',{});expect(built.status).toBe(200);let candidate=await built.json() as any;
 const validated=await post(`${path}/decisions`,'admin',{decision:'validate_knowledge',candidateHash:candidate.change.candidateHash,comment:'통합 대상과 근거 확인'});expect(validated.status).toBe(200);candidate=await validated.json() as any;
 for(const [person,decision] of [['reviewer','review'],['director','approve']])expect((await post(`${path}/decisions`,person,{decision,candidateHash:candidate.change.candidateHash,comment:'철회 검토'})).status).toBe(200);
 expect((await post(`${path}/publish`,'director',{candidateHash:candidate.change.candidateHash})).status).toBe(200);
 const artifact=await get<any>(env.bindings,'artifacts',original.artifactId),revision=await get<any>(env.bindings,'revisions',original.revisionId);
 expect(artifact.effectiveRevisionId).toBeNull();expect(await env.bindings.SOURCES.get(revision.objectKey)).not.toBeNull();
 expect((await getBundle(env.bindings,await getKnowledgeContext(env.bindings))).recordTypes.some(t=>t.id==='test-F02')).toBe(false);
});
async function upload(changeId:string,fields:Record<string,string>,text:string){
 const data=new FormData();data.set('file',new File([text],'reg.md'));for(const [name,value] of Object.entries(fields))data.set(name,value);
 data.set('requestKey',crypto.randomUUID());data.set('expectedContext',JSON.stringify(await getKnowledgeContext(env.bindings)));
 return app.request(`/api/admin/regulation-changes/${changeId}/files`,{method:'POST',headers:await headers('admin'),body:data},env.bindings);
}
async function open(title:string){return ((await (await post('/api/admin/regulation-changes','admin',{title})).json()) as any).changeId as string}
it('CRLF uploads keep reviewed quotes; a stale change is rebased and a cancelled change frees its new code',async()=>{
 env=await createTestEnvironment();
 const procedure=env.bundle.sources.find(s=>s.code==='TEST-PROC')!,template=env.bundle.sources.find(s=>s.code==='test-F01')!;
 const first=await open('CRLF 개정'),stale=await open('양식 개정'),abandoned=await open('신규 지침');
 expect((await upload(first,{artifactId:procedure.artifactId,documentCode:procedure.code,title:procedure.title,kind:'procedure'},(procedure.markdown+'\n시험 개정 부기\n').replace(/\n/g,'\r\n'))).status).toBe(201);
 expect((await upload(stale,{artifactId:template.artifactId,documentCode:template.code,title:template.title,kind:'template'},template.markdown+'\n양식 부기\n')).status).toBe(201);
 expect((await upload(abandoned,{documentCode:'TEST-NEW',title:'신규 지침',kind:'guide'},'# 신규 지침\n시험 내용\n')).status).toBe(201);
 const built=await post(`/api/admin/regulation-changes/${first}/build`,'admin',{});expect(built.status).toBe(200);let candidate=await built.json() as any;
 expect(candidate.change.diff.issues.map((issue:any)=>issue.code)).not.toContain('missing_quote');
 const validated=await post(`/api/admin/regulation-changes/${first}/decisions`,'admin',{decision:'validate_knowledge',candidateHash:candidate.change.candidateHash,comment:'확인'});expect(validated.status).toBe(200);candidate=await validated.json();
 for(const [person,decision] of [['reviewer','review'],['director','approve']])expect((await post(`/api/admin/regulation-changes/${first}/decisions`,person,{decision,candidateHash:candidate.change.candidateHash,comment:'결정'})).status).toBe(200);
 expect((await post(`/api/admin/regulation-changes/${first}/publish`,'director',{candidateHash:candidate.change.candidateHash})).status).toBe(200);
 expect((await post(`/api/admin/regulation-changes/${stale}/build`,'admin',{})).status).toBe(409);
 expect((await post(`/api/admin/regulation-changes/${stale}/rebase`,'author',{})).status).toBe(403);
 expect((await post(`/api/admin/regulation-changes/${stale}/rebase`,'admin',{})).status).toBe(200);
 expect((await post(`/api/admin/regulation-changes/${stale}/build`,'admin',{})).status).toBe(200);
 expect((await post(`/api/admin/regulation-changes/${abandoned}/cancel`,'admin',{})).status).toBe(422);
 expect((await post(`/api/admin/regulation-changes/${abandoned}/cancel`,'admin',{comment:'계획 철회'})).status).toBe(200);
 expect((await post(`/api/admin/regulation-changes/${abandoned}/build`,'admin',{})).status).toBe(409);
 expect((await upload(await open('신규 지침 재등록'),{documentCode:'TEST-NEW',title:'신규 지침',kind:'guide'},'# 신규 지침\n다시 작성\n')).status).toBe(201);
 const revised=await open('취소할 개정');expect((await upload(revised,{artifactId:template.artifactId,documentCode:template.code,title:template.title,kind:'template'},template.markdown+'\n다른 부기\n')).status).toBe(201);
 expect((await post(`/api/admin/regulation-changes/${revised}/cancel`,'admin',{comment:'불필요'})).status).toBe(200);
 const artifact=await get<any>(env.bindings,'artifacts',template.artifactId);expect(artifact.workingRevisionId).toBe(artifact.effectiveRevisionId);
});
