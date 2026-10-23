import { Hono } from 'hono';
import {getCookie,setCookie} from 'hono/cookie';
import type {AppEnv, Env} from '../types';
import type {ActorContext, Person,RoleAssignment} from '../../../packages/contracts/src/index';
import {all,get,getBundle,getKnowledgeContext} from '../lib/storage';
import {ApiError,requireValue,textField} from '../lib/errors';
export const sessionRoutes=new Hono<AppEnv>();
export function administratorAssignmentEligible(person:{id:string;isAdmin?:boolean;adminAssignmentId?:string|null;fictional?:boolean},assignments:RoleAssignment[],now=Date.now()) {
 if(person.isAdmin!==true)return false;
 if(!person.adminAssignmentId)return person.fictional!==true;
 const assignment=assignments.find(item=>item.id===person.adminAssignmentId);
 if(!assignment||assignment.delegatedFromAssignmentId||assignment.status!=='active'||assignment.scope.kind!=='all'||!Number.isFinite(Date.parse(assignment.validFrom))||Date.parse(assignment.validFrom)>now||assignment.validUntil&&(!Number.isFinite(Date.parse(assignment.validUntil))||Date.parse(assignment.validUntil)<=now))return false;
 return assignment.personId===person.id&&assignment.grantsAdmin===true;
}
export async function resolveActor(env:Env,id:string|undefined):Promise<ActorContext> {
 if(!id) throw new ApiError(401,'PERSON_REQUIRED','직원을 선택해 주세요.');
 const row=await env.DB.prepare('SELECT s.id,s.person_id,s.version,p.body FROM sessions s JOIN persons p ON p.id=s.person_id WHERE s.id=?').bind(id).first<{id:string;person_id:string;version:number;body:string}>();
 requireValue(row,401,'PERSON_REQUIRED','직원을 다시 선택해 주세요.');const person=JSON.parse(row.body);
 requireValue(person.active===true,401,'PERSON_INACTIVE','유효한 직원 지정이 필요합니다.');
 requireValue(person.fictional!==true||env.ALLOW_FICTIONAL_PERSONNEL==='true',401,'FICTIONAL_PERSONNEL_DISABLED','가상 직원 설정은 허용된 데모 환경에서만 사용할 수 있습니다.');
 return {personId:row.person_id,sessionId:row.id,sessionVersion:row.version,isAdmin:administratorAssignmentEligible(person,person.adminAssignmentId?await all<RoleAssignment>(env,'assignments'):[])};
}
export async function sessionView(env:Env,actor:ActorContext) {
 const person=await get<Person>(env,'persons',actor.personId);
 const assignments=(await all<RoleAssignment>(env,'assignments')).filter(a=>a.personId===person.id && a.status==='active'&&!a.delegatedFromAssignmentId);
 let context=null;try{context=await getKnowledgeContext(env)}catch(error){if(!(error instanceof ApiError && error.code==='KNOWLEDGE_UNAVAILABLE'))throw error}
 const bundle=context?await getBundle(env,context):null,roles=assignments.map(assignment=>({...assignment,roleName:bundle?.roles.find(role=>role.id===assignment.roleId)?.name??assignment.roleId}));
 return {actor:{...actor,name:person.name,active:person.active,fictional:person.fictional,personaId:person.personaId,department:person.department,jobTitle:person.jobTitle,reportsToId:person.reportsToId},roles,context,sessionVersion:actor.sessionVersion,identityNotice:person.fictional?'가상 페르소나의 데모 역할 설정입니다. 실제 직원·인사발령·승인 근거가 아니며 본인 인증·전자서명이 아닙니다.':'직원 선택은 데모 신원 선택이며 본인 인증·전자서명이 아닙니다.'};
}
sessionRoutes.get('/persons',async c=>c.json({items:(await all<Person>(c.env,'persons')).filter(p=>p.active&&(p.fictional!==true||c.env.ALLOW_FICTIONAL_PERSONNEL==='true')).map(p=>({id:p.id,name:p.name,active:p.active,fictional:p.fictional,personaId:p.personaId,department:p.department,jobTitle:p.jobTitle,reportsToId:p.reportsToId}))}));
sessionRoutes.post('/session',async c=>{
 const origin=c.req.header('origin');requireValue(!origin||origin===new URL(c.req.url).origin,403,'ORIGIN_REJECTED','같은 앱에서 요청해 주세요.');
 const input=await c.req.json();requireValue(input&&typeof input==='object'&&!Array.isArray(input),422,'INVALID_INPUT','JSON 객체가 필요합니다.');const person=await get<Person>(c.env,'persons',textField(input.personId,'personId'));
 requireValue(person.active,401,'PERSON_INACTIVE','유효한 직원 지정이 필요합니다.');
 requireValue(person.fictional!==true||c.env.ALLOW_FICTIONAL_PERSONNEL==='true',401,'FICTIONAL_PERSONNEL_DISABLED','가상 직원 설정은 허용된 데모 환경에서만 사용할 수 있습니다.');
 let id=getCookie(c,'iso_session');let version=1;let previous:ActorContext|undefined;
 if(id){
  try{previous=await resolveActor(c.env,id)}catch(error){
   if(!(error instanceof ApiError&&error.status===401&&['PERSON_REQUIRED','PERSON_INACTIVE','FICTIONAL_PERSONNEL_DISABLED'].includes(error.code)))throw error;
  }
 }
 if(previous){
  id=previous.sessionId;requireValue(Number(c.req.header('X-Session-Version'))===previous.sessionVersion,409,'SESSION_CONFLICT','다른 탭에서 선택 직원이 변경되었습니다.');
  version=previous.sessionVersion+1;
  const changed=await c.env.DB.prepare('UPDATE sessions SET person_id=?,version=?,updated_at=? WHERE id=? AND version=?').bind(person.id,version,new Date().toISOString(),id,previous.sessionVersion).run();
  requireValue(changed.meta.changes===1,409,'SESSION_CONFLICT','직원 선택이 변경되었습니다.');
 }else{id=crypto.randomUUID();await c.env.DB.prepare('INSERT INTO sessions VALUES(?,?,1,?)').bind(id,person.id,new Date().toISOString()).run()}
 setCookie(c,'iso_session',id,{httpOnly:true,sameSite:'Strict',secure:new URL(c.req.url).protocol==='https:',path:'/'});
 return c.json(await sessionView(c.env,await resolveActor(c.env,id)));
});
sessionRoutes.get('/me',async c=>c.json(await sessionView(c.env,await resolveActor(c.env,getCookie(c,'iso_session')))));
