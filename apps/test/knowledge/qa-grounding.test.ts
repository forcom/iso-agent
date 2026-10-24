import {afterEach,expect,it,vi} from 'vitest';
import {createTestEnvironment,type TestEnvironment} from '../support/environment';
import {syntheticBundle} from '../support/fixtures';
import {answerQuestion,selectGrounding} from '../../worker/src/lib/llm';
import {getKnowledgeContext} from '../../worker/src/lib/storage';
import {canonical,sha256} from '../../packages/knowledge/src/index';
import type {SourceRevision,KnowledgeBundle} from '../../packages/contracts/src/index';
import type {Artifact,Revision} from '../../worker/src/types';
let env:TestEnvironment;
afterEach(async()=>{vi.restoreAllMocks();await env?.cleanup()});
async function setup(extra:Partial<SourceRevision>[]=[],amend?:(bundle:KnowledgeBundle)=>void){
 const bundle=await syntheticBundle();
 bundle.recordTypes[0].recordApproval={label:'계획 내용 승인',limitations:'실행·효과성 검증·종결을 승인하지 않습니다.'};
 for(const item of extra){const markdown=item.markdown!,digest=await sha256(markdown);bundle.sources.push({artifactId:'general',revisionId:'general-rev',code:'GENERAL-PROC',title:'종합 규정',kind:'procedure',path:'synthetic/general.md',sha256:digest,textSha256:digest,markdown,...item});}
 for(const source of bundle.sources)if(!bundle.entities.some(entity=>entity.id===source.revisionId))bundle.entities.push({id:source.revisionId,type:'ArtifactRevision',label:source.title,evidenceRefs:[],metadata:{artifactId:source.artifactId,regulationType:source.kind,artifactKind:source.kind==='template'?'template':'regulation'}});
 amend?.(bundle);bundle.manifest.manifestHash='';bundle.manifest.manifestHash=await sha256(canonical(bundle));env=await createTestEnvironment(bundle);
}
async function record(code:string,title:string,markdown:string,state:Revision['state']='approved'){
 const id=`artifact-${code}`,revisionId=`revision-${code}`,digest=await sha256(markdown),objectKey=`sources/${revisionId}/${digest}.md`,textKey=`text/${revisionId}.txt`;
 const artifact:Artifact={id,documentCode:code,title,kind:'record',recordTypeIds:['test-F01'],workingRevisionId:revisionId,effectiveRevisionId:state==='approved'?revisionId:null,systemIds:[]};
 const revision:Revision={id:revisionId,artifactId:id,filename:'synthetic.md',sourceSha256:digest,textSha256:digest,objectKey,textKey,state,createdAt:'2044-01-01',createdBy:'author',previousRevisionId:null,templateRevisionIds:['test-tpl-rev-1'],systemIds:[],conditions:{requiredControlsVerified:false},fieldMappings:{},evidenceStatus:'verified',approvalScope:'record',implementerIds:['author']};
 await env.bindings.SOURCES.put(objectKey,markdown);await env.bindings.SOURCES.put(textKey,markdown);
 await env.bindings.DB.prepare('INSERT INTO artifacts VALUES(?,?,?,?)').bind(id,code,'record',JSON.stringify(artifact)).run();await env.bindings.DB.prepare('INSERT INTO revisions VALUES(?,?,?)').bind(revisionId,id,JSON.stringify(revision)).run();
 const relation={id:`has-${code}`,subjectId:id,objectId:revisionId,type:'has_revision',origin:'explicit_metadata',reviewStatus:'validated',releaseId:env.bundle.manifest.releaseId,evidenceRefs:[{revisionId,sourceSha256:digest,lineStart:1,lineEnd:1,quote:markdown.split('\n')[0]}]};await env.bindings.DB.prepare('INSERT INTO relations VALUES(?,?)').bind(relation.id,JSON.stringify(relation)).run();return {id,revisionId};
}
function provider(answer?: (prompt:any)=>string){
 env.bindings.OPENAI_API_KEY='synthetic-key';env.bindings.LLM_MODEL='gpt-4.1';const original=globalThis.fetch;let captured:any;
 vi.spyOn(globalThis,'fetch').mockImplementation((input,init)=>{if(String(input).startsWith('https://api.openai.com')){captured=JSON.parse(String(init?.body));return Promise.resolve(new Response(JSON.stringify({choices:[{message:{content:answer?.(JSON.parse(captured.messages[1].content))??'Synthetic answer; no real provider called.'}}]}),{status:200,headers:{'Content-Type':'application/json'}}));}return original(input,init)});
 return ()=>({messages:captured.messages,prompt:JSON.parse(captured.messages[1].content),temperature:captured.temperature});
}
const general='# 종합 규정\n'+'문서 승인 실제 조치 효과성 검증 종결 원문 날짜 상태 결과를 알려주세요. '.repeat(2400).slice(0,99000);
it('finds an ID followed by a Korean particle before long generic sources exhaust the budget',async()=>{
 await setup([{markdown:general}]);const exact=await record('REC-2044-007','CASE-2044-007 조치 기록','# CASE-2044-007\nExecution is pending.\n'+'Synthetic detail. '.repeat(100));provider();
 const result=await answerQuestion(env.bindings,await env.select('reader'),'CASE-2044-007은 종결됐나요? 문서 승인과 실제 조치 효과성 검증을 구분하고 원문 날짜를 알려주세요.');
 expect(result.grounding.sources[0].revisionId).toBe(exact.revisionId);expect(result.grounding.sources.reduce((n,s)=>n+s.markdown.length,0)).toBeLessThanOrEqual(100000);
});
it('ranks a relevant record title with Korean particles above a long generic body',async()=>{
 await setup([{markdown:general}]);const exact=await record('CHECK-2044-002','검증계획 실행 결과','# Synthetic record\nExecution is pending.\n'+'Synthetic detail. '.repeat(100));provider();
 const result=await answerQuestion(env.bindings,await env.select('reader'),'검증계획의 실행 상태와 결과를 알려주세요.');expect(result.grounding.sources[0].revisionId).toBe(exact.revisionId);
});
it('sends original line numbers and record approval limits once without including a draft',async()=>{
 await setup();const markdown='# CASE-2044-008\nUNIQUE_UNFINISHED_SOURCE_SENTENCE\nVerification remains planned.\n';const exact=await record('CASE-2044-008','Synthetic plan',markdown);const draft=await record('DRAFT-2044-001','Unapproved draft','# DRAFT_ONLY_SENTINEL','draft');const captured=provider();
 const result=await answerQuestion(env.bindings,await env.select('reader'),'CASE-2044-008의 상태를 알려주세요.');const {prompt}=captured(),source=prompt.grounding.sources.find((s:any)=>s.revisionId===exact.revisionId);
 expect(source).toMatchObject({code:'CASE-2044-008',title:'Synthetic plan',kind:'record',appConfirmed:{record:{state:'approved',approvalScope:'record',conditions:{requiredControlsVerified:false},approvalLimitations:'실행·효과성 검증·종결을 승인하지 않습니다.'},confirmedFacts:{implementerIds:['author']}}});expect(source.record).toBeUndefined();expect(source.confirmedFacts).toBeUndefined();expect(source.text).not.toContain('실행·효과성 검증·종결을 승인하지 않습니다.');
 expect(source.text).toContain('L2: UNIQUE_UNFINISHED_SOURCE_SENTENCE');expect(JSON.stringify(prompt).match(/UNIQUE_UNFINISHED_SOURCE_SENTENCE/g)).toHaveLength(1);expect(source.markdown).toBeUndefined();expect(source.evidenceRefs).toBeUndefined();
 expect(JSON.stringify(prompt)).not.toContain('DRAFT_ONLY_SENTINEL');expect(result.grounding.excluded).toContainEqual({revisionId:draft.revisionId,reason:'UNAPPROVED_WORKING_REVISION'});expect(result.grounding.sources.find(s=>s.revisionId===exact.revisionId)?.markdown).toBe(markdown);
 // Query-wide exclusions remain API diagnostics, not evidence about a selected document.
 expect(prompt.grounding.excluded).toBeUndefined();expect(prompt.computed.excluded).toBeUndefined();expect(prompt.computed.unknown).toBeUndefined();expect(Array.isArray(result.computed.excluded)).toBe(true);expect(Array.isArray(result.computed.unknown)).toBe(true);
});
it('includes a verified release index and excludes it when its stored bytes change',async()=>{
 const markdown='# Synthetic index\n| Parent | Child |\n| MAN-01 | PROC-07 |\n';await setup([{artifactId:'index-artifact',revisionId:'index-revision',code:'INDEX-01',title:'Synthetic index',kind:'index',path:'synthetic/index.md',markdown}]);const context=await getKnowledgeContext(env.bindings);
 const good=await selectGrounding(env.bindings,context);expect(good.sources).toContainEqual(expect.objectContaining({revisionId:'index-revision',kind:'index',code:'INDEX-01',markdown}));
 await env.bindings.SOURCES.put(`sources/index-revision/${await sha256(markdown)}.md`,'Changed index');const changed=await selectGrounding(env.bindings,context);expect(changed.sources.some(s=>s.revisionId==='index-revision')).toBe(false);expect(changed.excluded).toContainEqual({revisionId:'index-revision',reason:'SOURCE_CHANGED'});
});
it('keeps an unselected approved record out of the model prompt while preserving the API graph',async()=>{
 await setup();const selected=await record('CASE-2044-009','Requested record','# CASE-2044-009\nPending.');const unrelated=await record('OTHER-2044-001','UNSELECTED_APPROVED_LABEL','# Unrelated\n'+'Unrelated details. '.repeat(6000));const captured=provider();
 const result=await answerQuestion(env.bindings,await env.select('reader'),'CASE-2044-009의 상태는?');expect(result.grounding.sources.some(s=>s.revisionId===selected.revisionId)).toBe(true);expect(result.computed.entities.some(e=>e.id===unrelated.revisionId)).toBe(true);
 const {prompt}=captured();expect(JSON.stringify(prompt)).not.toContain('UNSELECTED_APPROVED_LABEL');expect(JSON.stringify(prompt)).not.toContain(unrelated.revisionId);expect(prompt.computed.entities.every((e:any)=>e.metadata===undefined)).toBe(true);expect(JSON.stringify(prompt).length).toBeLessThan(JSON.stringify(result.computed).length+JSON.stringify(result.grounding).length);
});
it('prioritizes an explicit impact target and preserves the exact calculated set and paths',async()=>{
 await setup([{markdown:general}]);const captured=provider();const result=await answerQuestion(env.bindings,await env.select('reader'),'실제 조치 문서 승인 상태와 결과를 알려주세요.','test-reg-rev');
 expect(result.grounding.sources[0].revisionId).toBe('test-reg-rev');const {prompt}=captured();expect(prompt.computed.impactSet).toEqual(result.impactSet);expect(prompt.computed.paths).toEqual(result.computed.paths);expect(prompt.computed.engine).toEqual(result.computed.engine);expect(prompt.computed.targetIds).toEqual(['test-reg-rev']);expect(result.disclaimer).toContain('초안');
});
it('uses actual body relevance before record kind when titles match equally',async()=>{
 await setup([{artifactId:'manual-artifact',revisionId:'manual-revision',code:'MAN-2044-01',title:'자료 체계',kind:'manual',markdown:'# 자료 체계\n일정과 변동을 설명한 직접 근거.\n'}]);await record('REC-2044-011','자료 기록','# 자료\nUnrelated content.');provider();
 const result=await answerQuestion(env.bindings,await env.select('reader'),'자료의 일정과 변동은?');expect(result.grounding.sources[0].revisionId).toBe('manual-revision');
});
it('resolves short source citations and validated direct revision citations without altering the graph',async()=>{
 await setup();const exact=await record('CASE-2044-010','Synthetic source','# CASE-2044-010\nNot completed.\nVerification is planned.');const captured=provider(()=>`Pending [S1:L2-L3]. Confirmed wording [${exact.revisionId}:L2].`);
 const result=await answerQuestion(env.bindings,await env.select('reader'),'CASE-2044-010은 완료됐는가?');expect(result.answer).toBe(`Pending [${exact.revisionId}:L2-L3]. Confirmed wording [${exact.revisionId}:L2].`);expect(captured().prompt.grounding.sources[0].sourceId).toBe('S1');expect(captured().temperature).toBe(0);expect(result.computed.engine.name).toBe('PyreWire');
});
it.each([
 ['unknown alias','[S999:L1-L2]'],
 ['unknown revision','[ffffffff-ffff-4fff-8fff-ffffffffffff:L1]'],
 ['out of range','[S1:L2-L99999]'],
 ['reversed range','[S1:L3-L2]'],
 ['zero line','[S1:L0-L1]'],
 ['unresolved alias syntax','[S1:L1, L3]'],
 ['unscoped lines','[L2-L3]'],
])('rejects %s citations while preserving calculated evidence',async(_name,citation)=>{
 await setup();const exact=await record('CASE-2044-012','Synthetic source','# CASE-2044-012\nNot completed.\nVerification is planned.');provider(()=>`Claim ${citation}`);const before=await getKnowledgeContext(env.bindings);
 await expect(answerQuestion(env.bindings,await env.select('reader'),'CASE-2044-012은 완료됐는가?')).rejects.toMatchObject({status:502,code:'LLM_UNAVAILABLE',details:{computed:{engine:{name:'PyreWire'}},grounding:{sources:expect.arrayContaining([expect.objectContaining({revisionId:exact.revisionId,record:{state:'approved',approvalScope:'record',conditions:{requiredControlsVerified:false},approvalLabel:'계획 내용 승인',approvalLimitations:'실행·효과성 검증·종결을 승인하지 않습니다.'}})])},context:before}});expect(await getKnowledgeContext(env.bindings)).toEqual(before);
});

it('reserves verified hierarchy evidence before generic text consumes the source budget',async()=>{
 const indexText='# Document directory\nChild procedure is under parent manual.\n'+'Directory detail. '.repeat(300);
 const filler='# General document\nPROJECT-PLAN is discussed. '+ 'General filler. '.repeat(6000);
 await setup([
  {artifactId:'manual-directory',revisionId:'manual-directory-rev',code:'DIRECTORY-2044',title:'Document directory',kind:'manual',markdown:indexText},
  {artifactId:'filler',revisionId:'filler-rev',code:'FILLER',title:'General document',kind:'procedure',markdown:filler},
 ],bundle=>{const source=bundle.sources.find(s=>s.revisionId==='manual-directory-rev')!;bundle.relations.push({id:'hierarchy-proof',subjectId:'test-reg-rev',objectId:'manual-directory-rev',type:'subordinate_to',origin:'regulation',reviewStatus:'validated',releaseId:bundle.manifest.releaseId,evidenceRefs:[{revisionId:source.revisionId,sourceSha256:source.sha256,lineStart:2,lineEnd:2,quote:indexText.split('\n')[1]}]});});
 provider();const result=await answerQuestion(env.bindings,await env.select('reader'),'TEST-PROC PROJECT-PLAN의 관계는?');
 expect(result.grounding.sources[0].revisionId).toBe('test-reg-rev');expect(result.grounding.sources.some(s=>s.revisionId==='manual-directory-rev')).toBe(true);expect(result.grounding.sources.some(s=>s.revisionId==='filler-rev')).toBe(false);expect(result.grounding.sources.reduce((n,s)=>n+s.markdown.length,0)).toBeLessThanOrEqual(100000);
});
it.each(['candidate','changed','wrong quote','condition unknown','condition status only','condition not met only','references'] as const)('does not prioritize %s hierarchy evidence',async(mode)=>{
 const indexText='# Directory\nChild procedure is under parent manual.\n'+'Directory detail. '.repeat(300);const filler='# General document\nPROJECT-PLAN is discussed. '+'General filler. '.repeat(6000);
 await setup([{artifactId:'manual-directory',revisionId:'manual-directory-rev',code:'DIRECTORY-2044',title:'Document directory',kind:'manual',markdown:indexText},{artifactId:'filler',revisionId:'filler-rev',code:'FILLER',title:'General document',kind:'procedure',markdown:filler}],bundle=>{const source=bundle.sources.find(s=>s.revisionId==='manual-directory-rev')!;bundle.relations.push({id:'unsafe-hierarchy-proof',subjectId:'test-reg-rev',objectId:'manual-directory-rev',type:mode==='references'?'references':'subordinate_to',origin:'regulation',reviewStatus:mode==='candidate'?'candidate':'validated',...(mode==='changed'?{evidenceStatus:'changed' as const}:{}),...(mode==='condition unknown'?{condition:'unconfirmed',conditionStatus:'unknown' as const}:{}),...(mode==='condition status only'?{conditionStatus:'unknown' as const}:{}),...(mode==='condition not met only'?{conditionStatus:'not_met' as const}:{}),releaseId:bundle.manifest.releaseId,evidenceRefs:[{revisionId:source.revisionId,sourceSha256:source.sha256,lineStart:2,lineEnd:2,quote:mode==='wrong quote'?'Wrong assertion':indexText.split('\n')[1]}]});});
 const captured=provider();const result=await answerQuestion(env.bindings,await env.select('reader'),'TEST-PROC PROJECT-PLAN의 관계는?');expect(result.grounding.sources.some(s=>s.revisionId==='filler-rev')).toBe(true);expect(result.grounding.sources.some(s=>s.revisionId==='manual-directory-rev')).toBe(false);expect(captured().prompt.directHierarchy).toEqual([]);
});

it('supplies query time and separates future schedules from completed source facts',async()=>{
 await setup();const captured=provider();const before=Date.now();await answerQuestion(env.bindings,await env.select('reader'),'As of 2044-01-10, was verification scheduled for 2044-02-10 completed?');const after=Date.now(),{prompt,messages}=captured();
 expect(Date.parse(prompt.queriedAt)).toBeGreaterThanOrEqual(before);expect(Date.parse(prompt.queriedAt)).toBeLessThanOrEqual(after);expect(prompt.queriedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
 const instructions=JSON.stringify(messages)+JSON.stringify(prompt.responseRequirements);expect(instructions).toContain('질문 기준일');expect(instructions).toContain('지나간 예정일');expect(instructions).toContain('앱확인값');expect(instructions).toContain('원문 L줄');expect(messages[0].content).toContain('앱확인값');expect(messages[0].content).toContain('원문 L줄');
});
it('supplies direct hierarchy beyond the first graph page with parent identity distinct from its evidence source',async()=>{
 const directory='# Directory\nTEST-PROC is under PARENT-MANUAL.\n';const parent='# Parent requirements\nPARENT_BODY_NOT_SELECTED\n'+'Unselected text. '.repeat(7000);
 await setup([{artifactId:'parent-manual',revisionId:'parent-manual-rev',code:'PARENT-MANUAL',title:'Parent requirements',kind:'manual',markdown:parent},{artifactId:'proof-index',revisionId:'proof-index-rev',code:'PROOF-INDEX',title:'Directory evidence, not the parent document',kind:'index',markdown:directory}],bundle=>{
  const evidenceSource=bundle.sources.find(source=>source.revisionId==='proof-index-rev')!;const source=bundle.sources.find(source=>source.revisionId==='test-reg-rev')!;
  bundle.entities.find(entity=>entity.id==='parent-manual-rev')!.metadata!.privateParentMetadata='NOT_FOR_PROMPT';
  for(let i=0;i<205;i++)bundle.relations.push({id:`0000-page-${String(i).padStart(3,'0')}`,subjectId:'test-reg-rev',objectId:'test-tpl-rev-1',type:'references',origin:'reference_extraction',releaseId:bundle.manifest.releaseId,reviewStatus:'validated',evidenceRefs:[{revisionId:source.revisionId,sourceSha256:source.sha256,lineStart:1,lineEnd:1,quote:source.markdown.split('\n')[0]}]});
  bundle.relations.push({id:'zzzz-direct-hierarchy',condition:'confirmed',conditionStatus:'met',subjectId:'test-reg-rev',objectId:'parent-manual-rev',type:'subordinate_to',origin:'regulation',releaseId:bundle.manifest.releaseId,reviewStatus:'validated',evidenceRefs:[{revisionId:evidenceSource.revisionId,sourceSha256:evidenceSource.sha256,lineStart:2,lineEnd:2,quote:directory.split('\n')[1]}]});
 });
 const captured=provider();const result=await answerQuestion(env.bindings,await env.select('reader'),'TEST-PROC의 상위 문서와 목차 근거는?');const {prompt}=captured(),proof=prompt.grounding.sources.find((source:any)=>source.revisionId==='proof-index-rev');
 expect(result.computed.cursor).toBeTruthy();expect(result.computed.relations).toHaveLength(200);expect(result.computed.relations.some(relation=>relation.id==='zzzz-direct-hierarchy')).toBe(false);
 expect(result.grounding.sources.some(source=>source.revisionId==='parent-manual-rev')).toBe(false);expect(prompt.directHierarchy).toEqual([{id:'zzzz-direct-hierarchy',type:'subordinate_to',child:{revisionId:'test-reg-rev',artifactId:'test-reg',code:'TEST-PROC',title:'시험 절차'},parent:{revisionId:'parent-manual-rev',artifactId:'parent-manual',code:'PARENT-MANUAL',title:'Parent requirements'},evidenceRefs:[{sourceId:proof.sourceId,revisionId:'proof-index-rev',sourceSha256:await sha256(directory),lineStart:2,lineEnd:2}]}]);
 expect(JSON.stringify(prompt)).not.toContain('PARENT_BODY_NOT_SELECTED');expect(JSON.stringify(prompt)).not.toContain('NOT_FOR_PROMPT');expect(prompt.computed.operation).toBe('neighbors');expect(prompt.computed).not.toHaveProperty('impactSet');expect(result.computed).not.toHaveProperty('impactSet');expect(prompt.computed.totalComputedRelations).toBe(result.computed.totalRelations);
});
