import {Hono} from 'hono';
import type {AppEnv,Artifact,Revision} from '../types';
import type {Action} from '../../../packages/contracts/src/index';
import {all,get,getKnowledgeContext} from '../lib/storage';
import {decideRevision} from '../lib/decisions';
import {resourceFor} from '../lib/artifacts';
import {authorizeRecordAction} from '../lib/conditions';
import {requireValue} from '../lib/errors';
export const reviewRoutes=new Hono<AppEnv>();
reviewRoutes.post('/records/:id/submit',async c=>{const body=await c.req.json();const r=await get<Revision>(c.env,'revisions',body.revisionId);requireValue(r.artifactId===c.req.param('id'),404,'NOT_FOUND','해당 기록의 버전이 아닙니다.');return c.json(await decideRevision(c.env,c.get('actor'),{...body,artifactId:c.req.param('id'),decision:'submit',comment:body.comment??''}))});
reviewRoutes.post('/revisions/:id/decisions',async c=>c.json(await decideRevision(c.env,c.get('actor'),{...await c.req.json(),revisionId:c.req.param('id')})));
reviewRoutes.get('/reviews',async c=>{
 const context=await getKnowledgeContext(c.env),items=[];
 for(const artifact of (await all<Artifact>(c.env,'artifacts')).filter(a=>a.kind==='record')){
  const revision=await get<Revision>(c.env,'revisions',artifact.workingRevisionId);if(!['in_review','reviewed'].includes(revision.state))continue;
  const actions=[];for(const action of ['review','approve','reject'] as Action[]){const decision=await authorizeRecordAction(c.env,c.get('actor'),artifact,revision,context,action);if(decision.allowed)actions.push({action,...decision})}
  if(actions.length)items.push({id:revision.id,revisionId:revision.id,artifactId:artifact.id,title:artifact.title,documentCode:artifact.documentCode,recordTypeIds:artifact.recordTypeIds,state:revision.state,actions});
 }return c.json({items,context});
});
