export type ArtifactId = string;
export type RevisionId = string;
export type PersonId = string;
export type RoleId = string;
export type RecordTypeId = string;
export type ReleaseId = string;
export type ArtifactKind = "regulation" | "template" | "record";
export type RegulationType = "manual" | "procedure" | "guide" | "template";
export type Action = "read" | "create" | "revise" | "submit" | "review" | "approve" | "reject" | "circulate" | "confirm_receipt" | "apply_assignment" | "publish";
export type RevisionStatus = "draft" | "in_review" | "reviewed" | "approved" | "rejected" | "registered" | "withdrawn";
export type EvidenceStatus = "verified" | "changed" | "unavailable" | "unrecorded";
export type ReviewStatus = "candidate" | "validated" | "rejected";
export type Origin = "regulation" | "explicit_metadata" | "reference_extraction" | "product_policy";
export interface KnowledgeContext { releaseId: ReleaseId; dataRevision: number; authorityRevision: number; rulesHash: string }
export interface EvidenceRef { revisionId: RevisionId; sourceSha256: string; lineStart: number; lineEnd: number; quote: string }
export interface ValidationIssue { code: string; path: string; message: string }
export interface ValidationReport { valid: boolean; errors: ValidationIssue[]; warnings: ValidationIssue[] }
export interface ArtifactRegistryEntry { id: ArtifactId; documentCode: string; kind: ArtifactKind; regulationType?: RegulationType; recordTypeIds?: RecordTypeId[] }
export type ArtifactRegistry = ArtifactRegistryEntry[];
export interface SourceRevision {
  artifactId: ArtifactId; revisionId: RevisionId; path: string; code: string; title: string;
  kind: "manual" | "procedure" | "guide" | "template" | "index";
  sha256: string; textSha256: string; markdown: string; templateVersion?: string;
}
export interface BuildSource extends Omit<SourceRevision, "markdown" | "sha256" | "textSha256"> { bytes: Uint8Array; sha256?: string }
export type EntityType = "Regulation" | "Template" | "Record" | "ArtifactRevision" | "Clause" | "Requirement" | "ActivityDefinition" | "RecordType" | "FunctionalRole" | "Person" | "RoleAssignment" | "ActionPolicy" | "ReviewDecision" | "Circulation" | "Receipt" | "AISystem" | "KnowledgeRelease" | "WikiPage";
export interface Entity { id: string; type: EntityType; label: string; evidenceRefs: EvidenceRef[]; metadata?: Record<string, unknown> }
export type RelationType = "has_revision" | "contains_clause" | "states_requirement" | "addresses" | "governed_by" | "requires_record_type" | "uses_template" | "record_of_type" | "evidence_candidate_for" | "references" | "change_depends_on" | "about_system" | "assignment_person" | "assignment_role" | "policy_role" | "policy_resource_type" | "decision_on" | "receipt_for" | "supersedes";
export interface Relation { id: string; subjectId: string; objectId: string; type: RelationType; origin: Origin; evidenceRefs: EvidenceRef[]; releaseId: ReleaseId; createdReleaseId?: ReleaseId; derived?: boolean; reviewStatus: ReviewStatus; evidenceStatus?: EvidenceStatus; condition?: string; conditionStatus?: "met" | "not_met" | "unknown" }
export interface FunctionalRole { id: RoleId; name: string; evidenceRefs: EvidenceRef[] }
export interface Person { id: PersonId; name: string; active: boolean; fictional?: boolean; personaId?: string; department?: string; jobTitle?: string; reportsToId?: PersonId }
export interface ActorContext { personId: PersonId; sessionId: string; sessionVersion: number; isAdmin: boolean }
export interface RoleAssignment { id: string; personId: PersonId; roleId: RoleId; scope: { kind: "all" | "system" | "resource"; ids: string[] }; validFrom: string; validUntil?: string; approvedRevisionId: RevisionId; approvalDecisionId?: string; basis?: "fictional_configuration"; delegatedFromAssignmentId?: string; replacesAssignmentId?: string; grantsAdmin?: boolean; evidenceRefs: EvidenceRef[]; status: "active" | "revoked" }
export interface PolicyCondition { field: string; equals: string | number | boolean; reason: string; evidenceRefs: EvidenceRef[] }
export interface ActionPolicy {
  id: string; resourceTypeId: string; action: Action; roleId: RoleId;
  scopeCondition: { kind: "all" | "system" | "owner" | "recipient"; systemIds?: string[]; conditions?: Record<string, boolean> };
  stateCondition: string[]; separationCondition: "none" | "not_requester" | "not_author" | "not_reviewer" | "not_implementer" | "independent_auditor";
  decisionKind: "registration" | "review" | "approval" | "receipt" | "publication" | "assignment";
  evidenceRefs: EvidenceRef[]; effectiveReleaseId: ReleaseId; origin: Origin;
  conditions: PolicyCondition[]; requiresExactRevision: boolean; productPolicyId?: string; reviewStatus: ReviewStatus; adminRequired?: boolean;
}
export interface ActionCoverage { action: Action; status: "defined" | "not_applicable" | "unresolved"; reason: string; evidenceRefs: EvidenceRef[]; policyIds: string[] }
export interface RecordType {
  id: RecordTypeId; code: string; name: string; templateArtifactId: ArtifactId; templateRevisionId: RevisionId;
  procedureCode: string; reviewRequired: boolean; approvalRequired: boolean; approvalCondition?: PolicyCondition; reviewCondition?: PolicyCondition; requiredReviewRoleIds?: RoleId[];
  applicability: string; applicabilityCondition?: PolicyCondition; roleAssignment?: true; actionCoverage: ActionCoverage[];
  evidenceRefs: EvidenceRef[]; reviewStatus: ReviewStatus;
}
export interface ReviewedMapping {
  sourceCode: string; sourceSha256: string; revisionId?: RevisionId; reviewStatus: ReviewStatus; reviewedBy: string; reviewedAt: string;
  clauses: Array<{ clause: string; lineStart: number; lineEnd: number; treatment: "defined" | "not_applicable"; reason: string }>;
}
export interface ProductPolicy { id: string; title: string; origin: "product_policy"; sourceUrl: string; decision: string; conflicts: EvidenceRef[] }
export interface ReviewedMappings {
  version: string; reviewedBy: string; reviewedAt: string; reviewScope: string;
  sources: ReviewedMapping[]; recordTypes: RecordType[]; roles: FunctionalRole[]; policies: ActionPolicy[];
  productPolicies: ProductPolicy[]; relations?: Relation[]; assessmentTargets?: Array<{ id: string; name: string; productPolicyId: string }>;
}
export interface CoverageReport { sourceCount: number; clauseCount: number; recordTypeCount: number; policyCount: number; unresolved: ValidationIssue[]; excludedSources: string[]; reviewScope: string }
export interface KnowledgeWikiClaim { id: string; heading: string; text: string; evidenceRefs: EvidenceRef[]; origin: Origin; reviewStatus: ReviewStatus }
export interface KnowledgeWikiPage { id: string; title: string; claims: KnowledgeWikiClaim[]; releaseId: ReleaseId }
export interface ReleaseManifest {
  releaseId: ReleaseId; manifestHash: string; sourcesHash: string; mappingsHash: string; rulesHash: string; schemaHash: string;
  schemaVersion: string; reviewStatus: ReviewStatus; sourceCount: number; recordTypeCount: number;
}
export interface KnowledgeBundle {
  manifest: ReleaseManifest; sources: SourceRevision[]; entities: Entity[]; relations: Relation[];
  policies: ActionPolicy[]; recordTypes: RecordType[]; roles: FunctionalRole[]; wiki: KnowledgeWikiPage[];
  coverage: CoverageReport; productPolicies: ProductPolicy[]; mappings: ReviewedMappings;
}
export interface BuildInput { sources: BuildSource[]; mappings: ReviewedMappings; rules: Uint8Array; schema: Uint8Array; schemaVersion: string; sourceMode?: "production" | "synthetic"; candidate?: boolean }
export interface KnowledgeInput { sources: SourceRevision[]; entities: Entity[]; relations: Relation[]; policies: ActionPolicy[]; recordTypes: RecordType[]; roles: FunctionalRole[]; productPolicies?: ProductPolicy[] }
export interface AuthorizationInput { actor: ActorContext; action: Action; resourceTypeIds: string[]; resourceId?: string; revisionId?: RevisionId; scope: string; state: string; authorId?: PersonId; implementerIds?: PersonId[]; context: KnowledgeContext; conditions?: Record<string, string | number | boolean> }
export interface AuthorizationDecision { allowed: boolean; reason: string; policyIds: string[]; context: KnowledgeContext; evidenceRefs: EvidenceRef[]; assignmentIds?: string[]; engine?: { name: string; version: string; rulesHash: string } }
export type GraphOperation = "trace" | "neighbors" | "evidence" | "missing" | "impact";
export interface GraphQuery { operation: GraphOperation; targetId?: string; targetIds?: string[]; depth?: number; context: KnowledgeContext; cursor?: string; limit?: number }
export interface GraphResult { queryId: string; targetIds: string[]; operation: GraphOperation; computedAt: string; entities: Entity[]; relations: Relation[]; totalEntities: number; totalRelations: number; cursor?: string; context: KnowledgeContext; engine: { name: string; version: string; rulesHash: string }; paths: Array<{ nodeIds: string[]; relationIds: string[]; derived: boolean }>; excluded: Array<{ id: string; reason: string }>; unknown: Array<{ id: string; reason: string }>; missing: Array<{ recordTypeId: string; condition: string; status: string }>; displayRange: { start: number; end: number }; impactSet?: string[] }
export interface RecordUpload { file: Uint8Array; filename: string; documentCode: string; title: string; recordTypeIds: string[]; scope: string; templateRevisionIds: string[]; requestKey: string; expectedContext: KnowledgeContext; fieldMappings?: Record<string, string>; conditions?: Record<string, string | number | boolean> }
export interface RevisionUpload extends Omit<RecordUpload, "recordTypeIds"> { artifactId: ArtifactId; expectedRevisionId: RevisionId }
export interface RecordRevisionResult { artifactId: ArtifactId; revisionId: RevisionId; status: RevisionStatus; context: KnowledgeContext }
export interface RevisionContent { artifactId: ArtifactId; revisionId: RevisionId; sha256: string; markdown: string; status: RevisionStatus }
export interface DecisionInput { artifactId: ArtifactId; revisionId: RevisionId; decision: "submit" | "review" | "approve" | "reject"; comment: string; requestKey: string; expectedContext: KnowledgeContext; expectedRevisionVersion: string }
export interface DecisionResult { decisionId: string; revisionId: RevisionId; status: RevisionStatus; context: KnowledgeContext }
export interface CirculationInput { artifactId: ArtifactId; revisionId: RevisionId; recipientIds: PersonId[]; purpose: string; requestKey: string; expectedContext: KnowledgeContext }
export interface CirculationResult { circulationId: string; revisionId: RevisionId; recipientIds: PersonId[]; context: KnowledgeContext }
export interface ReceiptInput { circulationId: string; revisionId: RevisionId; understood: boolean; requestKey: string; expectedContext: KnowledgeContext }
export interface ReceiptResult { receiptId: string; circulationId: string; revisionId: RevisionId; personId: PersonId }
export interface AssignmentApplyInput { revisionId: RevisionId; assignments: RoleAssignment[]; requestKey: string; expectedContext: KnowledgeContext }
export interface AssignmentResult { assignmentIds: string[]; context: KnowledgeContext }
export interface BuildResult { changeId: string; bundle: KnowledgeBundle; validation: ValidationReport }
export interface PublishInput { changeId: string; releaseId: ReleaseId; expectedContext: KnowledgeContext; requestKey: string }
export interface PublishResult { releaseId: ReleaseId; context: KnowledgeContext }
export interface GroundingRequest { question: string; context: KnowledgeContext; actor: ActorContext }
export interface GroundingResult { sources: Array<{ revisionId: RevisionId; markdown: string; evidenceRefs: EvidenceRef[] }>; excluded: Array<{ revisionId: RevisionId; reason: string }>; context: KnowledgeContext }
export interface AskInput extends GroundingRequest { requestKey?: string }
export interface AskResult { answer: string; grounding: GroundingResult; context: KnowledgeContext }
export interface ImpactInput { targetId: string; context: KnowledgeContext; actor: ActorContext; prompt?: string }
export interface ImpactResult { computed: GraphResult; draft: string | null; draftError?: string; disclaimer: string }
export interface DeploymentDesignationSource { artifactId: ArtifactId; revisionId: RevisionId; documentCode: string; title: string; markdown: string; sha256: string; confirmedBy: PersonId; confirmedAt: string; approvalEvidenceId: string }
export interface DeploymentPreparation { environment: string; operatorDesignation: { personId: PersonId; evidenceId: string; designatedAt: string } | null; persons: Array<Person & { evidenceId: string }>; assignments: RoleAssignment[]; designationSources?: DeploymentDesignationSource[] }
export interface InstallTarget { environment: 'local'|'demo'|`iso-test-${string}`; preparation?: DeploymentPreparation; ruleBytes?: Uint8Array; schemaBytes?: Uint8Array; sourceBytes?: Record<RevisionId, Uint8Array> }
export interface InstallReport { releaseId: ReleaseId; installed: boolean; unassignedRoleIds: RoleId[]; warnings: string[] }
