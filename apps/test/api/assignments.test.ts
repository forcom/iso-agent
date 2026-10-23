import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTestEnvironment } from '../support/environment';
import { startTestEngine } from '../support/engine';
import {loadFixture} from '../support/fixtures';
import { getKnowledgeContext } from '../../worker/src/lib/storage';
import {installAppointment} from '../support/appointment';
import * as api from '../../worker/src/lib/assignments';
import {resolveActor} from '../../worker/src/routes/session';
import type { AssignmentApplyInput } from '../../packages/contracts/src/index';

let stopEngine: () => Promise<void>;
const cleanups: Array<() => Promise<void>> = [];
beforeAll(async () => { stopEngine = await startTestEngine(); });
afterAll(async () => { await stopEngine?.(); });
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function appointment(row='reader | approver | 2026-01-01T00:00:00Z | 2027-01-01T00:00:00Z | all | |', extraColumns:string[]=[], source?:string) {
 const env = await createTestEnvironment();cleanups.push(env.cleanup);
 const markdown=source??`# Synthetic approved appointment\n\n| personId | roleId | validFrom | validUntil | scopeKind | scopeIds | delegatedFromAssignmentId ${extraColumns.map(column=>'| '+column+' ').join('')}|\n| --- | --- | --- | --- | --- | --- | --- ${extraColumns.map(()=>'| --- ').join('')}|\n| ${row}\n`;
 const {artifact,revision}=await installAppointment(env,markdown);
 return { ...env, artifact, revision, actor:await env.select('admin'),context:await getKnowledgeContext(env.bindings) };
}

describe('approved role appointment application',()=>{
 it('keeps extracted candidates inactive until an old-authority administrator applies exact rows',async()=>{
  const env=await appointment();
  const view=await api.listRoleAssignments(env.bindings,env.actor);
  const candidates=view.candidates.find(c=>c.revisionId===env.revision.id)!.assignments;
  expect(candidates).toHaveLength(1);expect(candidates[0].evidenceRefs[0]).toMatchObject({revisionId:env.revision.id,lineStart:5,lineEnd:5});
  expect(await env.bindings.DB.prepare("SELECT COUNT(*) AS n FROM assignments WHERE json_extract(body,'$.personId')='reader'").first('n')).toBe(0);
  const input:AssignmentApplyInput={revisionId:env.revision.id,assignments:candidates,requestKey:'apply-1',expectedContext:env.context};
  const result=await api.applyRoleAssignment(env.bindings,env.actor,input);
  expect(result.assignmentIds).toEqual([candidates[0].id]);expect(result.context.authorityRevision).toBe(env.context.authorityRevision+1);
  expect(await api.applyRoleAssignment(env.bindings,env.actor,input)).toEqual(result);
  expect(await env.bindings.DB.prepare("SELECT COUNT(*) AS n FROM assignments WHERE json_extract(body,'$.personId')='reader'").first('n')).toBe(1);
 });
 it('refuses applicant-controlled changes and unapproved sources without partial writes',async()=>{
  const env=await appointment();
  const view=await api.listRoleAssignments(env.bindings,env.actor),candidates=view.candidates[0].assignments;
  const input={revisionId:env.revision.id,assignments:[{...candidates[0],roleId:'director'}],requestKey:'tamper',expectedContext:env.context};
  await expect(api.applyRoleAssignment(env.bindings,env.actor,input)).rejects.toMatchObject({status:422});
  expect(await getKnowledgeContext(env.bindings)).toEqual(env.context);
  await env.bindings.DB.prepare('UPDATE revisions SET body=? WHERE id=?').bind(JSON.stringify({...env.revision,state:'draft'}),env.revision.id).run();
  await expect(api.applyRoleAssignment(env.bindings,env.actor,{...input,assignments:candidates})).rejects.toMatchObject({status:409});
 });
 it('does not use proposed new authority to authorize its own application',async()=>{
  const env=await appointment('reader | director | 2026-01-01T00:00:00Z | | all | |');
  const view=await api.listRoleAssignments(env.bindings,env.actor);
  const reader=await env.select('reader');
  await expect(api.applyRoleAssignment(env.bindings,reader,{revisionId:env.revision.id,assignments:view.candidates[0].assignments,requestKey:'self-grant',expectedContext:env.context})).rejects.toMatchObject({status:403});
 });
 it('refuses unknown people, invalid periods and broadened delegation scope',async()=>{

  for(const row of ['not-an-employee | approver | 2026-01-01T00:00:00Z | | all | |',
                   'reader | approver | 2026-02-30T00:00:00Z | | all | |',
                   'reader | approver | 2028-01-01T00:00:00Z | 2027-01-01T00:00:00Z | all | |']){
   const env=await appointment(row),view=await api.listRoleAssignments(env.bindings,env.actor);
   expect(view.candidates[0].error).toBeTruthy();expect(view.candidates[0].assignments).toEqual([]);
  }
  const env=await appointment('reader | approver | 2026-01-01T00:00:00Z | 2027-01-01T00:00:00Z | all | | test-assignment-approver |');
  const parent=JSON.parse((await env.bindings.DB.prepare("SELECT body FROM assignments WHERE id='test-assignment-approver'").first<{body:string}>())!.body);
  parent.scope={kind:'resource',ids:['appointment']};
  await env.bindings.DB.prepare('UPDATE assignments SET body=? WHERE id=?').bind(JSON.stringify(parent),parent.id).run();
  const view=await api.listRoleAssignments(env.bindings,env.actor);expect(view.candidates[0].error).toBeTruthy();
 });
 it('rejects cyclic or unverified delegation ancestry',async()=>{
  for(const mutation of ['cycle','missing-source']){
   const env=await appointment('reader | approver | 2026-01-01T00:00:00Z | 2027-01-01T00:00:00Z | all | | test-assignment-approver |');
   const parent=JSON.parse((await env.bindings.DB.prepare("SELECT body FROM assignments WHERE id='test-assignment-approver'").first<{body:string}>())!.body);
   if(mutation==='cycle')parent.delegatedFromAssignmentId=parent.id;
   else parent.approvedRevisionId='missing-designation';
   await env.bindings.DB.prepare('UPDATE assignments SET body=? WHERE id=?').bind(JSON.stringify(parent),parent.id).run();
   const view=await api.listRoleAssignments(env.bindings,env.actor);expect(view.candidates[0].error).toBeTruthy();
  }
 });
 it('engine outage leaves assignments and authority generation unchanged',async()=>{
  const env=await appointment(),view=await api.listRoleAssignments(env.bindings,env.actor);
  env.bindings.ENGINE_URL='http://127.0.0.1:1';
  await expect(api.applyRoleAssignment(env.bindings,env.actor,{revisionId:env.revision.id,assignments:view.candidates[0].assignments,requestKey:'engine-down',expectedContext:env.context})).rejects.toMatchObject({status:503});
  expect(await getKnowledgeContext(env.bindings)).toEqual(env.context);
  expect(await env.bindings.DB.prepare('SELECT COUNT(*) AS n FROM events').first('n')).toBe(0);
 });
 it('explicit replacement revokes prior scope and applies an approved admin designation',async()=>{
  const env=await appointment('reader | approver | 2026-01-01T00:00:00Z | 2027-01-01T00:00:00Z | all | | | active | old-reader | true |',['status','replacesAssignmentId','grantsAdmin']);
  const base=JSON.parse((await env.bindings.DB.prepare("SELECT body FROM assignments WHERE id='test-assignment-approver'").first<{body:string}>())!.body);
  await env.bindings.DB.prepare('INSERT INTO assignments VALUES(?,?)').bind('old-reader',JSON.stringify({...base,id:'old-reader',personId:'reader'})).run();
  const view=await api.listRoleAssignments(env.bindings,env.actor);expect(view.candidates[0].error).toBeUndefined();
  const result=await api.applyRoleAssignment(env.bindings,env.actor,{revisionId:env.revision.id,assignments:view.candidates[0].assignments,requestKey:'replace',expectedContext:env.context});
  const old=JSON.parse((await env.bindings.DB.prepare("SELECT body FROM assignments WHERE id='old-reader'").first<{body:string}>())!.body);
  const person=JSON.parse((await env.bindings.DB.prepare("SELECT body FROM persons WHERE id='reader'").first<{body:string}>())!.body);
  expect(old.status).toBe('revoked');expect(person.isAdmin).toBe(true);expect(person.adminAssignmentId).toBe(result.assignmentIds[0]);
  const selected=await env.select('reader');expect((await resolveActor(env.bindings,selected.sessionId)).isAdmin).toBe(true);
  await env.bindings.DB.prepare("UPDATE assignments SET body=json_set(body,'$.validUntil','2026-06-01T00:00:00Z') WHERE id=?").bind(result.assignmentIds[0]).run();
  expect((await resolveActor(env.bindings,selected.sessionId)).isAdmin).toBe(false);
 });
 it('explicit revocation removes existing assignment and administrator qualification',async()=>{
  const env=await appointment('reader | approver | 2026-01-01T00:00:00Z | 2027-01-01T00:00:00Z | all | | | revoked | old-reader | false |',['status','replacesAssignmentId','grantsAdmin']);
  const base=JSON.parse((await env.bindings.DB.prepare("SELECT body FROM assignments WHERE id='test-assignment-approver'").first<{body:string}>())!.body);
  await env.bindings.DB.prepare('INSERT INTO assignments VALUES(?,?)').bind('old-reader',JSON.stringify({...base,id:'old-reader',personId:'reader',grantsAdmin:true})).run();
  await env.bindings.DB.prepare("UPDATE persons SET body=json_set(body,'$.isAdmin',json('true'),'$.adminAssignmentId','old-reader') WHERE id='reader'").run();
  const view=await api.listRoleAssignments(env.bindings,env.actor);expect(view.candidates[0].error).toBeUndefined();
  await api.applyRoleAssignment(env.bindings,env.actor,{revisionId:env.revision.id,assignments:view.candidates[0].assignments,requestKey:'revoke',expectedContext:env.context});
  const old=JSON.parse((await env.bindings.DB.prepare("SELECT body FROM assignments WHERE id='old-reader'").first<{body:string}>())!.body);
  const person=JSON.parse((await env.bindings.DB.prepare("SELECT body FROM persons WHERE id='reader'").first<{body:string}>())!.body);
  expect(old.status).toBe('revoked');expect(person.isAdmin).toBe(false);
 });
 it('rejects stale authority context atomically',async()=>{
  const env=await appointment();
  const view=await api.listRoleAssignments(env.bindings,env.actor);
  await env.bindings.DB.prepare('UPDATE context SET authority_revision=authority_revision+1').run();
  await expect(api.applyRoleAssignment(env.bindings,env.actor,{revisionId:env.revision.id,assignments:view.candidates[0].assignments,requestKey:'stale',expectedContext:env.context})).rejects.toMatchObject({status:409});
  expect(await env.bindings.DB.prepare('SELECT COUNT(*) AS n FROM events').first('n')).toBe(0);
 });
});


describe('Korean appointment reconciliation',()=>{
 async function korean(){return appointment(undefined,[],await loadFixture('korean-appointment.md'))}
 const mapping=(candidateId:string)=>({candidateId,personId:'reader',roleIds:['approver'],validFrom:'2026-04-27T00:00:00+09:00',scope:{kind:'all' as const,ids:[]},reason:'원문의 검토·승인 업무를 합성 승인 역할과 대조함'});
 it('extracts source rows without granting roles and exposes blocked candidates',async()=>{
  const env=await korean(),view=await api.listRoleAssignments(env.bindings,env.actor);
  const source=view.candidates[0] as any;
  expect(source.error).toBeUndefined();expect(source.assignments).toEqual([]);
  expect(source.sourceCandidates).toHaveLength(4);
  const primary=source.sourceCandidates.find((c:any)=>c.sectionId==='R-01'&&c.kind==='appointment');
  expect([...primary.personIds].sort()).toEqual(['reader','reviewer']);
  expect(primary.personIds).not.toContain('director');
  expect(primary.evidenceRefs.map((r:any)=>r.quote).join('\n')).toContain('2026. 4. 27. 지정');
  expect(source.sourceCandidates.filter((c:any)=>c.blockedReason)).toHaveLength(3);
  expect(await env.bindings.DB.prepare("SELECT COUNT(*) AS n FROM assignments WHERE json_extract(body,'$.personId')='reader'").first('n')).toBe(0);
 });
 it('blocks an unspecified release date instead of creating indefinite authority',async()=>{
  const source=(await loadFixture('korean-appointment.md')).replace('해제일 없음','해제일 별도 통보');
  const env=await appointment(undefined,[],source),view=await api.listRoleAssignments(env.bindings,env.actor);
  expect((view.candidates[0] as any).sourceCandidates[0].blockedReason).toBeTruthy();
 });
 it('does not turn planned or conditional appointments into active authority or reporting names into holders',async()=>{
  const original=await loadFixture('korean-appointment.md');
  for(const source of [original.replace('2026. 4. 27. 지정 / 해제일 없음','2026. 4. 27. 예정 / 교육 완료 시 지정'),original.replace('전사 합성 기록의 검토·승인','교육 이수 후 전사 합성 기록의 검토·승인')]){
   const env=await appointment(undefined,[],source),view=await api.listRoleAssignments(env.bindings,env.actor);
   expect((view.candidates[0] as any).sourceCandidates[0].blockedReason).toBeTruthy();
  }
  const env=await appointment(undefined,[],original.replace('/ 팀장 시험 director','(보고 대상: 시험 director)'));
  const view=await api.listRoleAssignments(env.bindings,env.actor);
  expect((view.candidates[0] as any).sourceCandidates[0].personIds).not.toContain('director');
 });
 it('applies multiple roles with administrator mapping evidence and old authority',async()=>{
  const env=await korean(),view=await api.listRoleAssignments(env.bindings,env.actor);
  const candidate=(view.candidates[0] as any).sourceCandidates[0];
  const input:any={revisionId:env.revision.id,mappedAssignments:[{...mapping(candidate.id),roleIds:['approver','reviewer']}],requestKey:'mapped',expectedContext:env.context};
  const result=await api.applyRoleAssignment(env.bindings,env.actor,input);
  expect(result.assignmentIds).toHaveLength(2);expect(result.context.authorityRevision).toBe(env.context.authorityRevision+1);
  expect(await api.applyRoleAssignment(env.bindings,env.actor,input)).toEqual(result);
  const row=await env.bindings.DB.prepare('SELECT body FROM assignments WHERE id=?').bind(result.assignmentIds[0]).first<{body:string}>();
  expect(JSON.parse(row!.body).adminMapping).toMatchObject({actorId:'admin',reason:input.mappedAssignments[0].reason,candidateId:candidate.id});
  expect(JSON.parse(row!.body).grantsAdmin).toBeUndefined();
  expect(await env.bindings.DB.prepare("SELECT COUNT(*) AS n FROM events WHERE json_extract(body,'$.kind')='role_assignments_applied'").first('n')).toBe(1);
  await expect(api.applyRoleAssignment(env.bindings,env.actor,{...input,requestKey:'duplicate',expectedContext:result.context})).rejects.toMatchObject({status:409});
 });
 it('rejects changed names, dates, blocked delegation, admin flags and authority before writing',async()=>{
  const env=await korean(),view=await api.listRoleAssignments(env.bindings,env.actor),candidates=(view.candidates[0] as any).sourceCandidates;
  const input:any={revisionId:env.revision.id,mappedAssignments:[mapping(candidates[0].id)],requestKey:'invalid',expectedContext:env.context};
  for(const change of [{personId:'director'},{validFrom:'2026-04-28T00:00:00+09:00'},{validUntil:'2027-01-01T00:00:00+09:00'},{roleIds:['missing']},{reason:''},{grantsAdmin:true},{candidateId:candidates.find((c:any)=>c.kind==='delegation').id}]){
   await expect(api.applyRoleAssignment(env.bindings,env.actor,{...input,mappedAssignments:[{...input.mappedAssignments[0],...change}]})).rejects.toMatchObject({status:422});
  }
  await expect(api.applyRoleAssignment(env.bindings,await env.select('reader'),input)).rejects.toMatchObject({status:403});
  expect(await getKnowledgeContext(env.bindings)).toEqual(env.context);
  await env.bindings.DB.prepare('UPDATE revisions SET body=? WHERE id=?').bind(JSON.stringify({...env.revision,state:'draft'}),env.revision.id).run();
  await expect(api.applyRoleAssignment(env.bindings,env.actor,input)).rejects.toMatchObject({status:409});
 });
 it('requires explicit matching replacement for an already active person-role-scope',async()=>{
  const env=await korean(),view=await api.listRoleAssignments(env.bindings,env.actor),candidate=(view.candidates[0] as any).sourceCandidates[0];
  const mapped={...mapping(candidate.id),personId:'reviewer',roleIds:['reviewer']};
  const input:any={revisionId:env.revision.id,mappedAssignments:[mapped],requestKey:'replace-korean',expectedContext:env.context};
  await expect(api.applyRoleAssignment(env.bindings,env.actor,input)).rejects.toMatchObject({code:'ASSIGNMENT_DUPLICATE_ACTIVE'});
  const result=await api.applyRoleAssignment(env.bindings,env.actor,{...input,mappedAssignments:[{...mapped,replacesAssignmentIds:{reviewer:'test-assignment-reviewer'}}]});
  expect(result.assignmentIds).toHaveLength(1);
  expect(await env.bindings.DB.prepare("SELECT json_extract(body,'$.status') AS status FROM assignments WHERE id='test-assignment-reviewer'").first('status')).toBe('revoked');
 });
 it('blocks a release date on or before the appointment date and keeps escaped pipes inside a cell',async()=>{
  const original=await loadFixture('korean-appointment.md');
  let env=await appointment(undefined,[],original.replace('2026. 4. 27. 지정 / 해제일 없음','2026. 4. 27. 지정 / 2026. 4. 1. 해제'));
  expect(((await api.listRoleAssignments(env.bindings,env.actor)).candidates[0] as any).sourceCandidates[0].blockedReason).toMatch(/해제일/);
  env=await appointment(undefined,[],original.replace('전사 합성 기록의 검토·승인','전사 합성 기록의 검토\\|승인'));
  const candidate=((await api.listRoleAssignments(env.bindings,env.actor)).candidates[0] as any).sourceCandidates[0];
  expect(candidate.blockedReason).toBeUndefined();expect(candidate.scopeText).toBe('전사 합성 기록의 검토|승인');
  env=await appointment(undefined,[],original.replace('| 역할·담당 업무 | 검토와 승인 운영 |','| 역할·담당 업무 | 검토와 승인 운영 | 비고 |'));
  expect(((await api.listRoleAssignments(env.bindings,env.actor)).candidates[0] as any).sourceCandidates[0].blockedReason).toMatch(/두 열/);
 });
 it('keeps a sample section inside a code fence hidden even when an inner line carries an info string',async()=>{
  const sample='```\n```markdown\n### R-09 예시\n\n| 항목 | 기입 내용 |\n| --- | --- |\n| 역할·담당 업무 | 예시 |\n| 담당자·부서 | 시험 reader |\n| 위임·승인·접근 범위 | 예시 범위 |\n| 지정·해제일 | 2026. 4. 27. 지정 / 해제일 없음 |\n```\n';
  const env=await appointment(undefined,[],`${await loadFixture('korean-appointment.md')}\n${sample}`);
  expect(((await api.listRoleAssignments(env.bindings,env.actor)).candidates[0] as any).sourceCandidates.some((c:any)=>c.sectionId==='R-09')).toBe(false);
 });
 it('keeps Korean candidates usable when the same record has an invalid machine table',async()=>{
  const source=`${await loadFixture('korean-appointment.md')}\n\n| personId | roleId | validFrom | validUntil | scopeKind | scopeIds |\n| --- | --- | --- | --- | --- | --- |\n| missing | approver | 2026-01-01T00:00:00Z | 2027-01-01T00:00:00Z | all | |\n`;
  const env=await appointment(undefined,[],source),view=await api.listRoleAssignments(env.bindings,env.actor),listed=view.candidates[0] as any;
  expect(listed.error).toBeTruthy();expect(listed.sourceCandidates).toHaveLength(4);
  await expect(api.applyRoleAssignment(env.bindings,env.actor,{revisionId:env.revision.id,assignments:[{id:'any'} as any],requestKey:'machine',expectedContext:env.context})).rejects.toMatchObject({code:'UNKNOWN_ASSIGNMENT_PERSON'});
  const primary=listed.sourceCandidates.find((c:any)=>c.sectionId==='R-01'&&c.kind==='appointment');
  expect((await api.applyRoleAssignment(env.bindings,env.actor,{revisionId:env.revision.id,mappedAssignments:[mapping(primary.id)],requestKey:'mapped-beside-machine',expectedContext:env.context})).assignmentIds).toHaveLength(1);
 });
 it('re-applies a mapping by a new request after its earlier assignment was revoked',async()=>{
  const env=await korean(),candidate=((await api.listRoleAssignments(env.bindings,env.actor)).candidates[0] as any).sourceCandidates[0];
  const input:any={revisionId:env.revision.id,mappedAssignments:[mapping(candidate.id)],requestKey:'first',expectedContext:env.context};
  const first=await api.applyRoleAssignment(env.bindings,env.actor,input);
  await env.bindings.DB.prepare("UPDATE assignments SET body=json_set(body,'$.status','revoked') WHERE id=?").bind(first.assignmentIds[0]).run();
  const second=await api.applyRoleAssignment(env.bindings,env.actor,{...input,requestKey:'second',expectedContext:first.context});
  expect(second.assignmentIds[0]).not.toBe(first.assignmentIds[0]);
 });
});
