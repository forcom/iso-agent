import type {ActorContext,KnowledgeContext,RecordUpload} from '../../../packages/contracts/src/index';
import type {Env} from '../types';
import {assertExpectedContext} from '../lib/storage';
import {requireValue,textField} from '../lib/errors';
import {sha256} from '../lib/markdown';
import {researchEvent,researchGet} from './repository';
import {verifyInternalEvidence} from './results';
import type {ResearchJob,ResearchProposal,ResearchResult} from './types';

export async function researchAdoption(env:Env,actor:ActorContext,input:RecordUpload,context:KnowledgeContext,artifactId:string,revisionId:string,uploadSha256:string,previousRevisionId?:string) {
 if(!input.researchProposalId)return {statements:[] as D1PreparedStatement[],research:undefined};
 const id=textField(input.researchProposalId,'조사 제안',200);
 requireValue(!await env.DB.prepare('SELECT id FROM research_adoptions WHERE id=?').bind(id).first(),409,'PROPOSAL_ADOPTED','이미 채택한 제안입니다. 연결된 기록을 확인해 주세요.');
 const proposal=await researchGet<ResearchProposal>(env,'research_proposals',id),job=await researchGet<ResearchJob>(env,'research_jobs',proposal.jobId);
 requireValue(['received','partial'].includes(job.state)&&job.attemptId===proposal.attemptId,409,'PROPOSAL_CHANGED','현재 유효한 조사 제안을 선택해 주세요.');
 assertExpectedContext(proposal.context,context);
 requireValue(input.recordTypeIds.includes(proposal.recordTypeId)&&input.templateRevisionIds.includes(proposal.templateRevisionId)&&input.scope===job.definition.systemId&&proposal.baseRevisionId===previousRevisionId,409,'PROPOSAL_CONTEXT_CHANGED','제안의 기록 유형·양식·시스템·기준 버전을 확인해 주세요.');
 requireValue(await sha256(proposal.markdown)===proposal.sha256,422,'PROPOSAL_CHANGED','제안 원문 해시가 일치하지 않습니다.');
 const result=await researchGet<{quarantined:boolean;result:ResearchResult}>(env,'research_results',proposal.resultId);
 requireValue(!result.quarantined,409,'PROPOSAL_CHANGED','격리된 결과는 채택할 수 없습니다.');await verifyInternalEvidence(env,result.result.internalEvidence);
 const research={proposalId:id,jobId:job.id,resultId:proposal.resultId,proposalSha256:proposal.sha256};
 const body={id,...research,artifactId,revisionId,actorId:actor.personId,uploadSha256,at:new Date().toISOString(),externalEvidence:'reported_only'};
 return {research,statements:[
  env.DB.prepare('INSERT INTO research_jobs SELECT * FROM research_jobs WHERE id=? AND version<>?').bind(job.id,job.version),
  env.DB.prepare('INSERT INTO research_adoptions VALUES(?,?,?,?)').bind(id,artifactId,revisionId,JSON.stringify(body)),
  researchEvent(env,'adopted',{jobId:job.id},actor.personId,{...research,artifactId,revisionId,uploadSha256})
 ]};
}
