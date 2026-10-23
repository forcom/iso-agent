import type { ActorContext, ArtifactKind, KnowledgeContext, RevisionStatus, RoleAssignment } from '../../packages/contracts/src/index';
export interface Env {
  APP_NAME?:string; DB:D1Database; SOURCES:R2Bucket; ENGINE?:DurableObjectNamespace;
  ENGINE_URL?:string; OPENAI_API_KEY?:string; LLM_MODEL?:string; ASSETS?:Fetcher; ALLOW_FICTIONAL_PERSONNEL?:string;
  RESEARCH_SCHEDULES_ENABLED?:string;
}
export type AppEnv = {Bindings:Env;Variables:{actor:ActorContext}};
export interface Artifact {
  id:string; documentCode:string; title:string; kind:ArtifactKind; regulationType?:string;
  recordTypeIds:string[]; workingRevisionId:string; effectiveRevisionId:string|null; systemIds:string[];
}
export interface Revision {
  id:string; artifactId:string; filename:string; sourceSha256:string; textSha256:string;
  objectKey:string; textKey:string; state:RevisionStatus; createdAt:string; createdBy:string;
  previousRevisionId:string|null; templateRevisionIds:string[]; systemIds:string[];
  conditions:Record<string,string|number|boolean>; fieldMappings:Record<string,string>;
  submittedContext?:KnowledgeContext; submissionId?:string; reviewedBy?:string[]; approvedBy?:string[];
  evidenceStatus:'verified'|'changed'|'unavailable'|'unrecorded';
  assignmentCandidates?:RoleAssignment[];
  requesterPersonId?:string;
  implementerIds?:string[];
  auditedPersonIds?:string[];
  externalDesignation?:{confirmedBy:string;confirmedAt:string;approvalEvidenceId:string;sourceSha256:string};
  fictionalDesignation?:{authorizationReference:string;sourceSha256:string;configurationId:string};
  research?:{proposalId:string;jobId:string;resultId:string;proposalSha256:string};
}
export interface Change {
  id:string; title:string; baseContext:KnowledgeContext; revisionIds:string[]; withdrawnArtifactIds:string[];
  state:'draft'|'built'|'validated'|'approved'|'published'|'cancelled'; createdBy:string; createdAt:string;
  candidateReleaseId?:string; candidateHash?:string; validation?:unknown;
  /** Over 1 MiB this is stored as a `JsonPayloadReference` (R2 pointer). Only GET /admin/regulation-changes/:id resolves it;
   * mutation results return the stored form and the change list omits it. */
  diff?:unknown;
  knowledgeValidation?:{personId:string;hash:string;at:string};
}
