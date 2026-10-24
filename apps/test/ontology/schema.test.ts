import { describe, expect, it } from "vitest";
import { resolveArtifactCode, validateActionPolicy, validateKnowledge } from "../../packages/ontology/src/index";
import { buildRelease } from "../../packages/knowledge/src/index";
import { corpus } from "../knowledge/fixture";

describe("ontology", () => {
  it("record_approval_requires_a_declared_scope_and_explicit_limitations", async () => {
    const bundle = await buildRelease(await corpus());
    bundle.policies[0].approvalScope = "invented" as never;
    expect(validateActionPolicy(bundle.policies[0]).valid).toBe(false);
    bundle.policies[0].approvalScope = "record";
    expect(validateKnowledge(bundle).errors.some(issue => issue.code === "record_approval_scope")).toBe(true);
    bundle.recordTypes.find(type => type.id === bundle.policies[0].resourceTypeId)!.recordApproval = {label:"Plan approval",limitations:"Execution remains pending"};
    expect(validateKnowledge(bundle).valid).toBe(true);
  });
  it("supports_requester_separation_without_substituting_author_identity", async () => {
    const policy = (await corpus()).mappings.policies[0];
    policy.separationCondition = "not_requester";
    expect(validateActionPolicy(policy).valid).toBe(true);
  });
  it("does_not_duplicate_template_identity", () => {
    expect(resolveArtifactCode("FORM", [{ id: "arbitrary", documentCode: "FORM", kind: "template" }])).toBe("arbitrary");
    expect(() => resolveArtifactCode("FORM", [{ id: "one", documentCode: "FORM", kind: "template" }, { id: "two", documentCode: "FORM", kind: "regulation" }])).toThrow(/duplicate/);
  });
  it("rejects_unknown_relation_types_and_wrong_direction", async () => {
    const bundle = await buildRelease(await corpus());
    bundle.relations.push({ id: "bad", subjectId: "example-procedure", objectId: "example-template", type: "grants" as never, origin: "explicit_metadata", evidenceRefs: [], releaseId: bundle.manifest.releaseId, reviewStatus: "validated" });
    expect(validateKnowledge(bundle).errors.some(issue => issue.code === "unknown_relation_type")).toBe(true);
    bundle.relations.at(-1)!.type = "receipt_for";
    expect(validateKnowledge(bundle).errors.some(issue => issue.code === "relation_type_mismatch")).toBe(true);
  });
  it("approval_requires_exact_version_and_receipt_is_not_approval", async () => {
    const policy = (await corpus()).mappings.policies[0];
    policy.action = "approve"; policy.decisionKind = "approval";
    expect(validateActionPolicy(policy).errors.some(issue => issue.code === "exact_revision_required")).toBe(true);
    policy.requiresExactRevision = true; policy.action = "confirm_receipt";
    expect(validateActionPolicy(policy).errors.some(issue => issue.code === "receipt_is_not_approval")).toBe(true);
  });
  it("read_is_common_but_write_is_type_scoped_and_product_policy_distinct", async () => {
    const policy = (await corpus()).mappings.policies[0]; policy.resourceTypeId = "*";
    expect(validateActionPolicy(policy).valid).toBe(false);
    policy.action = "read"; policy.origin = "product_policy"; policy.productPolicyId = "all-employees-read";
    expect(validateActionPolicy(policy).valid).toBe(true);
  });
  it("rejects_policy_claims_without_a_declared_product_decision", async () => {
    const bundle = await buildRelease(await corpus());
    bundle.policies[0].origin = "product_policy"; bundle.policies[0].productPolicyId = "missing-product-decision";
    expect(validateKnowledge(bundle).errors.some(issue => issue.code === "unknown_product_policy")).toBe(true);
  });
  it("does_not_treat_reference_as_dependency_and_preserves_multiple_evidence_refs", async () => {
    const bundle = await buildRelease(await corpus());
    const evidence = bundle.policies[0].evidenceRefs[0];
    bundle.relations.push({ id: "reference", subjectId: "example-revision", objectId: "template-revision", type: "references", origin: "reference_extraction", evidenceRefs: [evidence, { ...evidence }], releaseId: bundle.manifest.releaseId, reviewStatus: "validated" });
    expect(validateKnowledge(bundle).valid).toBe(true);
    expect(bundle.relations.at(-1)!.evidenceRefs).toHaveLength(2);
    bundle.relations.at(-1)!.type = "change_depends_on";
    expect(validateKnowledge(bundle).errors.some(issue => issue.code === "reference_not_dependency")).toBe(true);
  });
});
