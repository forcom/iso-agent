import type { ActionPolicy, ArtifactId, ArtifactRegistry, EntityType, EvidenceRef, KnowledgeInput, RelationType, SourceRevision, ValidationIssue, ValidationReport } from "../../contracts/src/index";

export const SCHEMA_VERSION = "2.1.0";
export const REGULATION_HIERARCHY = {
  manual: { level: 1, label: "매뉴얼", purpose: "준수 요구사항과 기본 책임·권한", parentType: null },
  procedure: { level: 2, label: "절차서", purpose: "매뉴얼 요구사항을 수행하는 절차·프로세스", parentType: "manual" },
  guide: { level: 3, label: "지침서", purpose: "절차 실행에 필요한 세부 실무 방법", parentType: "procedure" },
} as const;
type RelationDefinition = { subject: EntityType[]; object: EntityType[]; transitive: boolean; cycles: boolean; evidence: "source_or_registration" | "source" | "event" };
const artifact: EntityType[] = ["Regulation", "Template", "Record"];
const revision: EntityType[] = ["ArtifactRevision"];
const dependent: EntityType[] = ["ArtifactRevision", "ActivityDefinition", "AISystem"];
export const RELATIONS: Record<RelationType, RelationDefinition> = {
  has_revision: { subject: artifact, object: revision, transitive: false, cycles: false, evidence: "source_or_registration" },
  contains_clause: { subject: revision, object: ["Clause"], transitive: false, cycles: false, evidence: "source" },
  states_requirement: { subject: ["Clause"], object: ["Requirement"], transitive: false, cycles: false, evidence: "source" },
  addresses: { subject: [...revision, "ActivityDefinition"], object: ["Requirement"], transitive: false, cycles: false, evidence: "source" },
  governed_by: { subject: ["ActivityDefinition", "RecordType"], object: [...revision, "Clause"], transitive: false, cycles: false, evidence: "source" },
  requires_record_type: { subject: ["ActivityDefinition", "Clause"], object: ["RecordType"], transitive: false, cycles: false, evidence: "source" },
  uses_template: { subject: revision, object: revision, transitive: false, cycles: false, evidence: "source_or_registration" },
  record_of_type: { subject: ["Record"], object: ["RecordType"], transitive: false, cycles: false, evidence: "source_or_registration" },
  evidence_candidate_for: { subject: revision, object: ["Requirement", "ActivityDefinition"], transitive: false, cycles: false, evidence: "source" },
  references: { subject: revision, object: [...artifact, ...revision], transitive: false, cycles: true, evidence: "source" },
  subordinate_to: { subject: revision, object: revision, transitive: false, cycles: false, evidence: "source" },
  change_depends_on: { subject: dependent, object: dependent, transitive: true, cycles: true, evidence: "source" },
  about_system: { subject: [...revision, "ActivityDefinition"], object: ["AISystem"], transitive: false, cycles: false, evidence: "source_or_registration" },
  assignment_person: { subject: ["RoleAssignment"], object: ["Person"], transitive: false, cycles: false, evidence: "event" },
  assignment_role: { subject: ["RoleAssignment"], object: ["FunctionalRole"], transitive: false, cycles: false, evidence: "event" },
  policy_role: { subject: ["ActionPolicy"], object: ["FunctionalRole"], transitive: false, cycles: false, evidence: "source" },
  policy_resource_type: { subject: ["ActionPolicy"], object: ["RecordType"], transitive: false, cycles: false, evidence: "source" },
  decision_on: { subject: ["ReviewDecision"], object: revision, transitive: false, cycles: false, evidence: "event" },
  receipt_for: { subject: ["Receipt"], object: revision, transitive: false, cycles: false, evidence: "event" },
  supersedes: { subject: revision, object: revision, transitive: false, cycles: false, evidence: "event" },
};
export const SEPARATION_CONDITIONS = ["none", "not_requester", "not_author", "not_reviewer", "not_implementer", "independent_auditor"] as const;
export const KNOWLEDGE_SCHEMA = { regulationHierarchy: REGULATION_HIERARCHY, separationConditions: SEPARATION_CONDITIONS, assessmentTargets: { type: "AISystem", origin: "product_policy", actualOperation: false, scopeStatus: "unconfirmed" }, version: SCHEMA_VERSION, relations: RELATIONS, commonReadOrigin: "product_policy", approvalsTransferBetweenRevisions: false, roleNamesGrantAuthority: false };
const issue = (code: string, path: string, message: string): ValidationIssue => ({ code, path, message });
const report = (errors: ValidationIssue[]): ValidationReport => ({ valid: errors.length === 0, errors, warnings: [] });

export function resolveArtifactCode(code: string, registry: ArtifactRegistry): ArtifactId {
  const matches = registry.filter(entry => entry.documentCode === code);
  if (matches.length !== 1) throw new Error(matches.length ? `duplicate_document_code: ${code}` : `unknown_document_code: ${code}`);
  return matches[0].id;
}

export function validateEvidence(ref: EvidenceRef, sources: SourceRevision[], path: string): ValidationIssue[] {
  const source = sources.find(candidate => candidate.revisionId === ref.revisionId);
  if (!source) return [issue("missing_source", path, `No source revision ${ref.revisionId}`)];
  if (!ref.sourceSha256 || source.sha256 !== ref.sourceSha256) return [issue("source_hash", path, "Evidence hash does not match its immutable source revision")];
  const lines = source.markdown.split("\n");
  if (!Number.isInteger(ref.lineStart) || !Number.isInteger(ref.lineEnd) || ref.lineStart < 1 || ref.lineEnd < ref.lineStart || ref.lineEnd > lines.length) return [issue("invalid_line_range", path, "Invalid source line range")];
  if (!ref.quote.trim() || lines.slice(ref.lineStart - 1, ref.lineEnd).join("\n") !== ref.quote) return [issue("quote_mismatch", path, "Quote must equal the exact complete source line range")];
  return [];
}

export function validateActionPolicy(policy: ActionPolicy): ValidationReport {
  const errors: ValidationIssue[] = [];
  const fail = (code: string, message: string) => errors.push(issue(code, policy.id, message));
  if (!["read", "create", "revise", "submit", "review", "approve", "reject", "circulate", "confirm_receipt", "apply_assignment", "publish"].includes(policy.action)) fail("unknown_action", "Unknown action cannot grant permission");
  if (!SEPARATION_CONDITIONS.includes(policy.separationCondition)) fail("unknown_separation", "Unknown separation condition");
  if (!policy.id || !policy.resourceTypeId || !policy.roleId) fail("policy_identity", "Policy needs explicit rule, resource type and role IDs");
  if (policy.action !== "read" && policy.resourceTypeId === "*") fail("type_scoped_write", "Writes must name an individual resource type");
  if (policy.origin === "product_policy" ? !policy.productPolicyId : !policy.evidenceRefs.length) fail("policy_origin", "Regulatory evidence and product decisions require distinct provenance");
  if (["review", "approve", "reject", "confirm_receipt", "publish", "apply_assignment"].includes(policy.action) && !policy.requiresExactRevision) fail("exact_revision_required", "Decision must bind an exact revision");
  if (policy.action === "confirm_receipt" && (policy.decisionKind !== "receipt" || policy.scopeCondition.kind !== "recipient")) fail("receipt_is_not_approval", "Receipt confirms only the designated recipient and version");
  if (!policy.stateCondition.length || !["all", "system", "owner", "recipient"].includes(policy.scopeCondition.kind)) fail("policy_condition", "Policy needs explicit state and scope conditions");
  if (policy.approvalScope !== undefined && !["record", "outcome"].includes(policy.approvalScope)) fail("approval_scope", "Unknown approval scope cannot grant permission");
  if (policy.requiresRecordDesignation !== undefined && policy.requiresRecordDesignation !== true) fail("record_designation", "Record designation restriction must be explicit");
  for (const condition of policy.conditions) {
    if (typeof condition.equals !== "boolean" || policy.scopeCondition.conditions?.[condition.field] !== condition.equals) fail("uncompiled_condition", `Condition ${condition.field} is not enforced by the engine scope`);
    if (!condition.reason || !condition.evidenceRefs.length) fail("condition_evidence", `Condition ${condition.field} needs its source and reason`);
  }
  return report(errors);
}

export function validateKnowledge(input: KnowledgeInput): ValidationReport {
  const errors: ValidationIssue[] = [];
  const byId = new Map(input.entities.map(entity => [entity.id, entity]));
  if (byId.size !== input.entities.length) errors.push(issue("duplicate_entity_id", "entities", "Entity IDs must be unique"));
  const seenCodes = new Set<string>(); const seenRevisions = new Set<string>(); const seenArtifacts = new Set<string>();
  for (const source of input.sources) {
    if (seenCodes.has(source.code)) errors.push(issue("duplicate_document_code", source.code, "Each initial logical artifact needs a unique code"));
    if (seenRevisions.has(source.revisionId)) errors.push(issue("duplicate_revision_id", source.code, "Source revision IDs must be unique"));
    if (seenArtifacts.has(source.artifactId)) errors.push(issue("duplicate_artifact_id", source.code, "One initial source per artifact"));
    seenCodes.add(source.code); seenRevisions.add(source.revisionId); seenArtifacts.add(source.artifactId);
  }
  const evidence = (refs: EvidenceRef[], path: string) => refs.forEach((ref, index) => errors.push(...validateEvidence(ref, input.sources, `${path}.evidenceRefs[${index}]`)));
  input.entities.forEach(entity => evidence(entity.evidenceRefs, entity.id));
  const relationIds = new Set<string>();
  for (const relation of input.relations) {
    if (relationIds.has(relation.id)) errors.push(issue("duplicate_relation_id", relation.id, "Relation ID must be unique"));
    relationIds.add(relation.id);
    const definition = RELATIONS[relation.type];
    if (!definition) { errors.push(issue("unknown_relation_type", relation.id, "Unknown predicate")); continue; }
    const subject = byId.get(relation.subjectId); const object = byId.get(relation.objectId);
    if (!subject || !object || !definition.subject.includes(subject.type) || !definition.object.includes(object.type)) errors.push(issue("relation_type_mismatch", relation.id, "Subject/object types or direction do not match predicate"));
    if (!definition.cycles && relation.subjectId === relation.objectId) errors.push(issue("relation_cycle", relation.id, "Self-cycle is not allowed"));
    if (definition.evidence === "source" && !relation.evidenceRefs.length && relation.origin !== "product_policy") errors.push(issue("missing_evidence", relation.id, "Regulatory relation requires source evidence"));
    if (relation.type === "change_depends_on" && relation.origin === "reference_extraction") errors.push(issue("reference_not_dependency", relation.id, "A document reference is not change dependency evidence"));
    if (relation.type === "subordinate_to") {
      const child = input.sources.find(source => source.revisionId === relation.subjectId);
      const parent = input.sources.find(source => source.revisionId === relation.objectId);
      if (subject?.type !== "ArtifactRevision" || object?.type !== "ArtifactRevision" || !child || !parent || !(child.kind === "procedure" && parent.kind === "manual" || child.kind === "guide" && parent.kind === "procedure")) errors.push(issue("invalid_hierarchy", relation.id, "Hierarchy requires procedure → manual or guide → procedure source revisions"));
      if (relation.origin !== "regulation" || !relation.evidenceRefs.length) errors.push(issue("hierarchy_evidence", relation.id, "Hierarchy requires explicit regulatory evidence, not a reference or product policy"));
      if (relation.reviewStatus !== "validated") errors.push(issue("unreviewed_hierarchy", relation.id, "Hierarchy must be reviewed for these exact revisions"));
    }
    if (relation.type === "uses_template" && (subject?.metadata?.artifactKind !== "record" || object?.metadata?.artifactKind !== "template")) errors.push(issue("template_revision_type", relation.id, "uses_template must connect a record revision to a template revision"));
    if (relation.type === "supersedes" && subject?.metadata?.artifactId !== object?.metadata?.artifactId) errors.push(issue("cross_artifact_revision", relation.id, "Version replacement cannot cross logical artifacts"));
    evidence(relation.evidenceRefs, relation.id);
  }
  const roles = new Set(input.roles.map(role => role.id));
  const resources = new Set([...input.recordTypes.map(type => type.id), "manual", "procedure", "guide", "template", "*"]);
  for (const policy of input.policies) {
    errors.push(...validateActionPolicy(policy).errors);
    if (policy.origin === "product_policy" && !input.productPolicies?.some(item => item.id === policy.productPolicyId && item.origin === "product_policy" && item.sourceUrl && item.decision)) errors.push(issue("unknown_product_policy", policy.id, "Product authority requires a separately declared product decision"));
    if (!roles.has(policy.roleId) && !(policy.origin === "product_policy" && ["employee", "recipient", "administrator"].includes(policy.roleId))) errors.push(issue("unknown_policy_role", policy.id, "Unregistered functional role"));
    if (!resources.has(policy.resourceTypeId)) errors.push(issue("unknown_resource_type", policy.id, "Unregistered policy resource type"));
    if (policy.approvalScope === "record" && !input.recordTypes.some(type => type.id === policy.resourceTypeId && type.recordApproval?.label?.trim() && type.recordApproval?.limitations?.trim())) errors.push(issue("record_approval_scope", policy.id, "Record approval requires an explicit label and limitations"));
    evidence(policy.evidenceRefs, policy.id);
    policy.conditions.forEach(condition => evidence(condition.evidenceRefs, `${policy.id}.${condition.field}`));
  }
  input.roles.forEach(role => evidence(role.evidenceRefs, role.id));
  input.recordTypes.forEach(type => { evidence(type.evidenceRefs, type.id); type.actionCoverage.forEach(item => evidence(item.evidenceRefs, `${type.id}.${item.action}`)); type.declaredConditions?.forEach(condition => evidence(condition.evidenceRefs, `${type.id}.${condition.field}`)); });
  input.productPolicies?.forEach(policy => evidence(policy.conflicts, policy.id));
  const replacement = new Map(input.relations.filter(relation => relation.type === "supersedes").map(relation => [relation.subjectId, relation.objectId]));
  for (const start of replacement.keys()) {
    const seen = new Set<string>(); let current: string | undefined = start;
    while (current && replacement.has(current)) {
      if (seen.has(current)) { errors.push(issue("revision_cycle", start, "Version lineage must be acyclic")); break; }
      seen.add(current); current = replacement.get(current);
    }
  }
  return report(errors);
}
