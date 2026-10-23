import {afterEach,expect,it} from 'vitest';
import {createTestEnvironment,type TestEnvironment} from '../support/environment';
import {installAppointment} from '../support/appointment';
import {loadFixture} from '../support/fixtures';
import {applyRoleAssignment,listRoleAssignments} from '../../worker/src/lib/assignments';
import {administratorAssignmentEligible} from '../../worker/src/routes/session';
import {getKnowledgeContext} from '../../worker/src/lib/storage';
import {validateDeploymentPreparation} from '../../packages/knowledge/src/index';
import type {RoleAssignment} from '../../packages/contracts/src/index';

let env:TestEnvironment|undefined;afterEach(async()=>{await env?.cleanup();env=undefined;});
const parent:RoleAssignment={id:'parent',personId:'principal',roleId:'approver',scope:{kind:'all',ids:[]},validFrom:'2026-01-01T00:00:00Z',approvedRevisionId:'approved',evidenceRefs:[{revisionId:'approved',sourceSha256:'synthetic',lineStart:1,lineEnd:1,quote:'Synthetic designation'}],status:'active'};
const child:RoleAssignment={...parent,id:'child',personId:'delegate',delegatedFromAssignmentId:parent.id,grantsAdmin:true};
it('refuses an otherwise valid approved delegation before applying any authority',async()=>{
 env=await createTestEnvironment();
 const source='# Synthetic appointment\n\n| personId | roleId | validFrom | validUntil | scopeKind | scopeIds | delegatedFromAssignmentId |\n| --- | --- | --- | --- | --- | --- | --- |\n| reader | approver | 2026-01-01T00:00:00Z | 2027-01-01T00:00:00Z | all | | test-assignment-approver |\n';
 const {revision}=await installAppointment(env,source),actor=await env.select('admin'),context=await getKnowledgeContext(env.bindings);
 const view=await listRoleAssignments(env.bindings,actor),candidate=view.candidates.find(item=>item.revisionId===revision.id)!;
 expect(candidate.error).toMatch(/위임.*지원하지/);expect(candidate.assignments).toEqual([]);
 await expect(applyRoleAssignment(env.bindings,actor,{revisionId:revision.id,assignments:[child],requestKey:'no-delegation',expectedContext:context})).rejects.toMatchObject({status:422,code:'DELEGATION_NOT_SUPPORTED'});
 expect(await getKnowledgeContext(env.bindings)).toEqual(context);
 expect(await env.bindings.DB.prepare("SELECT COUNT(*) AS n FROM assignments WHERE json_extract(body,'$.personId')='reader'").first('n')).toBe(0);
});
it('does not activate delegated administrator designations, while direct designations remain valid',()=>{
 const person={id:child.personId,isAdmin:true,adminAssignmentId:child.id};
 expect(administratorAssignmentEligible(person,[parent,child])).toBe(false);
 const direct={...child};delete direct.delegatedFromAssignmentId;
 expect(administratorAssignmentEligible(person,[parent,direct])).toBe(true);
});
it('refuses initial delegated assignments even when external designation data is supplied',()=>{
 const result=validateDeploymentPreparation({environment:'iso-test-scope',persons:[{id:'delegate',name:'Synthetic delegate',active:true,evidenceId:'synthetic-employment'}],operatorDesignation:null,assignments:[child]});
 expect(result.errors.some(issue=>issue.code==='delegation_not_supported')).toBe(true);
});
it('labels Korean deputy candidates as unsupported rather than asking for more delegation evidence',async()=>{
 env=await createTestEnvironment();await installAppointment(env,await loadFixture('korean-appointment.md'));
 const view=await listRoleAssignments(env.bindings,await env.select('admin'));
 expect(view.candidates[0].sourceCandidates!.find(item=>item.kind==='delegation')!.blockedReason).toMatch(/위임.*지원하지/);
});
