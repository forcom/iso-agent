import type {KnowledgeContext, EvidenceRef} from '../../../packages/contracts/src/index';

export type ResearchTiming = {kind:'manual'} | {
 kind:'three_hourly'|'daily'|'weekly'|'monthly'; time:string; startDate:string; endDate:string; weekday?:number; day?:number;
};
export interface ResearchDefinition {
 title:string; purpose:string; instruction:string; targets:string; jurisdiction:string;
 keywords:string[]; sources:string[]; recordTypeIds:string[]; fields:string[]; systemId:string;
 assigneeId:string; periodStart:string; periodEnd:string; maxSources:number; timing:ResearchTiming;
}
export interface ResearchSchedule {
 id:string; version:number; definition:ResearchDefinition; enabled:boolean; nextAt:string|null;
 createdAt:string; createdBy:string; updatedAt:string; connectionId:string;
 deletedAt?:string;
 lastError?:{code:string;message:string;at:string};
}
export type ResearchState='queued'|'reserved'|'running'|'needs_input'|'partial'|'received'|'uncertain'|'failed'|'cancelled';
export interface ResearchJob {
 id:string; version:number; state:ResearchState; scheduleId:string|null; scheduleVersion:number|null;
 slot:string|null; definition:ResearchDefinition; assigneeId:string; requestedBy:string;
 createdAt:string; updatedAt:string; connectionId:string; context:KnowledgeContext;
 templates:Record<string,string>; baseRevisionId?:string; attemptId:string|null;
 supplements:{text:string;personId:string;at:string}[]; message:string;
 scheduleDefinition?:ResearchDefinition;
 coverage:{from:string;through:string;scheduledFrom:string|null;coalescedThrough:string;verifiedThrough:null;sourceWindows:{url:string;from:string;through:string;verifiedThrough:null}[]};
}
export interface ResearchConnection {
 id:string; version:number; state:'unconfigured'|'ready'|'held'; label:string; reason:string;
}
export interface ResearchAttempt {
 id:string; jobId:string; state:'reserved'|'running'|'closed'; createdAt:string; expiresAt:string;
 connectionVersion:number; input:ResearchJob; resultHash?:string;
}
export interface ResearchResult {
 coverage:'complete'|'partial'|'no_change'; summary:string;
 findings:{kind:'external_fact'|'company_relevance'|'interpretation'|'proposal'|'unknown';text:string;sourceIds:string[]}[];
 sources:{id:string;url:string;title:string;publisher:string;accessedAt:string;quote:string;verification:'unverified';reason:string}[];
 internalEvidence:EvidenceRef[];
 drafts:{recordTypeId:string;templateRevisionId:string;title:string;markdown:string}[];
 actions:{text:string;reason:string;ownerSuggestion:string;dueSuggestion:string;verificationMethod:string}[];
 questions:string[]; checkedScope:string; failedSources:string[];
}
export interface ResearchProposal {
 id:string; jobId:string; attemptId:string; resultId:string; recordTypeId:string; templateRevisionId:string;
 title:string; markdown:string; sha256:string; context:KnowledgeContext; baseRevisionId?:string;
}
