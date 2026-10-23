import {Hono} from 'hono';
import type {AppEnv} from '../types';
import {getBundle,getKnowledgeContext} from '../lib/storage';
import {researchCatalog,researchInstructions} from '../research/catalog';
import {connection,researchGet,researchList} from '../research/repository';
import {changeResearchJob,createResearchJob,createSchedule,editSchedule} from '../research/service';
import type {ResearchJob} from '../research/types';
export const researchRoutes=new Hono<AppEnv>();
researchRoutes.get('/research',async c=>{
 const context=await getKnowledgeContext(c.env),bundle=await getBundle(c.env,context);
 const [company,schedules,jobs]=await Promise.all([connection(c.env),researchList(c.env,'research_schedules'),researchList(c.env,'research_jobs')]);
 return c.json({connection:company,schedules,jobs,context,instructions:researchInstructions,recordTypes:bundle.recordTypes.map(type=>({...type,guidance:researchCatalog.find(row=>row.code===type.code)??null})),timeZone:'Asia/Seoul',limit:200});
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
