import { describe, expect, it } from "vitest";
import { buildRelease, validateDeploymentPreparation } from "../../packages/knowledge/src/index";
import { corpus } from "./fixture";

describe("knowledge coverage", () => {
  it("excludes_test_or_seed_paths", async () => {
    for (const path of ["apps/test/fixtures/a.md", "apps/seed/inputs/a.md", "docs/records/a.md", "docs/manual/../../apps/test/a.md", "output/a.md", ".raw/a.md"]) {
      const input = await corpus(); input.sourceMode = "production"; input.sources[0].path = path;
      await expect(buildRelease(input)).rejects.toThrow(/source_path/);
    }
  });
  it("fails_unresolved_action_and_missing_source_review", async () => {
    const input = await corpus(); input.mappings.recordTypes[0].actionCoverage[0].status = "unresolved";
    await expect(buildRelease(input)).rejects.toThrow(/unresolved/);
    const second = await corpus(); second.mappings.sources[0].sourceSha256 = "wrong";
    await expect(buildRelease(second)).rejects.toThrow(/stale_mapping/);
  });
  it("does_not_fill_missing_people_or_operator_from_personas", () => {
    const result = validateDeploymentPreparation({ environment: "development", persons: [], assignments: [], operatorDesignation: null });
    expect(result.valid).toBe(false);
    expect(result.errors.some(issue => issue.code === "operator_unassigned")).toBe(true);
  });
  it("requires_a_defined_review_policy_for_every_mandatory_review_role", async () => {
    const input = await corpus(); input.mappings.recordTypes[0].requiredReviewRoleIds = ["missing-independent-reviewer"];
    await expect(buildRelease(input)).rejects.toThrow(/required_review_policy/);
  });
  it("initial_external_assignments_cannot_claim_an_application_approval_event", () => {
    const result = validateDeploymentPreparation({ environment: "iso-test", operatorDesignation: null, persons: [{ id: "confirmed-person", name: "Synthetic person", active: true, evidenceId: "synthetic-employment" }], assignments: [{ id: "external-assignment", personId: "confirmed-person", roleId: "synthetic-role", scope: { kind: "all", ids: [] }, validFrom: "2026-01-01", status: "active", approvedRevisionId: "external-revision", approvalDecisionId: "nonexistent-application-decision", evidenceRefs: [{ revisionId: "external-revision", sourceSha256: "synthetic-hash", lineStart: 1, lineEnd: 1, quote: "Synthetic designation" }] }] });
    expect(result.errors.some(issue => issue.code === "external_designation_only")).toBe(true);
  });
});
