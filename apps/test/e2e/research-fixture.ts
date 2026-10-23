import type {TestEnvironment} from '../support/environment';
import {researchDefinition} from '../research/fixture';
import {createResearchJob} from '../../worker/src/research/service';
import {getKnowledgeContext} from '../../worker/src/lib/storage';
import {reserveResearchJob,beginResearchJob,finishResearchAttempt} from '../../worker/src/research/runner';
export async function seedResearchResult(t:TestEnvironment){
 // This helper is served only by the isolated loopback browser harness.
 const actor=await t.select('author'),env=t.bindings;
 await env.DB.prepare("UPDATE research_connection SET version=version+1,body=json_set(body,'$.version',version+1,'$.state','ready') WHERE id='company-dots'").run();
 const job=await createResearchJob(env,actor,{requestKey:crypto.randomUUID(),expectedContext:await getKnowledgeContext(env),definition:{...researchDefinition,title:'합성 결과 확인용 조사'}}) as {id:string};
 // Other browser scenarios may have queued manual work: reserve this fixture without consuming it.
 await env.DB.prepare("UPDATE research_jobs SET version=version+1,created_at='2000-01-01T00:00:00Z',body=json_set(body,'$.version',version+1) WHERE id=?").bind(job.id).run();
 const attempt=(await reserveResearchJob(env))!;await beginResearchJob(env,attempt.id);
 await finishResearchAttempt(env,attempt.id,{kind:'result',result:{coverage:'complete',summary:'합성 조사 제안',findings:[],sources:[{id:'s',url:'https://example.org/synthetic',title:'합성 외부 공지',publisher:'Synthetic',accessedAt:new Date().toISOString(),quote:'Synthetic source; not operational evidence.'}],internalEvidence:[],drafts:[{recordTypeId:'test-F01',templateRevisionId:'test-tpl-rev-1',title:'합성 제안 기록',markdown:'# 합성 초안\n사내 검토 필요'}],actions:[],questions:['실제 사용 여부를 확인해야 합니다.'],checkedScope:'격리된 합성 출처',failedSources:[]}});
 await env.DB.prepare("UPDATE research_connection SET version=version+1,body=json_set(body,'$.version',version+1,'$.state','unconfigured') WHERE id='company-dots'").run();
 return {jobId:job.id};
}
