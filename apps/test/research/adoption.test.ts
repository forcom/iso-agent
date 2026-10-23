import {afterEach,describe,expect,it} from 'vitest';
import {createTestEnvironment,type TestEnvironment} from '../support/environment';
import {requestResearch,researchDefinition} from './fixture';
import {reserveResearchJob,beginResearchJob,finishResearchAttempt} from '../../worker/src/research/runner';
import {getKnowledgeContext} from '../../worker/src/lib/storage';
import {registerRecord} from '../../worker/src/lib/artifacts';
import {sha256} from '../../worker/src/lib/markdown';
let t:TestEnvironment;
afterEach(async()=>{await t?.cleanup()});
async function proposal(){
 t=await createTestEnvironment();const actor=await t.select('author');
 await t.bindings.DB.prepare("UPDATE research_connection SET version=2,body=json_set(body,'$.version',2,'$.state','ready') WHERE id='company-dots'").run();
 await requestResearch(t,actor,'/research/jobs',{definition:researchDefinition});
 const a=(await reserveResearchJob(t.bindings))!;await beginResearchJob(t.bindings,a.id);
 await finishResearchAttempt(t.bindings,a.id,{kind:'result',result:{coverage:'complete',summary:'합성 제안',findings:[],sources:[],internalEvidence:[],drafts:[{recordTypeId:'test-F01',templateRevisionId:'test-tpl-rev-1',title:'합성 초안',markdown:'# 제안\n수행 미확인'}],actions:[],questions:['사내 확인 필요'],checkedScope:'합성 내부 검토 방법 초안',failedSources:[]}});
 const id=await t.bindings.DB.prepare('SELECT id FROM research_proposals').first<string>('id');
 const input={file:new TextEncoder().encode('# 사람이 보완한 기록\n내부 검토 예정\n'),filename:'reviewed.md',documentCode:'SYNTHETIC-ADOPT',title:'합성 기록',recordTypeIds:['test-F01'],templateRevisionIds:['test-tpl-rev-1'],scope:'',requestKey:'adopt-once',expectedContext:await getKnowledgeContext(t.bindings),researchProposalId:id!};
 return {actor,input,id:id!};
}
describe('human adoption of research proposals',()=>{
 it('links the actual edited upload atomically while preserving ordinary approval rules',async()=>{
  const {actor,input,id}=await proposal();const record=await registerRecord(t.bindings,actor,input);
  expect(record.status).toBe('draft');
  const saved=JSON.parse((await t.bindings.DB.prepare('SELECT body FROM research_adoptions WHERE id=?').bind(id).first('body')) as string);
  expect(saved.revisionId).toBe(record.revisionId);expect(saved.actorId).toBe('author');
  expect(saved.uploadSha256).toBe(await sha256(input.file));expect(saved.uploadSha256).not.toBe(saved.proposalSha256);
  expect(await registerRecord(t.bindings,actor,input)).toEqual(record);
  await expect(registerRecord(t.bindings,actor,{...input,requestKey:'second',documentCode:'SYNTHETIC-SECOND'})).rejects.toMatchObject({status:409});
 });
 it('denies read-only adoption and leaves no adoption when record registration fails',async()=>{
  const {input}=await proposal();
  await expect(registerRecord(t.bindings,await t.select('reader'),input)).rejects.toMatchObject({status:403});
  expect(await t.bindings.DB.prepare('SELECT COUNT(*) n FROM research_adoptions').first('n')).toBe(0);
  await t.bindings.DB.prepare("CREATE TRIGGER synthetic_reject_record BEFORE INSERT ON revisions WHEN json_extract(NEW.body,'$.filename')='reviewed.md' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END").run();
  await expect(registerRecord(t.bindings,await t.select('author'),input)).rejects.toThrow();
  expect(await t.bindings.DB.prepare('SELECT COUNT(*) n FROM research_adoptions').first('n')).toBe(0);
 });
 it('rejects changed authority and ignores a forged proposal ID written only in Markdown',async()=>{
  const {actor,input}=await proposal();await t.bindings.DB.prepare('UPDATE context SET authority_revision=1 WHERE id=1').run();
  await expect(registerRecord(t.bindings,actor,{...input,expectedContext:await getKnowledgeContext(t.bindings)})).rejects.toMatchObject({status:409});
  const {researchProposalId,...normal}=input;
  const result=await registerRecord(t.bindings,actor,{...normal,expectedContext:await getKnowledgeContext(t.bindings),requestKey:'normal',file:new TextEncoder().encode(`# 일반 기록\nresearchProposalId: ${researchProposalId}`)});
  expect(result.status).toBe('draft');expect(await t.bindings.DB.prepare('SELECT COUNT(*) n FROM research_adoptions').first('n')).toBe(0);
 });
});
