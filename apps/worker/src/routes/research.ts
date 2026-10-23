import {Hono} from 'hono';
import type {AppEnv} from '../types';
import {getBundle,getKnowledgeContext} from '../lib/storage';
import {researchCatalog,researchInstructions} from '../research/catalog';
import {connection,researchGet,researchList} from '../research/repository';
import {changeResearchJob,createResearchJob,createSchedule,editSchedule,requireResearchWrite} from '../research/service';
import {ApiError,stringList} from '../lib/errors';
import type {ResearchJob} from '../research/types';
export const researchRoutes=new Hono<AppEnv>();
researchRoutes.get('/research',async c=>{
 const context=await getKnowledgeContext(c.env),bundle=await getBundle(c.env,context);
 const [company,schedules,jobs]=await Promise.all([connection(c.env),researchList(c.env,'research_schedules'),researchList(c.env,'research_jobs')]);
 return c.json({connection:company,schedules,jobs,context,instructions:researchInstructions,recordTypes:bundle.recordTypes.map(type=>({...type,guidance:researchCatalog.find(row=>row.code===type.code)??null})),timeZone:'Asia/Seoul',limit:200,schedulingEnabled:c.env.RESEARCH_SCHEDULES_ENABLED==='true'});
});
researchRoutes.get('/research/permission',async c=>{
 const recordTypeIds=stringList(JSON.parse(c.req.query('types')??'[]'),'기록 유형');
 if(!recordTypeIds.length)return c.json({allowed:false,reason:'기록 유형을 선택해 주세요.'});
 try{await requireResearchWrite(c.env,c.get('actor'),{recordTypeIds,systemId:c.req.query('systemId')??''},await getKnowledgeContext(c.env),c.req.query('baseRevisionId'));return c.json({allowed:true,reason:''})}
 catch(error){if(error instanceof ApiError&&error.status===403)return c.json({allowed:false,reason:'해당 기록 유형의 작성·수정 권한이 없습니다.'});throw error}
});
researchRoutes.get('/research/jobs/:id',async c=>{
 const id=c.req.param('id'),job=await researchGet<ResearchJob>(c.env,'research_jobs',id);
 const [company,events,results,proposals,adoptions]=await Promise.all([connection(c.env),c.env.DB.prepare("SELECT body FROM events WHERE json_extract(body,'$.jobId')=? ORDER BY rowid").bind(id).all<{body:string}>(),c.env.DB.prepare('SELECT body FROM research_results WHERE job_id=? ORDER BY rowid').bind(id).all<{body:string}>(),c.env.DB.prepare('SELECT body FROM research_proposals WHERE job_id=? ORDER BY rowid').bind(id).all<{body:string}>(),c.env.DB.prepare('SELECT a.body FROM research_adoptions a JOIN research_proposals p ON p.id=a.id WHERE p.job_id=?').bind(id).all<{body:string}>()]);
 return c.json({job,connection:company,context:await getKnowledgeContext(c.env),events:events.results.map(r=>JSON.parse(r.body)),results:results.results.map(r=>JSON.parse(r.body)),proposals:proposals.results.map(r=>JSON.parse(r.body)),adoptions:adoptions.results.map(r=>JSON.parse(r.body))});
});
researchRoutes.post('/research/schedules',async c=>c.json(await createSchedule(c.env,c.get('actor'),await c.req.json()),201));
researchRoutes.post('/research/schedules/:id',async c=>c.json(await editSchedule(c.env,c.get('actor'),c.req.param('id'),await c.req.json())));
researchRoutes.post('/research/schedules/:id/run',async c=>c.json(await createResearchJob(c.env,c.get('actor'),await c.req.json(),c.req.param('id')),201));
researchRoutes.post('/research/jobs',async c=>c.json(await createResearchJob(c.env,c.get('actor'),await c.req.json()),201));
researchRoutes.post('/research/jobs/:id',async c=>c.json(await changeResearchJob(c.env,c.get('actor'),c.req.param('id'),await c.req.json())));
