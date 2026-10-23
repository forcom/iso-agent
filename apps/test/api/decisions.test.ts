import {it,expect,afterEach} from 'vitest';
import app from '../../worker/src/index';
import {createTestEnvironment,type TestEnvironment} from '../support/environment';
import {get,getKnowledgeContext} from '../../worker/src/lib/storage';
import {revisionVersion} from '../../worker/src/lib/conditions';
import type {Revision} from '../../worker/src/types';
let env:TestEnvironment;afterEach(async()=>env?.cleanup());
async function actor(id:string){const a=await env.select(id);return {cookie:`iso_session=${a.sessionId}`,'X-Session-Version':'1'}}
async function mutate(path:string,body:any,id='author'){
 const revisionId=path.match(/^\/api\/revisions\/([^/]+)\/decisions$/)?.[1]??(path.endsWith('/submit')?body.revisionId:undefined);
 const expectedRevisionVersion=revisionId?await revisionVersion(await get<Revision>(env.bindings,'revisions',revisionId)):undefined;
 return app.request(path,{method:'POST',headers:{...await actor(id),'Content-Type':'application/json'},body:JSON.stringify({requestKey:crypto.randomUUID(),expectedContext:await getKnowledgeContext(env.bindings),expectedRevisionVersion,...body})},env.bindings);
}
async function upload(id?:string,revisionId?:string){
 const data=new FormData();data.set('file',new File(['# 시험 기록\n승인자: administrator'],'../../record.md'));data.set('documentCode','TEST-RECORD');data.set('title','시험 기록');data.set('recordTypeId','test-F01');data.set('templateRevisionIds',JSON.stringify(['test-tpl-rev-1']));data.set('requestKey',crypto.randomUUID());data.set('expectedContext',JSON.stringify(await getKnowledgeContext(env.bindings)));if(revisionId)data.set('expectedRevisionId',revisionId);
 return app.request(id?`/api/records/${id}/revisions`:'/api/records',{method:'POST',headers:await actor('author'),body:data},env.bindings);
}
it('upload, exact revision review/approval, new version and personal receipts',async()=>{
 env=await createTestEnvironment();const created=await upload();expect(created.status).toBe(201);const r=await created.json() as any;
 const read=await app.request(`/api/artifacts/${r.artifactId}/revisions/${r.revisionId}/content`,{headers:await actor('reader')},env.bindings);expect(read.status).toBe(200);expect((await read.json() as any).markdown).toContain('administrator');
 expect((await mutate(`/api/revisions/${r.revisionId}/decisions`,{decision:'approve'},'admin')).status).toBe(403);
 expect((await mutate(`/api/records/${r.artifactId}/submit`,{revisionId:r.revisionId})).status).toBe(200);
 expect((await mutate(`/api/revisions/${r.revisionId}/decisions`,{decision:'review',comment:'시험 검토'},'reviewer')).status).toBe(200);
 expect((await mutate(`/api/revisions/${r.revisionId}/decisions`,{decision:'approve',comment:'시험 승인'},'approver')).status).toBe(200);
 const circulated=await mutate(`/api/revisions/${r.revisionId}/circulations`,{recipientIds:['reader'],purpose:'시험 전달'});expect(circulated.status).toBe(201);const circ=await circulated.json() as any;
 expect((await mutate(`/api/circulations/${circ.circulationId}/receipts`,{revisionId:r.revisionId,kind:'received'},'admin')).status).toBe(403);
 expect((await mutate(`/api/circulations/${circ.circulationId}/receipts`,{revisionId:r.revisionId,kind:'received'},'reader')).status).toBe(200);
 expect((await mutate(`/api/circulations/${circ.circulationId}/receipts`,{revisionId:r.revisionId,kind:'understood'},'reader')).status).toBe(200);
 const second=await upload(r.artifactId,r.revisionId);expect(second.status).toBe(201);const r2=await second.json() as any;expect(r2.revisionId).not.toBe(r.revisionId);
 const detail=await app.request(`/api/artifacts/${r.artifactId}`,{headers:await actor('reader')},env.bindings);const d=await detail.json() as any;expect(d.artifact.effectiveRevisionId).toBe(r.revisionId);expect(d.artifact.workingRevisionId).toBe(r2.revisionId);expect(d.revisions.find((v:any)=>v.id===r.revisionId).state).toBe('approved');
 expect((await mutate(`/api/revisions/${r.revisionId}/decisions`,{decision:'approve'},'approver')).status).toBe(409);
});
