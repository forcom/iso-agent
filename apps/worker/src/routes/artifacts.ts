import {Hono} from 'hono';
import type {AppEnv,Artifact,Revision} from '../types';
import {all,get} from '../lib/storage';
import {readRevisionFile} from '../lib/artifacts';
import {markdownDownload} from '../lib/markdown';
import {requireValue} from '../lib/errors';
export const artifactRoutes=new Hono<AppEnv>();
artifactRoutes.get('/artifacts',async c=>{
 let items=await all<Artifact>(c.env,'artifacts');const {category,kind,q}=c.req.query();
 if(category==='documents')items=items.filter(a=>a.kind!=='record');if(category==='records')items=items.filter(a=>a.kind==='record');if(kind)items=items.filter(a=>a.kind===kind.toLowerCase()||a.kind==='regulation'&&a.regulationType===kind.toLowerCase());if(q)items=items.filter(a=>(a.title+' '+a.documentCode).toLowerCase().includes(q.toLowerCase()));return c.json({items});
});
async function detail(env:AppEnv['Bindings'],id:string){
 const artifact=await get<Artifact>(env,'artifacts',id);
 return {artifact,revisions:(await all<Revision>(env,'revisions')).filter(r=>r.artifactId===id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),events:(await all<any>(env,'events')).filter(e=>e.artifactId===id),relations:(await all<any>(env,'relations')).filter(r=>r.subjectId===id||r.objectId===id)};
}
artifactRoutes.get('/artifacts/by-revision/:revisionId',async c=>{const r=await get<Revision>(c.env,'revisions',c.req.param('revisionId'));return c.json(await detail(c.env,r.artifactId))});
artifactRoutes.get('/artifacts/:id',async c=>c.json(await detail(c.env,c.req.param('id'))));
artifactRoutes.get('/artifacts/:id/revisions/:revisionId/content',async c=>{const {bytes,...result}=await readRevisionFile(c.env,c.req.param('revisionId'));requireValue(result.revision.artifactId===c.req.param('id'),404,'NOT_FOUND','해당 자료의 버전이 아닙니다.');return c.req.query('download')==='1'?markdownDownload(bytes,result.revision.filename):c.json(result)});
artifactRoutes.get('/events',async c=>c.json({items:(await all<any>(c.env,'events')).filter(e=>!c.req.query('artifactId')||e.artifactId===c.req.query('artifactId'))}));
