import type {ActorContext} from '../../packages/contracts/src/index';
import app from '../../worker/src/index';
import {getKnowledgeContext} from '../../worker/src/lib/storage';
import type {TestEnvironment} from '../support/environment';
export const researchDefinition={title:'합성 공격 사례 조사',purpose:'합성 시스템 외부 이슈 초안',instruction:'environment',targets:'합성 서비스',jurisdiction:'KR',keywords:['합성 공격'],sources:['https://example.org/advisory'],recordTypeIds:['test-F01'],fields:['외부 이슈'],systemId:'',assigneeId:'author',periodStart:'2026-01-01',periodEnd:'2026-10-31',maxSources:10,timing:{kind:'manual'}};
export async function requestResearch(t:TestEnvironment,actor:ActorContext,path:string,data?:object){
 return app.fetch(new Request(`http://localhost/api${path}`,{method:data?'POST':'GET',headers:{Cookie:`iso_session=${actor.sessionId}`,'X-Session-Version':String(actor.sessionVersion),'Content-Type':'application/json'},...(data?{body:JSON.stringify({requestKey:crypto.randomUUID(),expectedContext:await getKnowledgeContext(t.bindings),...data})}:{})}),t.bindings);
}

export const resultInput={kind:'result',result:{coverage:'complete',summary:'합성 외부 이슈 제안',findings:[{kind:'proposal',text:'공격 노출 조건을 확인할 것',sourceIds:['s1']}],sources:[{id:'s1',url:'https://example.org/advisory',title:'합성 공지',publisher:'Synthetic',accessedAt:'2026-10-24T00:00:00Z',quote:'synthetic public text',verification:'verified'}],internalEvidence:[],drafts:[{recordTypeId:'test-F01',templateRevisionId:'test-tpl-rev-1',title:'합성 초안',markdown:'# 합성 조사 초안\n수행 여부 미확인\n'}],actions:[{text:'노출 확인',reason:'사례 검토',ownerSuggestion:'담당자 제안',dueSuggestion:'검토 후 결정',verificationMethod:'내부 시험'}],questions:['실제 사용 여부?'],checkedScope:'합성 공지 1개 확인',failedSources:[]}};
