import {afterEach,expect,it} from 'vitest';
import app from '../../worker/src/index';
import {createTestEnvironment,type TestEnvironment} from '../support/environment';
import {installAppointment} from '../support/appointment';
import {loadFixture} from '../support/fixtures';
import {all,get,getKnowledgeContext,update} from '../../worker/src/lib/storage';

let env:TestEnvironment;
afterEach(async()=>env?.cleanup());
async function setup(){env=await createTestEnvironment();await installAppointment(env,await loadFixture('korean-appointment.md'),'director')}
async function headers(person:string){const actor=await env.select(person);return {cookie:`iso_session=${actor.sessionId}`,'X-Session-Version':'1'}}
async function list(person:string){return app.request('/api/admin/role-assignments',{headers:await headers(person)},env.bindings)}
async function input(){const response=await list('admin');expect(response.status).toBe(200);const data=await response.json() as any,candidate=data.candidates.find((row:any)=>row.revisionId==='appointment-v1');return {revisionId:'appointment-v1',mappedAssignments:[{candidateId:candidate.sourceCandidates.find((row:any)=>row.sectionId==='R-01'&&row.kind==='appointment').id,personId:'reader',roleIds:['approver'],validFrom:'2026-04-27T00:00:00+09:00',scope:{kind:'all',ids:[]},reason:'Synthetic approved source matches this role and scope'}],requestKey:crypto.randomUUID(),expectedContext:await getKnowledgeContext(env.bindings)}}
async function apply(person:string,body:object){return app.request('/api/admin/role-assignments/apply',{method:'POST',headers:{...await headers(person),'Content-Type':'application/json'},body:JSON.stringify(body)},env.bindings)}

it('lets every employee read approved source candidates while showing the exact current apply authorization',async()=>{
 await setup();for(const person of ['author','reviewer','approver','director','reader','admin']){const response=await list(person);expect(response.status).toBe(200);const data=await response.json() as any;expect(data.candidates[0].sourceCandidates).toHaveLength(4);expect(data.candidates[0].authorization.allowed).toBe(person==='director')}
});
it('allows the assigned non-administrator to apply exact source mappings without promoting that actor',async()=>{
 await setup();const before=await get<any>(env.bindings,'persons','director'),revision=await get(env.bindings,'revisions','appointment-v1');expect(before.isAdmin).toBe(false);const body=await input(),response=await apply('director',body);expect(response.status).toBe(201);const result=await response.json() as any;expect(result.assignmentIds).toHaveLength(1);expect(await get(env.bindings,'persons','director')).toEqual(before);expect(await get(env.bindings,'revisions','appointment-v1')).toEqual(revision);expect(await get<any>(env.bindings,'assignments',result.assignmentIds[0])).toMatchObject({personId:'reader',roleId:'approver',approvedRevisionId:'appointment-v1',approvalDecisionId:'appointment-approval',adminMapping:{actorId:'director'}});expect((await apply('director',body)).status).toBe(201);
});
it.each(['admin','author','reviewer'])('denies %s without the assigned apply role and leaves authority unchanged',async person=>{
 await setup();const body=await input(),before=await getKnowledgeContext(env.bindings),assignments=await all(env.bindings,'assignments');const response=await apply(person,body);expect(response.status).toBe(403);expect(await getKnowledgeContext(env.bindings)).toEqual(before);expect(await all(env.bindings,'assignments')).toEqual(assignments);expect(await all(env.bindings,'events')).toEqual([]);
});
it('keeps assigned-role scope, source approval and exact mapping checks for a non-administrator',async()=>{
 await setup();const body=await input(),before=await getKnowledgeContext(env.bindings);const changed={...body,mappedAssignments:[{...body.mappedAssignments[0],validFrom:'2027-01-01T00:00:00Z'}]};expect((await apply('director',changed)).status).toBe(422);
 const assignment=await get<any>(env.bindings,'assignments','test-assignment-director');await update(env.bindings,'assignments',assignment.id,{...assignment,scope:{kind:'resource',ids:['test-reg']}}).run();expect((await apply('director',body)).status).toBe(403);await update(env.bindings,'assignments',assignment.id,assignment).run();
 const revision=await get<any>(env.bindings,'revisions','appointment-v1');await update(env.bindings,'revisions',revision.id,{...revision,state:'draft'}).run();expect((await apply('director',body)).status).toBe(409);expect(await getKnowledgeContext(env.bindings)).toEqual(before);expect(await all(env.bindings,'events')).toEqual([]);
});
