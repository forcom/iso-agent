import type {TestEnvironment} from '../support/environment';
import {sourceText} from '../support/fixtures';
import {researchDefinition} from '../research/fixture';
import {createResearchJob} from '../../worker/src/research/service';
import {getBundle,getKnowledgeContext} from '../../worker/src/lib/storage';
import {reserveResearchJob,beginResearchJob,finishResearchAttempt} from '../../worker/src/research/runner';
import {canonical,sha256} from '../../packages/knowledge/src/index';
export async function seedResearchResult(t:TestEnvironment,limited=false){
 // This helper is served only by the isolated loopback browser harness.
 const actor=await t.select('author'),env=t.bindings;
 if(limited){
  const roleId='research-f01-author',personId='research-limited-author',bundle=structuredClone(await getBundle(env,await getKnowledgeContext(env)));
  bundle.roles.push({id:roleId,name:'합성 F01 작성자',evidenceRefs:bundle.roles[0].evidenceRefs});
  for(const action of ['create','revise'] as const){const original=bundle.policies.find(p=>p.resourceTypeId==='test-F01'&&p.action===action)!;bundle.policies.push({...original,id:`research-limited-${action}`,roleId})}
  bundle.manifest.manifestHash='';bundle.manifest.manifestHash=await sha256(canonical(bundle));
  const objectKey=await env.DB.prepare('SELECT object_key FROM releases WHERE id=?').bind(bundle.manifest.releaseId).first<string>('object_key');
  await env.SOURCES.put(objectKey!,JSON.stringify(bundle));await env.DB.prepare('UPDATE releases SET body=? WHERE id=?').bind(JSON.stringify(bundle.manifest),bundle.manifest.releaseId).run();
  await env.DB.prepare('INSERT OR REPLACE INTO persons VALUES(?,?)').bind(personId,JSON.stringify({id:personId,name:'합성 F01 작성자',active:true,isAdmin:false})).run();
  const assignment=JSON.parse((await env.DB.prepare("SELECT body FROM assignments WHERE id='test-assignment-author'").first('body')) as string);
  await env.DB.prepare('INSERT OR REPLACE INTO assignments VALUES(?,?)').bind('research-limited-assignment',JSON.stringify({...assignment,id:'research-limited-assignment',personId,roleId})).run();
  await env.DB.prepare('UPDATE context SET authority_revision=authority_revision+1 WHERE id=1').run();
 }
 await env.DB.prepare("UPDATE research_connection SET version=version+1,body=json_set(body,'$.version',version+1,'$.state','ready') WHERE id='company-dots'").run();
 const job=await createResearchJob(env,actor,{requestKey:crypto.randomUUID(),expectedContext:await getKnowledgeContext(env),definition:{...researchDefinition,title:'합성 결과 확인용 조사',recordTypeIds:limited?['test-F01','test-F02']:['test-F01']}}) as {id:string};
 // Other browser scenarios may have queued manual work: reserve this fixture without consuming it.
 await env.DB.prepare("UPDATE research_jobs SET version=version+1,created_at='2000-01-01T00:00:00Z',body=json_set(body,'$.version',version+1) WHERE id=?").bind(job.id).run();
 const attempt=(await reserveResearchJob(env))!;await beginResearchJob(env,attempt.id);
 await finishResearchAttempt(env,attempt.id,{kind:'result',result:{coverage:'complete',summary:'합성 조사 제안',findings:[],sources:[{id:'s',url:'https://example.org/synthetic',title:'합성 외부 공지',publisher:'Synthetic',accessedAt:new Date().toISOString(),quote:'Synthetic source; not operational evidence.'}],internalEvidence:[{revisionId:'test-reg-rev',sourceSha256:await sha256(sourceText),lineStart:1,lineEnd:2,quote:sourceText.trimEnd()}],drafts:[{recordTypeId:'test-F01',templateRevisionId:'test-tpl-rev-1',title:'합성 제안 기록',markdown:'# 합성 초안\n사내 검토 필요'},...(limited?[{recordTypeId:'test-F02',templateRevisionId:'test-tpl-rev-2',title:'두 번째 유형 제안',markdown:'# 합성 F02 제안'}]:[])],actions:[],questions:['실제 사용 여부를 확인해야 합니다.'],checkedScope:'격리된 합성 출처',failedSources:[]}});
 await env.DB.prepare("UPDATE research_connection SET version=version+1,body=json_set(body,'$.version',version+1,'$.state','unconfigured') WHERE id='company-dots'").run();
 return {jobId:job.id};
}
