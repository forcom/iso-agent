import {Hono} from 'hono';
import type {AppEnv,Artifact} from '../types';
import type {GraphOperation} from '../../../packages/contracts/src/index';
import {all,getBundle,getKnowledgeContext,assertContext} from '../lib/storage';
import {queryGraph,snapshot} from '../lib/engine';
import {answerQuestion,selectGrounding} from '../lib/llm';
import {requireValue,textField} from '../lib/errors';
import {markdownDownload} from '../lib/markdown';
import {readIndexSource} from '../lib/source-index';
export const knowledgeRoutes=new Hono<AppEnv>();
knowledgeRoutes.get('/source-index/:revisionId',async c=>{
 const context=await getKnowledgeContext(c.env),bundle=await getBundle(c.env,context);
 const source=bundle.sources.find(item=>item.kind==='index'&&item.revisionId===c.req.param('revisionId'));
 requireValue(source,404,'NOT_FOUND','목차 원문을 찾을 수 없습니다.');
 const {bytes,markdown}=await readIndexSource(c.env,source);
 assertContext(context,await getKnowledgeContext(c.env));
 if(c.req.query('download')==='1')return markdownDownload(bytes,`${source.code}.md`);
 return c.json({source:{revisionId:source.revisionId,title:source.title,code:source.code,kind:source.kind,sha256:source.sha256},markdown,evidenceStatus:'verified',context});
});
knowledgeRoutes.get('/entities',async c=>{
 const context=await getKnowledgeContext(c.env),data=await snapshot(c.env,context),bundle=data.bundle;let items=data.entities;
 if(c.req.query('kind'))items=items.filter(e=>e.type===c.req.query('kind'));
 items=items.map(e=>e.type==='RecordType'?{...e,metadata:{...e.metadata,...bundle.recordTypes.find(t=>t.id===e.id)}}:e);
 return c.json({items,context});
});
knowledgeRoutes.get('/wiki',async c=>{const context=await getKnowledgeContext(c.env),bundle=await getBundle(c.env,context);return c.json({items:bundle.wiki,context})});
knowledgeRoutes.get('/wiki/:id',async c=>{const context=await getKnowledgeContext(c.env),bundle=await getBundle(c.env,context),page=bundle.wiki.find(p=>p.id===c.req.param('id'));requireValue(page,404,'NOT_FOUND','위키를 찾을 수 없습니다.');const grounding=await selectGrounding(c.env,context);return c.json({...page,claims:page.claims.map(claim=>({...claim,evidenceStatus:claim.evidenceRefs.every(r=>grounding.sources.some(s=>s.revisionId===r.revisionId))?'verified':'unavailable'})),context})});
knowledgeRoutes.get('/search',async c=>{
 const context=await getKnowledgeContext(c.env),bundle=await getBundle(c.env,context),q=(c.req.query('q')??'').toLowerCase();
 const artifacts=await all<Artifact>(c.env,'artifacts');const candidates=[...artifacts.map(a=>({id:a.id,type:a.kind,title:a.title,code:a.documentCode,href:`/#/${a.kind==='record'?'records':'documents'}/${a.id}`})),...bundle.wiki.map(w=>({id:w.id,type:'wiki',title:w.title,code:'',href:`/#/wiki/${w.id}`})),...bundle.entities.filter(e=>e.type==='Requirement').map(e=>({id:e.id,type:e.type,title:e.label,code:'',href:`/#/trace?mode=trace&id=${e.id}`}))];
 return c.json({items:candidates.filter(i=>(i.title+' '+i.code).toLowerCase().includes(q)),context});
});
knowledgeRoutes.post('/graph/query',async c=>{const body=await c.req.json();requireValue(['trace','neighbors','evidence','missing','impact'].includes(body.mode),422,'INVALID_QUERY','조회 종류를 확인해 주세요.');return c.json(await queryGraph(c.env,await getKnowledgeContext(c.env),body.mode as GraphOperation,body.targetId,body.cursor))});
knowledgeRoutes.post('/ask',async c=>{const body=await c.req.json();return c.json(await answerQuestion(c.env,c.get('actor'),textField(body.question,'question',12000)))});
knowledgeRoutes.post('/impact/draft',async c=>{const body=await c.req.json();return c.json(await answerQuestion(c.env,c.get('actor'),textField(body.description,'description',12000),textField(body.targetId,'targetId')))});
