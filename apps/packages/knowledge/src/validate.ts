import type { DeploymentPreparation, KnowledgeBundle, ValidationIssue, ValidationReport } from "../../contracts/src/index";
import { validateKnowledge, validateEvidence } from "../../ontology/src/index";
import { extractSourceClauses } from "./rebase";

export function checkBundle(bundle: KnowledgeBundle): ValidationReport {
  const result = validateKnowledge(bundle);
  const fail = (code: string, path: string, message: string) => result.errors.push({ code, path, message });
  for (const target of bundle.mappings.assessmentTargets ?? []) {
    const policy = bundle.productPolicies.find(policy => policy.id === target.productPolicyId);
    if (!target.id || !target.name?.trim() || !policy || policy.origin !== "product_policy" || !policy.sourceUrl || !policy.decision) fail("assessment_target_origin", target.id, "Assessment targets require an explicit product decision; they do not establish actual operation");
  }
  if (bundle.manifest.reviewStatus !== "validated") fail("candidate_release", "manifest.reviewStatus", "Candidate release cannot be installed or published");
  if (bundle.manifest.sourceCount !== bundle.sources.length || bundle.manifest.recordTypeCount !== bundle.recordTypes.length) fail("manifest_coverage", "manifest", "Manifest counts do not match bundle");
  for (const source of bundle.sources) {
    const mapping = bundle.mappings.sources.find(item => item.sourceCode === source.code);
    if (!mapping || mapping.sourceSha256 !== source.sha256 || mapping.revisionId && mapping.revisionId !== source.revisionId || mapping.reviewStatus !== "validated" || !mapping.reviewedBy || !mapping.reviewedAt) fail("stale_mapping", source.code, "Source bytes need a completed review bound to this exact revision and hash");
    if (mapping && source.kind !== "template" && source.kind !== "index") for (const clause of extractSourceClauses(source)) {
      if (!mapping.clauses.some(item => item.clause === clause.clause && item.lineStart === clause.lineStart && item.lineEnd === clause.lineEnd && item.reason)) fail("missing_clause", `${source.code}.${clause.clause}`, "Every source section needs explicit reviewed treatment");
    }
    if (source.kind === "template" && !bundle.recordTypes.some(type => type.templateRevisionId === source.revisionId)) fail("unmapped_record_type", source.code, "Every template must have one reviewed record type");
  }
  for (const mapping of bundle.mappings.sources) if (!bundle.sources.some(source => source.code === mapping.sourceCode)) fail("missing_source", mapping.sourceCode, "Reviewed source is absent from release");
  for (const policy of bundle.policies) if (policy.reviewStatus !== "validated") fail("unresolved_policy", policy.id, "Policy needs explicit completed review");
  const templateIds = new Set<string>();
  for (const type of bundle.recordTypes) {
    if (templateIds.has(type.templateArtifactId)) fail("duplicate_template_identity", type.id, "Template must not create duplicate record types");
    templateIds.add(type.templateArtifactId);
    if (type.reviewStatus !== "validated") fail("unresolved_record_type", type.id, "Record type review is incomplete");
    for (const action of ["create", "revise", "review", "approve", "circulate"]) {
      const coverage = type.actionCoverage.find(item => item.action === action);
      if (!coverage || coverage.status === "unresolved") { fail("unresolved_action", `${type.id}.${action}`, "Action must be defined or explicitly not applicable"); continue; }
      if (!coverage.reason || !coverage.evidenceRefs.length) fail("coverage_evidence", `${type.id}.${action}`, "Coverage requires a reason and exact regulatory evidence");
      if (coverage.status === "defined" && (!coverage.policyIds.length || coverage.policyIds.some(id => !bundle.policies.some(policy => policy.id === id && policy.resourceTypeId === type.id && policy.action === action)))) fail("missing_policy", `${type.id}.${action}`, "Defined action lacks its type-specific policy");
      if (coverage.status === "not_applicable" && coverage.policyIds.length) fail("inapplicable_policy", `${type.id}.${action}`, "Not applicable actions cannot grant authority");
    }
    if (!bundle.sources.some(source => source.artifactId === type.templateArtifactId && source.revisionId === type.templateRevisionId && source.kind === "template")) fail("missing_source", type.id, "Record type requires an exact template revision");
    if (type.approvalRequired && !bundle.policies.some(policy => policy.resourceTypeId === type.id && policy.action === "approve")) fail("missing_policy", type.id, "Approval-required type has no approver");
    for (const roleId of type.requiredReviewRoleIds ?? []) if (!bundle.roles.some(role => role.id === roleId) || !bundle.policies.some(policy => policy.resourceTypeId === type.id && policy.action === "review" && policy.roleId === roleId)) fail("required_review_policy", type.id, "Every mandatory review role must have a reviewed type-specific review policy");
  }
  for (const page of bundle.wiki) for (const claim of page.claims) {
    if (!claim.evidenceRefs.length && claim.origin !== "product_policy") fail("wiki_evidence", claim.id, "Wiki claims require source evidence");
    claim.evidenceRefs.forEach(ref => result.errors.push(...validateEvidence(ref, bundle.sources, claim.id)));
  }
  result.errors.push(...bundle.coverage.unresolved);
  result.valid = result.errors.length === 0;
  return result;
}

export function validateDeploymentPreparation(input: DeploymentPreparation): ValidationReport {
  const errors: ValidationIssue[] = [];
  const fail = (code: string, path: string, message: string) => errors.push({ code, path, message });
  if (!input.environment?.trim()) fail("environment_required", "environment", "Deployment environment must be explicit");
  const people = new Set<string>();
  for (const person of input.persons) {
    if (!person.id || !person.evidenceId || !person.name || people.has(person.id)) fail("person_evidence", person.id, "People need unique identity and confirmed employment evidence");
    people.add(person.id);
  }
  const operator = input.operatorDesignation;
  if (!operator || !people.has(operator.personId) || !operator.evidenceId || !Number.isFinite(Date.parse(operator.designatedAt))) fail("operator_unassigned", "operatorDesignation", "An explicit operator designation with evidence is required; no fictional people are created");
  for (const assignment of input.assignments) {
    if (assignment.delegatedFromAssignmentId) fail("delegation_not_supported", assignment.id, "Delegated authority is outside the current system scope");
    if (assignment.approvalDecisionId) fail("external_designation_only", assignment.id, "Initial external designation must use confirmed external approval evidence, never an unrecorded application decision");
    if (!people.has(assignment.personId) || !assignment.approvedRevisionId || !assignment.evidenceRefs.length || !Number.isFinite(Date.parse(assignment.validFrom))) fail("assignment_evidence", assignment.id, "Role assignment needs confirmed person, approved evidence, period and scope");
    if (assignment.validUntil && Date.parse(assignment.validUntil) <= Date.parse(assignment.validFrom)) fail("assignment_period", assignment.id, "Role assignment end must follow its start");
  }
  return { valid: errors.length === 0, errors, warnings: [] };
}
