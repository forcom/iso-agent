import type {ActorContext} from '../../packages/contracts/src/index';
import app from '../../worker/src/index';
import {getKnowledgeContext} from '../../worker/src/lib/storage';
import type {TestEnvironment} from '../support/environment';
export const researchDefinition={title:'합성 공격 사례 조사',purpose:'합성 시스템 외부 이슈 초안',instruction:'environment',targets:'합성 서비스',jurisdiction:'KR',keywords:['합성 공격'],sources:['https://example.org/advisory'],recordTypeIds:['test-F01'],fields:['외부 이슈'],systemId:'',assigneeId:'author',periodStart:'2026-01-01',periodEnd:'2026-10-31',maxSources:10,timing:{kind:'manual'}};
export async function requestResearch(t:TestEnvironment,actor:ActorContext,path:string,data?:object){
 return app.fetch(new Request(`http://localhost/api${path}`,{method:data?'POST':'GET',headers:{Cookie:`iso_session=${actor.sessionId}`,'X-Session-Version':String(actor.sessionVersion),'Content-Type':'application/json'},...(data?{body:JSON.stringify({requestKey:crypto.randomUUID(),expectedContext:await getKnowledgeContext(t.bindings),...data})}:{})}),t.bindings);
}
