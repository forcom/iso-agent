import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTestEnvironment } from '../support/environment';
import { startTestEngine } from '../support/engine';
import { getKnowledgeContext } from '../../worker/src/lib/storage';
import { parseMarkdown } from '../../worker/src/lib/markdown';
import type { Artifact, Revision } from '../../worker/src/types';
import * as api from '../../worker/src/lib/assignments';
import {resolveActor} from '../../worker/src/routes/session';
import type { AssignmentApplyInput } from '../../packages/contracts/src/index';
import {canonical,sha256} from '../../packages/knowledge/src/index';

let stopEngine: () => Promise<void>;
const cleanups: Array<() => Promise<void>> = [];
beforeAll(async () => { stopEngine = await startTestEngine(); });
afterAll(async () => { await stopEngine?.(); });
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function appointment(row='reader | approver | 2026-01-01T00:00:00Z | 2027-01-01T00:00:00Z | all | |', extraColumns:string[]=[]) {
 const env = await createTestEnvironment();cleanups.push(env.cleanup);
 env.bundle.recordTypes.find(type=>type.id==='test-F01')!.roleAssignment = true;
 const policy=env.bundle.policies.find(p=>p.resourceTypeId==='test-F01'&&p.action==='apply_assignment')!;
 Object.assign(policy,{roleId:'administrator',origin:'product_policy',productPolicyId:'synthetic-admin-application',adminRequired:true,evidenceRefs:[],stateCondition:['approved']});
 env.bundle.productPolicies.push({id:'synthetic-admin-application',title:'Synthetic application',origin:'product_policy',sourceUrl:'https://example.invalid/synthetic',decision:'Synthetic administrator application of already approved appointment',conflicts:[]});
 env.bundle.manifest.manifestHash='';env.bundle.manifest.manifestHash=await sha256(canonical(env.bundle));
 await env.bindings.SOURCES.put('releases/test-release.json',JSON.stringify(env.bundle));
 await env.bindings.DB.prepare('UPDATE releases SET body=? WHERE id=?').bind(JSON.stringify(env.bundle.manifest),env.bundle.manifest.releaseId).run();
 const markdown=`# Synthetic approved appointment\n\n| personId | roleId | validFrom | validUntil | scopeKind | scopeIds | delegatedFromAssignmentId ${extraColumns.map(column=>'| '+column+' ').join('')}|\n| --- | --- | --- | --- | --- | --- | --- ${extraColumns.map(()=>'| --- ').join('')}|\n| ${row}\n`;
 const parsed=await parseMarkdown('synthetic.md',new TextEncoder().encode(markdown));
 const artifact:Artifact={id:'appointment',documentCode:'SYNTHETIC-APPOINTMENT',kind:'record',title:'Synthetic appointment',recordTypeIds:['test-F01'],workingRevisionId:'appointment-v1',effectiveRevisionId:'appointment-v1',systemIds:[]};
 const revision:Revision={id:'appointment-v1',artifactId:artifact.id,filename:'synthetic.md',sourceSha256:parsed.sha256,textSha256:parsed.textSha256,objectKey:'sources/appointment-v1.md',textKey:'text/appointment-v1.txt',state:'approved',createdAt:'2026-01-01',createdBy:'author',previousRevisionId:null,templateRevisionIds:['test-tpl-rev-1'],systemIds:[],conditions:{},fieldMappings:{},evidenceStatus:'verified',approvedBy:['approver']};
 await env.bindings.SOURCES.put(revision.objectKey,markdown);await env.bindings.SOURCES.put(revision.textKey,markdown);
 await env.bindings.DB.prepare('INSERT INTO artifacts VALUES(?,?,?,?)').bind(artifact.id,artifact.documentCode,artifact.kind,JSON.stringify(artifact)).run();
 await env.bindings.DB.prepare('INSERT INTO revisions VALUES(?,?,?)').bind(revision.id,artifact.id,JSON.stringify(revision)).run();
 await env.bindings.DB.prepare('INSERT INTO decisions VALUES(?,?,?)').bind('appointment-approval',revision.id,JSON.stringify({id:'appointment-approval',revisionId:revision.id,decision:'approve',sourceSha256:revision.sourceSha256,actorId:'approver'})).run();
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
