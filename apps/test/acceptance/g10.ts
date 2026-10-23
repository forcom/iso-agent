import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import type {GraphResult,KnowledgeContext} from '../../packages/contracts/src/index';
import type {Artifact,Revision} from '../../worker/src/types';
import {sourceText} from '../support/fixtures';
import {openStaging,stagingDirectory} from '../staging/platform';
import {createHttp,message as maskedMessage,saveJson,stable,type Client,type Http,type Json} from './client';

// Run only after the separate synthetic Worker, D1, R2 and Container are deployed.
// openStaging verifies the real remote database identity before exposing bindings.
type Person = 'author'|'reviewer'|'approver'|'director'|'admin'|'reader';
type Step = {name:string;startedAt:string;finishedAt?:string;durationMs?:number;status:'running'|'passed'|'failed';evidence?:unknown;error?:string};
const report = {
  gate:'G-10',scope:'Remote synthetic staging only',runId:randomUUID(),startedAt:new Date().toISOString(),
  finishedAt:undefined as string|undefined,status:'running',target:'',error:undefined as string|undefined,
  steps:[] as Step[],requests:[] as Array<{method:string;path:string;status:number;durationMs:number;providerCalls:string|null}>,
};
const reportPath=resolve(stagingDirectory,'g10-report.json');
let platform:Awaited<ReturnType<typeof openStaging>>|undefined;
let token='',baseUrl='',engineHeld=false;
let engineMetadata:GraphResult['engine'];
const clients={} as Record<Person,Client>;
const hash=(input:string|Uint8Array)=>createHash('sha256').update(input).digest('hex');
function message(error:unknown) {return maskedMessage(error,[token]);}
async function saveReport() {await saveJson(reportPath,report);}
let http:Http;
async function step<T>(name:string,run:()=>Promise<T>):Promise<T> {
  const start=Date.now(),entry:Step={name,startedAt:new Date(start).toISOString(),status:'running'};
  report.steps.push(entry);await saveReport();
  try {const result=await run();entry.status='passed';entry.evidence=result;return result;}
  catch(error){entry.status='failed';entry.error=message(error);throw error;}
  finally {entry.finishedAt=new Date().toISOString();entry.durationMs=Date.now()-start;await saveReport();}
}
async function me(client:Client) {return (await http('/api/me',{client})).body as {context:KnowledgeContext;sessionVersion:number;actor:{personId:string;isAdmin:boolean}};}
async function mutate(path:string,client:Client,fields:Json={},expected=200,errorCode?:string) {
  return http(path,{client,json:{requestKey:randomUUID(),expectedContext:(await me(client)).context,...fields},expected,errorCode});
}
const tables=['context','persons','sessions','artifacts','revisions','relations','decisions','circulations','receipts','events','assignments','releases','regulation_changes','mutation_requests'] as const;
async function snapshot() {
  const env=platform!.env;
  const results=await env.DB.batch(tables.map(table=>env.DB.prepare(`SELECT * FROM ${table}`)));
  const database=Object.fromEntries(results.map((result,index)=>{
    assert.equal(result.success,true,`Snapshot query ${tables[index]} failed`);
    return [tables[index],{count:result.results.length,sha256:hash(stable(result.results.map(stable).sort()))}];
  }));
  const objects:Array<{key:string;size:number;etag:string;uploaded:string}>=[];
  let cursor:string|undefined;
  do {
    const page=await env.SOURCES.list({cursor,limit:1000});
    objects.push(...page.objects.map(object=>({key:object.key,size:object.size,etag:object.etag,uploaded:object.uploaded.toISOString()})));
    cursor=page.truncated?page.cursor:undefined;
  }while(cursor);
  objects.sort((a,b)=>a.key.localeCompare(b.key));
  return {sha256:hash(stable({database,objects})),database,objectCount:objects.length,objectsSha256:hash(stable(objects))};
}
function unchanged(before:Awaited<ReturnType<typeof snapshot>>,after:Awaited<ReturnType<typeof snapshot>>) {
  assert.equal(after.sha256,before.sha256,'D1 rows or R2 objects changed during a rejected/read-only request');
  return {before,after,unchanged:true};
}
async function stored<T>(table:'artifacts'|'revisions'|'regulation_changes',id:string):Promise<T> {
  const row=await platform!.env.DB.prepare(`SELECT body FROM ${table} WHERE id=?`).bind(id).first<{body:string}>();
  assert.ok(row,`${table} row ${id} missing`);return JSON.parse(row.body);
}
async function bodyRows(table:'decisions'|'events',field:'revision_id'|'artifact_id',id:string):Promise<Json[]> {
  return (await platform!.env.DB.prepare(`SELECT body FROM ${table} WHERE ${field}=? ORDER BY id`).bind(id).all<{body:string}>()).results.map(row=>JSON.parse(row.body));
}
async function uploadForm(client:Client,text:string,fields:Record<string,string>) {
  const form=new FormData();
  form.set('file',new File([text],'g10-synthetic.md',{type:'text/markdown'}));
  form.set('requestKey',randomUUID());form.set('expectedContext',JSON.stringify((await me(client)).context));
  for(const [key,value] of Object.entries(fields))form.set(key,value);
  return form;
}
function recordFields(code:string,type:'test-F01'|'test-F02',extra:Record<string,string>={}) {
  return {documentCode:code,title:`G10 synthetic ${type}`,recordTypeIds:JSON.stringify([type]),templateRevisionIds:JSON.stringify([type==='test-F01'?'test-tpl-rev-1':'test-tpl-rev-2']),...extra};
}
async function verifyOriginal(revisionId:string,text:string) {
  const revision=await stored<Revision>('revisions',revisionId);
  const original=await platform!.env.SOURCES.get(revision.objectKey);
  assert.ok(original,'R2 original missing');
  const bytes=new Uint8Array(await original.arrayBuffer());
  assert.ok(Buffer.from(bytes).equals(Buffer.from(text)),'R2 original bytes differ from uploaded file');
  assert.equal(revision.sourceSha256,hash(Buffer.from(text)));
  const normalized=text.replace(/\r\n?/g,'\n');
  assert.equal(revision.textSha256,hash(normalized));
  const content=(await http(`/api/artifacts/${revision.artifactId}/revisions/${revisionId}/content`,{client:clients.reader})).body;
  assert.equal(content.markdown,normalized);assert.equal(content.evidenceStatus,'verified');
  return {revisionId,objectKey:revision.objectKey,sourceSha256:revision.sourceSha256,textSha256:revision.textSha256,bytes:bytes.length};
}
type ActionView={revisionId:string;revisionVersion:string;state:string;context:KnowledgeContext;actions:Array<{action:string;allowed:boolean;engine?:GraphResult['engine'];evidenceRefs:unknown[];policyIds:string[]}>};
async function actions(client:Client,artifactId:string,revisionId:string):Promise<ActionView> {
  const view=(await http<ActionView>(`/api/records/${artifactId}/actions?revisionId=${revisionId}`,{client})).body;
  assert.equal(view.revisionId,revisionId);assert.ok(view.revisionVersion);
  return view;
}
async function decide(client:Client,record:{artifactId:string;revisionId:string},decision:'submit'|'review'|'approve',expected=200) {
  const view=await actions(client,record.artifactId,record.revisionId);
  const action=view.actions.find(item=>item.action===decision);
  assert.ok(action);assert.equal(action.allowed,expected===200,`${client.personId} ${decision} eligibility`);
  assert.deepEqual(action.engine,engineMetadata);
  if(expected===200){assert.ok(action.policyIds.length);assert.ok(action.evidenceRefs.length);}
  return http(decision==='submit'?`/api/records/${record.artifactId}/submit`:`/api/revisions/${record.revisionId}/decisions`,{
    client,expected,errorCode:expected===403?'ACTION_DENIED':undefined,
    json:{revisionId:view.revisionId,expectedRevisionVersion:view.revisionVersion,expectedState:view.state,expectedContext:view.context,decision,comment:'G10 synthetic decision only',requestKey:randomUUID()},
  });
}
async function main() {
  platform=await openStaging();
  const {config,env}=platform;
  baseUrl=`https://${config.name}.your-e37.workers.dev`;report.target=baseUrl;
  const tokenPath=resolve(stagingDirectory,'.g10-token');
  assert.equal((await stat(tokenPath)).mode&0o077,0,'Staging token must not be group/world readable');
  token=(await readFile(tokenPath,'utf8')).trim();assert.ok(token.length>=32,'Missing staging access token');
  http=createHttp({baseUrl,headers:{'X-G10-Token':token},onRequest:entry=>{report.requests.push(entry)}});
  await step('guarded staging and actual PyreWire health',async()=>{
    const health=(await http('/__g10/health',{method:'POST'})).body;
    assert.equal(health.status,'ok');assert.equal(health.engine?.name,'PyreWire');
    assert.ok(health.engine?.version);assert.match(health.engine?.rulesHash??'',/^[a-f\d]{64}$/);
    engineMetadata=health.engine;
    const people=(await http('/api/persons')).body.items as Array<{id:string}>;
    assert.deepEqual(people.map(person=>person.id).sort(),['admin','approver','author','director','reader','reviewer']);
    for(const personId of ['author','reviewer','approver','director','admin','reader'] as Person[]){
      const selected=await http('/api/session',{json:{personId}});
      const cookie=selected.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie,'Missing session cookie');
      clients[personId]={personId,cookie,version:selected.body.sessionVersion};
      assert.equal(selected.body.actor.personId,personId);assert.equal(selected.body.actor.isAdmin,personId==='admin');
      assert.equal(selected.body.context.rulesHash,engineMetadata.rulesHash);
    }
    return {worker:config.name,d1:config.d1_databases[0].database_name,r2:config.r2_buckets[0].bucket_name,engine:engineMetadata,persons:people.map(person=>person.id),context:(await me(clients.reader)).context};
  });
  await step('common source reading and rejected reader upload leave storage unchanged',async()=>{
    const before=await snapshot();
    for(const client of Object.values(clients)){
      const content=(await http('/api/artifacts/test-reg/revisions/test-reg-rev/content',{client})).body;
      assert.equal(content.markdown,sourceText);assert.equal(content.evidenceStatus,'verified');
    }
    const form=await uploadForm(clients.reader,'# Synthetic rejected upload\n',recordFields(`G10-DENIED-${report.runId}`,'test-F01'));
    await http('/api/records',{client:clients.reader,form,expected:403,errorCode:'ACTION_DENIED'});
    return unchanged(before,await snapshot());
  });
  let f01!: {artifactId:string;revisionId:string},f02!: {artifactId:string;revisionId:string};
  let firstRevisionId='';
  await step('real multipart upload, exact R2 bytes and independent revision preservation',async()=>{
    const code=`G10-F01-${report.runId}`,first='# 합성 G10 기록 v1\r\n\r\nUTF-8 원본 바이트 보존 확인.\r\n';
    const created=await http('/api/records',{client:clients.author,form:await uploadForm(clients.author,first,recordFields(code,'test-F01')),expected:201});
    f01=created.body as typeof f01;firstRevisionId=f01.revisionId;
    const firstProof=await verifyOriginal(firstRevisionId,first);
    const second='# 합성 G10 기록 v2\n\n두 번째 버전은 별도로 보존합니다.\n';
    const revised=await http(`/api/records/${f01.artifactId}/revisions`,{client:clients.author,form:await uploadForm(clients.author,second,recordFields(code,'test-F01',{expectedRevisionId:firstRevisionId})),expected:201});
    assert.equal(revised.body.artifactId,f01.artifactId);assert.notEqual(revised.body.revisionId,firstRevisionId);f01=revised.body as typeof f01;
    const secondProof=await verifyOriginal(f01.revisionId,second);await verifyOriginal(firstRevisionId,first);
    const artifact=await stored<Artifact>('artifacts',f01.artifactId),revision=await stored<Revision>('revisions',f01.revisionId);
    assert.equal(artifact.workingRevisionId,f01.revisionId);assert.equal(artifact.effectiveRevisionId,null);assert.equal(revision.previousRevisionId,firstRevisionId);
    const text='# Synthetic F02 record\nG10 type-specific approval.\n';
    f02=(await http('/api/records',{client:clients.author,form:await uploadForm(clients.author,text,recordFields(`G10-F02-${report.runId}`,'test-F02')),expected:201})).body as typeof f02;
    return {artifactId:f01.artifactId,first:firstProof,second:secondProof,f02:await verifyOriginal(f02.revisionId,text)};
  });
  await step('type-specific real authorization, exact revision review and approval history',async()=>{
    for(const record of [f01,f02]){
      assert.equal((await decide(clients.author,record,'submit')).body.status,'in_review');
      assert.equal((await decide(clients.reviewer,record,'review')).body.status,'reviewed');
    }
    const beforeDenials=await snapshot();
    await decide(clients.admin,f01,'approve',403);
    await decide(clients.reader,f01,'approve',403);
    await decide(clients.approver,f02,'approve',403);
    const denialProof=unchanged(beforeDenials,await snapshot());
    assert.equal((await decide(clients.approver,f01,'approve')).body.status,'approved');
    assert.equal((await decide(clients.director,f02,'approve')).body.status,'approved');
    const history=[];
    for(const [record,approvalActor,type] of [[f01,'approver','test-F01'],[f02,'director','test-F02']] as const){
      const revision=await stored<Revision>('revisions',record.revisionId),artifact=await stored<Artifact>('artifacts',record.artifactId);
      assert.equal(revision.state,'approved');assert.equal(artifact.effectiveRevisionId,record.revisionId);
      const decisions=await bodyRows('decisions','revision_id',record.revisionId);
      assert.equal(decisions.length,3);
      for(const [decision,actorId] of [['submit','author'],['review','reviewer'],['approve',approvalActor]]){
        const row=decisions.find(row=>row.decision===decision);assert.ok(row);
        assert.equal(row.actorId,actorId);assert.equal(row.revisionId,record.revisionId);assert.equal(row.sourceSha256,revision.sourceSha256);
        assert.deepEqual(row.recordTypeIds,[type]);assert.equal(row.authorization.allowed,true);assert.deepEqual(row.authorization.engine,engineMetadata);
        assert.equal(row.submissionId,revision.submissionId);
      }
      const events=await bodyRows('events','artifact_id',record.artifactId);
      for(const decision of decisions)assert.ok(events.some(event=>event.decisionId===decision.id&&event.revisionId===record.revisionId));
      history.push({artifactId:record.artifactId,revisionId:record.revisionId,sourceSha256:revision.sourceSha256,decisions:decisions.map(({id,decision,actorId,revisionId,recordTypeIds})=>({id,decision,actorId,revisionId,recordTypeIds}))});
    }
    assert.equal((await bodyRows('decisions','revision_id',firstRevisionId)).length,0,'Superseded version must not receive decisions for its replacement');
    return {deniedWithoutMutation:denialProof,history};
  });
  let publishedRevisionId='';
  await step('remote regulation rebuild, independent decisions and atomic release publication',async()=>{
    const beforeDenied=await snapshot();
    await mutate('/api/admin/regulation-changes',clients.author,{title:'G10 forbidden non-admin change'},403,'ADMIN_REQUIRED');
    const deniedWithoutMutation=unchanged(beforeDenied,await snapshot());
    const created=(await mutate('/api/admin/regulation-changes',clients.admin,{title:`G10 synthetic regulation ${report.runId}`},201)).body;
    const path=`/api/admin/regulation-changes/${created.changeId}`;
    const text=sourceText+`\nG10 합성 개정 부기 ${report.runId}\n`;
    const uploaded=(await http(`${path}/files`,{client:clients.admin,form:await uploadForm(clients.admin,text,{artifactId:'test-reg',documentCode:'TEST-PROC',title:'시험 절차',kind:'procedure'}),expected:201})).body;
    const detail=(await http(path,{client:clients.admin})).body;
    assert.equal(detail.change.revisionIds.length,1);publishedRevisionId=detail.change.revisionIds[0];
    assert.ok(uploaded);const originalProof=await verifyOriginal(publishedRevisionId,text);
    let candidate=(await mutate(`${path}/build`,clients.admin)).body;
    assert.ok(candidate.change.candidateHash);assert.equal(candidate.change.state,'built');assert.ok(candidate.change.diff);
    candidate=(await mutate(`${path}/decisions`,clients.admin,{decision:'validate_knowledge',candidateHash:candidate.change.candidateHash,comment:'G10 synthetic candidate source and permissions inspected'})).body;
    assert.equal(candidate.change.state,'validated');const candidateHash=candidate.change.candidateHash;
    await mutate(`${path}/decisions`,clients.reviewer,{decision:'review',candidateHash,comment:'G10 synthetic regulatory review'});
    await mutate(`${path}/decisions`,clients.director,{decision:'approve',candidateHash,comment:'G10 synthetic regulatory approval'});
    const before=(await me(clients.director)).context;
    const published=(await mutate(`${path}/publish`,clients.director,{candidateHash})).body;
    const after=(await me(clients.reader)).context;
    assert.notEqual(after.releaseId,before.releaseId);assert.equal(after.releaseId,candidate.change.candidateReleaseId);assert.equal(after.authorityRevision,before.authorityRevision+1);assert.equal(after.dataRevision,before.dataRevision+1);assert.deepEqual(published.context,after);
    const contextRow=await env.DB.prepare('SELECT release_id,authority_revision,data_revision FROM context WHERE id=1').first<Json>();
    assert.equal(contextRow?.release_id,after.releaseId);assert.equal(contextRow?.authority_revision,after.authorityRevision);
    assert.equal((await stored<Artifact>('artifacts','test-reg')).effectiveRevisionId,publishedRevisionId);
    assert.equal((await stored<Revision>('revisions',publishedRevisionId)).state,'approved');
    assert.equal((await stored<Json>('regulation_changes',created.changeId)).state,'published');
    const decisions=(await env.DB.prepare("SELECT body FROM decisions WHERE json_extract(body,'$.changeId')=?").bind(created.changeId).all<{body:string}>()).results.map(row=>JSON.parse(row.body));
    assert.equal(decisions.length,3);
    for(const [decision,actorId] of [['validate_knowledge','admin'],['review','reviewer'],['approve','director']]){
      const row=decisions.find(row=>row.decision===decision);assert.ok(row);assert.equal(row.actorId,actorId);assert.equal(row.candidateHash,candidateHash);assert.equal(row.context.releaseId,before.releaseId);
    }
    const release=await env.DB.prepare('SELECT object_key,body FROM releases WHERE id=?').bind(after.releaseId).first<{object_key:string;body:string}>();assert.ok(release);
    const object=await env.SOURCES.get(release.object_key);assert.ok(object);const bundle=await object.json<Json>();
    assert.equal(bundle.manifest.manifestHash,candidateHash);assert.equal(bundle.manifest.releaseId,after.releaseId);
    assert.ok(bundle.sources.some((source:Json)=>source.revisionId===publishedRevisionId));
    return {deniedWithoutMutation,changeId:created.changeId,candidateHash,original:originalProof,before,after,decisions:decisions.map(({id,decision,actorId}:Json)=>({id,decision,actorId})),releaseObjectKey:release.object_key};
  });
  await step('actual OpenAI draft remains separate from actual PyreWire impact set',async()=>{
    const before=await snapshot();
    const graph=(await http<GraphResult>('/api/graph/query',{client:clients.reader,json:{mode:'impact',targetId:publishedRevisionId}})).body;
    assert.deepEqual(graph.engine,engineMetadata);
    const response=await http('/api/impact/draft',{client:clients.reader,json:{targetId:publishedRevisionId,description:'합성 시험 절차 개정의 영향을 검토용 초안으로 설명하세요. 실제 운영 사실을 만들지 말고, 제공된 계산 영향 집합이 비었으면 그 한계를 명시하세요.'}});
    const result=response.body;assert.ok(Number(response.headers.get('X-G10-Llm-Provider-Calls'))>0,'No real LLM provider entry observed');
    assert.equal(typeof result.draft,'string');assert.ok(result.draft.trim().length>0);assert.match(result.disclaimer,/초안/);
    assert.deepEqual(result.impactSet,graph.impactSet??[]);assert.deepEqual(result.computed.impactSet,graph.impactSet??[]);
    assert.deepEqual(result.computed.engine,engineMetadata);assert.deepEqual(result.context,graph.context);
    assert.deepEqual(result.computed.relations.map((relation:Json)=>relation.id).sort(),graph.relations.map(relation=>relation.id).sort());
    assert.ok(result.grounding.sources.some((source:Json)=>source.revisionId===publishedRevisionId));
    return {provider:'OpenAI',providerEntries:Number(response.headers.get('X-G10-Llm-Provider-Calls')),engine:graph.engine,context:graph.context,impactSet:result.impactSet,draft:result.draft,disclaimer:result.disclaimer,groundingRevisionIds:result.grounding.sources.map((source:Json)=>source.revisionId),storage:unchanged(before,await snapshot())};
  });
  await step('actual stopped Container returns 503 without storage mutation or LLM entry',async()=>{
    const form=await uploadForm(clients.author,'# Synthetic outage upload\nThis must not be registered.\n',recordFields(`G10-OUTAGE-${report.runId}`,'test-F01'));
    const before=await snapshot();engineHeld=true;
    const stop=(await http('/__g10/stop',{method:'POST'})).body;
    assert.equal(stop.running,false,'The actual Container process is still running after SIGKILL');
    const graph=await http('/api/graph/query',{client:clients.reader,json:{mode:'neighbors',targetId:'test-reg'},expected:503,errorCode:'ENGINE_UNAVAILABLE'});
    const ask=await http('/api/ask',{client:clients.reader,json:{question:'합성 시험 절차의 근거를 설명하세요.'},expected:503,errorCode:'ENGINE_UNAVAILABLE'});
    const impact=await http('/api/impact/draft',{client:clients.reader,json:{targetId:publishedRevisionId,description:'합성 엔진 장애 중 초안 생성은 차단되어야 합니다.'},expected:503,errorCode:'ENGINE_UNAVAILABLE'});
    const upload=await http('/api/records',{client:clients.author,form,expected:503,errorCode:'ENGINE_UNAVAILABLE'});
    for(const result of [graph,ask,impact,upload])assert.equal(result.headers.get('X-G10-Llm-Provider-Calls'),'0');
    const content=(await http(`/api/artifacts/test-reg/revisions/${publishedRevisionId}/content`,{client:clients.reader})).body;
    assert.equal(content.evidenceStatus,'verified');
    return {stopState:stop,failures:[{operation:'graph',status:graph.status},{operation:'ask',status:ask.status},{operation:'impact',status:impact.status},{operation:'upload',status:upload.status}],providerEntries:0,sourceReadStatus:200,storage:unchanged(before,await snapshot())};
  });
}

try {await main();report.status='passed';}
catch(error){report.status='failed';report.error=message(error);console.error(`G10 failed: ${report.error}`);process.exitCode=1;}
finally {
  if(engineHeld){
    try {
      await step('resume stopped Container and recheck actual PyreWire health',async()=>{
        const health=(await http('/__g10/resume',{method:'POST'})).body;
        assert.equal(health.status,'ok');assert.deepEqual(health.engine,engineMetadata);engineHeld=false;return health;
      });
    }catch(error){report.status='failed';process.exitCode=1;console.error(`G10 engine recovery failed: ${message(error)}`);}
  }
  try{await platform?.dispose();}catch(error){report.status='failed';process.exitCode=1;console.error(`G10 binding cleanup failed: ${message(error)}`);}
  report.finishedAt=new Date().toISOString();await saveReport();
  console.log(JSON.stringify({gate:report.gate,status:report.status,steps:report.steps.map(({name,status,durationMs})=>({name,status,durationMs})),report:reportPath}));
}
