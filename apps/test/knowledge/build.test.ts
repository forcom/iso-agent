import { describe, expect, it } from "vitest";
import { buildRelease, checkBundle, rebaseMappings, sha256, verifyBundle } from "../../packages/knowledge/src/index";
import { corpus } from "./fixture";

describe("knowledge build", () => {
  it("accepts_explicit_guideline_metadata_but_rejects_conflicting_source_identity", async () => {
    const input = await corpus(); const source = input.sources[0];
    source.kind = "guide";
    const markdown = "---\ninformation_type: guideline\ninformation_id: \"EXAMPLE-P\"\n---\n" + new TextDecoder().decode(source.bytes);
    source.bytes = new TextEncoder().encode(markdown); source.sha256 = await sha256(markdown);
    const original = await buildRelease(await corpus());
    const replacement = { ...original.sources.find(item => item.revisionId === source.revisionId)!, kind: "guide" as const, markdown, sha256: source.sha256 };
    const { mappings } = rebaseMappings(original.mappings, original.sources.map(item => item.revisionId === source.revisionId ? replacement : item));
    await expect(buildRelease({ ...input, mappings, candidate: true })).resolves.toBeDefined();
    source.code = "DIFFERENT";
    await expect(buildRelease({ ...input, mappings, candidate: true })).rejects.toThrow(/source_identity/);
  });
  it("keeps_explicit_assessment_targets_separate_from_operational_system_evidence", async () => {
    const input = await corpus();
    input.mappings.productPolicies.push({ id: "synthetic-assessment-decision", title: "Assessment target", origin: "product_policy", sourceUrl: "https://example.invalid/decision", decision: "Use the demonstration service only as an assessment target.", conflicts: [] });
    input.mappings.assessmentTargets = [{ id: "synthetic-assessment-target", name: "Demonstration service", productPolicyId: "synthetic-assessment-decision" }];
    const bundle = await buildRelease(input);
    const target = bundle.entities.find(entity => entity.id === "synthetic-assessment-target")!;
    expect(target.type).toBe("AISystem");
    expect(target.evidenceRefs).toEqual([]);
    expect(target.metadata).toEqual({ origin: "product_policy", productPolicyId: "synthetic-assessment-decision", definitionStatus: "assessment_target", actualOperation: false, scopeStatus: "unconfirmed" });
    expect(bundle.relations.some(relation => [relation.subjectId, relation.objectId].includes(target.id))).toBe(false);
    input.mappings.assessmentTargets[0].productPolicyId = "missing-decision";
    await expect(buildRelease(input)).rejects.toThrow(/assessment_target_origin/);
  });
  it("fails_on_unmapped_record_type", async () => {
    const input = await corpus(); input.mappings.recordTypes = [];
    await expect(buildRelease(input)).rejects.toThrow(/unmapped_record_type/);
  });
  it("fails_on_missing_source_or_policy", async () => {
    const input = await corpus(); input.mappings.policies = [];
    await expect(buildRelease(input)).rejects.toThrow(/missing_policy/);
    const second = await corpus(); second.sources.shift();
    await expect(buildRelease(second)).rejects.toThrow(/missing_source/);
  });
  it("same_inputs_have_same_manifest_hash", async () => {
    const input = await corpus();
    const a = await buildRelease(input); const b = await buildRelease(input);
    expect(a.manifest).toEqual(b.manifest);
    expect(checkBundle(a).valid).toBe(true);
    expect(a.sources.find(source => source.revisionId === input.sources[0].revisionId)!.markdown).toBe(new TextDecoder().decode(input.sources[0].bytes));
  });
  it("rejects_changed_bytes_and_stale_review_or_inexact_quotes", async () => {
    const input = await corpus(); input.sources[0].bytes = new TextEncoder().encode("changed source");
    await expect(buildRelease(input)).rejects.toThrow(/source_hash/);
    const second = await corpus(); second.mappings.policies[0].evidenceRefs[0].quote = "not in source";
    await expect(buildRelease(second)).rejects.toThrow(/quote_mismatch/);
  });
  it("retains_all_evidence_without_generating_reference_dependencies", async () => {
    const input = await corpus(); const bundle = await buildRelease(input);
    expect(bundle.relations.some(relation => relation.type === "change_depends_on")).toBe(false);
    expect(bundle.entities.filter(entity => entity.type === "Template")).toHaveLength(1);
    expect(bundle.entities.some(entity => entity.type === "Person")).toBe(false);
  });
  it("changed_source_rebase_is_only_a_candidate_and_tampering_is_detected", async () => {
    const input = await corpus(); const original = await buildRelease(input);
    const sources = structuredClone(original.sources);
    const source = sources.find(item => item.revisionId === "example-revision")!;
    source.markdown = "New preface\n" + source.markdown;
    source.sha256 = await sha256(source.markdown); source.revisionId = "new-revision";
    const rebased = rebaseMappings(original.mappings, sources);
    expect(rebased.issues.some(issue => issue.code === "source_review_required")).toBe(true);
    expect(rebased.mappings.policies[0].reviewStatus).toBe("candidate");
    expect(rebased.mappings.policies[0].evidenceRefs[0].lineStart).toBe(3);
    const sourceInput = sources.map(({ markdown, textSha256: _textSha256, ...meta }) => ({ ...meta, bytes: new TextEncoder().encode(markdown) }));
    const candidate = await buildRelease({ ...input, sources: sourceInput, mappings: rebased.mappings, candidate: true });
    expect(checkBundle(candidate).valid).toBe(false);
    expect(candidate.manifest.reviewStatus).toBe("candidate");
    original.entities[0].label = "Modified after compilation";
    expect((await verifyBundle(original)).errors.some(issue => issue.code === "bundle_hash")).toBe(true);
  });
  it("same_bytes_new_revision_rebinds_quotes_and_empty_clause_review_cannot_publish", async () => {
    const input = await corpus(); const original = await buildRelease(input);
    const sources = structuredClone(original.sources);
    sources.find(item => item.revisionId === "example-revision")!.revisionId = "same-bytes-new-version";
    const rebased = rebaseMappings(original.mappings, sources);
    expect(rebased.mappings.policies[0].evidenceRefs[0].revisionId).toBe("same-bytes-new-version");
    expect(rebased.mappings.sources.find(item => item.sourceCode === "EXAMPLE-P")!.clauses).toHaveLength(1);
    const missing = await corpus(); missing.mappings.sources[0].clauses = [];
    await expect(buildRelease(missing)).rejects.toThrow(/missing_clause/);
  });
  it("new_sources_need_explicit_mappings_and_policy_changes_change_manifest_hash", async () => {
    const input = await corpus(); const original = await buildRelease(input);
    const markdown = "# 1 New guide\nA second independent coordinator is required.\n";
    const source = { artifactId: "new-guide", revisionId: "new-guide-rev", path: "synthetic/new.md", code: "NEW-G", title: "New synthetic guide", kind: "guide" as const, markdown, sha256: await sha256(markdown), textSha256: await sha256(markdown) };
    const rebased = rebaseMappings(original.mappings, [...original.sources, source]);
    expect(rebased.issues.some(issue => issue.code === "new_source_unmapped")).toBe(true);
    await expect(buildRelease({ ...input, mappings: rebased.mappings, sources: [...input.sources, { ...source, bytes: new TextEncoder().encode(markdown) }] })).rejects.toThrow(/stale_mapping|missing_clause/);
    input.mappings.policies[0].stateCondition = ["new", "draft"];
    const updated = await buildRelease(input);
    expect(updated.manifest.mappingsHash).not.toBe(original.manifest.mappingsHash);
    expect(updated.manifest.manifestHash).not.toBe(original.manifest.manifestHash);
    expect(updated.manifest.releaseId).not.toBe(original.manifest.releaseId);
  });
});
