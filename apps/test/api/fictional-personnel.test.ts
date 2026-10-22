import {afterAll,afterEach,beforeAll,expect,it} from 'vitest';
import app from '../../worker/src/index';
import {authorize,snapshot} from '../../worker/src/lib/engine';
import {sha256} from '../../worker/src/lib/markdown';
import {getKnowledgeContext} from '../../worker/src/lib/storage';
import {resolveActor} from '../../worker/src/routes/session';
import {createTestEnvironment,type TestEnvironment} from '../support/environment';
import {startTestEngine} from '../support/engine';

let env:TestEnvironment,stopEngine:()=>Promise<void>;
beforeAll(async()=>{stopEngine=await startTestEngine()});
afterAll(async()=>{await stopEngine?.()});
afterEach(async()=>{await env?.cleanup()});
const source='# Synthetic local configuration\nFictional approver has the approver role for local demonstration.\n';
const resource={typeIds:['test-F01'],revisionId:'record-revision',currentRevisionId:'record-revision',state:'reviewed'};
async function prepare(){
 env=await createTestEnvironment();
 const person={id:'fictional-person',name:'Synthetic Persona',active:true,fictional:true,personaId:'P-test',department:'Synthetic team',jobTitle:'Synthetic lead',reportsToId:'director'};
 await env.bindings.DB.prepare('INSERT INTO persons VALUES(?,?)').bind(person.id,JSON.stringify(person)).run();
 const hash=await sha256(source),revision={id:'fictional-designation-revision',artifactId:'fictional-designation',filename:'fictional.md',sourceSha256:hash,textSha256:hash,objectKey:'synthetic-fictional.md',textKey:'synthetic-fictional.txt',state:'registered',createdAt:'2026-01-01',createdBy:'user-authorized-local-setup',previousRevisionId:null,templateRevisionIds:[],systemIds:[],conditions:{},fieldMappings:{},evidenceStatus:'verified',fictionalDesignation:{authorizationReference:'synthetic-user-request',sourceSha256:hash,configurationId:'synthetic-configuration'}};
 await env.bindings.SOURCES.put(revision.objectKey,source);await env.bindings.SOURCES.put(revision.textKey,source);
 await env.bindings.DB.prepare('INSERT INTO artifacts VALUES(?,?,?,?)').bind(revision.artifactId,'SYNTHETIC-CONFIG','record',JSON.stringify({id:revision.artifactId,documentCode:'SYNTHETIC-CONFIG',title:'Synthetic local configuration',kind:'record',recordTypeIds:[],workingRevisionId:revision.id,effectiveRevisionId:null,systemIds:[]})).run();
 await env.bindings.DB.prepare('INSERT INTO revisions VALUES(?,?,?)').bind(revision.id,revision.artifactId,JSON.stringify(revision)).run();
 const assignment={id:'test-assignment-approver',personId:person.id,roleId:'approver',scope:{kind:'all',ids:[]},validFrom:'2020-01-01T00:00:00Z',approvedRevisionId:revision.id,basis:'fictional_configuration',status:'active',evidenceRefs:[{revisionId:revision.id,sourceSha256:hash,lineStart:2,lineEnd:2,quote:source.split('\n')[1]}]};
 await env.bindings.DB.prepare('UPDATE assignments SET body=? WHERE id=?').bind(JSON.stringify(assignment),assignment.id).run();
 return {person,revision,assignment,actor:await env.select(person.id),context:await getKnowledgeContext(env.bindings)};
}

it('does not expose, select or authorize fictional persons without the explicit local flag',async()=>{
 const {actor,context}=await prepare();
 const people=await (await app.request('/api/persons',{},env.bindings)).json() as any;
 expect(people.items.some((person:any)=>person.id===actor.personId)).toBe(false);
 expect((await app.request('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({personId:actor.personId})},env.bindings)).status).toBe(401);
 await expect(resolveActor(env.bindings,actor.sessionId)).rejects.toMatchObject({status:401,code:'FICTIONAL_PERSONNEL_DISABLED'});
 expect((await authorize(env.bindings,actor,'approve',resource,context)).allowed).toBe(false);
});

it('accepts a checked fictional configuration locally while keeping type rules and provenance explicit',async()=>{
 const {person,revision,actor,context}=await prepare();env.bindings.ALLOW_FICTIONAL_PERSONNEL='true';
 const response=await app.request('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({personId:person.id})},env.bindings);
 expect(response.status).toBe(200);const session=await response.json() as any;
 const {id,...metadata}=person;expect(session.actor).toMatchObject({...metadata,personId:id});expect(session.identityNotice).toContain('가상');expect(session.roles[0].roleName).toBe('시험 approver');
 expect((await authorize(env.bindings,actor,'approve',resource,context)).allowed).toBe(true);
 expect((await authorize(env.bindings,actor,'approve',{...resource,typeIds:['test-F02']},context)).allowed).toBe(false);
 const data=await snapshot(env.bindings,context);expect(data.entities.find(entity=>entity.id===person.id)?.metadata).toMatchObject({fictional:true,department:person.department,jobTitle:person.jobTitle});
 expect(await env.bindings.DB.prepare('SELECT COUNT(*) AS n FROM decisions').first('n')).toBe(0);
 expect(JSON.parse((await env.bindings.DB.prepare('SELECT body FROM revisions WHERE id=?').bind(revision.id).first<{body:string}>())!.body).state).toBe('registered');
});

it('revokes the fictional role on source tampering or a forged approval reference',async()=>{
 const {actor,context,revision,assignment}=await prepare();env.bindings.ALLOW_FICTIONAL_PERSONNEL='true';
 await env.bindings.DB.prepare('UPDATE assignments SET body=? WHERE id=?').bind(JSON.stringify({...assignment,approvalDecisionId:'fabricated-approval'}),assignment.id).run();
 expect((await authorize(env.bindings,actor,'approve',resource,context)).allowed).toBe(false);
 await env.bindings.DB.prepare('UPDATE assignments SET body=? WHERE id=?').bind(JSON.stringify(assignment),assignment.id).run();
 await env.bindings.SOURCES.put(revision.objectKey,source+'tampered');
 expect((await authorize(env.bindings,actor,'approve',resource,context)).allowed).toBe(false);
});
