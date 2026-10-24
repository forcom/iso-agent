import { Hono } from "hono";
import type { AppEnv } from "./types";
import {getCookie} from 'hono/cookie';
import {sessionRoutes,resolveActor} from './routes/session';
import {ApiError,requireValue} from './lib/errors';
import {requestScope} from './lib/storage';
import {artifactRoutes} from './routes/artifacts';
import {recordRoutes} from './routes/records';
import {reviewRoutes} from './routes/reviews';
import {circulationRoutes} from './routes/circulations';
import {knowledgeRoutes} from './routes/knowledge';
import {adminRoutes} from './routes/admin';
import {assignmentRoutes} from './routes/assignments';
import {researchRoutes} from './routes/research';

const app = new Hono<AppEnv>();
app.use('*',async(c,next)=>{
 const path=c.req.path;
 if(path==='/mcp'||path.startsWith('/mcp/')||path.startsWith('/oauth/')||path.startsWith('/.well-known/oauth-')){
  const {dotsFetch}=await import('./research/oauth');return dotsFetch(c.req.raw,c.env,c.executionCtx as ExecutionContext);
 }
 await next();
});
app.use('/api/*',async(c,next)=>{c.header('Cache-Control','no-store');await requestScope.run(new Map(),next)});
app.onError((error,c)=>{
 if(error instanceof ApiError)return c.json({error:{code:error.code,message:error.message,details:error.details}},error.status as 400);
 if(error instanceof SyntaxError)return c.json({error:{code:'INVALID_INPUT',message:'요청 형식을 확인해 주세요.'}},422);
 console.error('API failure',error.message);
 return c.json({error:{code:'INTERNAL_ERROR',message:'요청을 완료하지 못했습니다.'}},500);
});
app.route('/api',sessionRoutes);

app.get("/api/health", (c) =>
  c.json({ ok: true, app: c.env.APP_NAME ?? "iso-agent" }),
);
app.all('/api/bootstrap',c=>c.json({error:{code:'NOT_FOUND'}},404));
app.all('/api/seed/*',c=>c.json({error:{code:'NOT_FOUND'}},404));
app.all('/api/ingest/*',c=>c.json({error:{code:'NOT_FOUND'}},404));
app.use('/api/*',async(c,next)=>{
 const actor=await resolveActor(c.env,getCookie(c,'iso_session'));c.set('actor',actor);
 if(!['GET','HEAD','OPTIONS'].includes(c.req.method)) {
  requireValue(Number(c.req.header('X-Session-Version'))===actor.sessionVersion,409,'SESSION_CONFLICT','선택 직원이 변경되었습니다. 다시 확인해 주세요.');
  const origin=c.req.header('Origin');requireValue(!origin||origin===new URL(c.req.url).origin,403,'ORIGIN_REJECTED','같은 앱에서 요청해 주세요.');
  if(c.req.header('Content-Type')?.includes('application/json')){const body=await c.req.json();requireValue(body&&typeof body==='object'&&!Array.isArray(body),422,'INVALID_INPUT','JSON 객체가 필요합니다.');}
 }
 await next();
});
app.route('/api',artifactRoutes);
app.route('/api',recordRoutes);
app.route('/api',reviewRoutes);
app.route('/api',circulationRoutes);
app.route('/api',knowledgeRoutes);
app.route('/api',adminRoutes);
app.route('/api',assignmentRoutes);
app.route('/api',researchRoutes);
app.notFound(c=>c.json({error:{code:'NOT_FOUND',message:'대상을 찾을 수 없습니다.'}},404));

export default app;
