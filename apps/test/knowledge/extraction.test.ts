import { expect, it } from "vitest";
import { buildRelease, checkBundle, mergeExtraction } from "../../packages/knowledge/src/index";
import { corpus } from "./fixture";

it("extraction_edits_only_mappings_of_changed_sources", async () => {
  const { mappings } = await corpus();
  const changedRevision = "example-revision", inScope = mappings.policies[0];
  // A reviewed policy of another, unchanged source and record type.
  const outOfScope = { ...inScope, id: "other-policy", resourceTypeId: "other-type", evidenceRefs: [{ ...inScope.evidenceRefs[0], revisionId: "other-revision" }] };
  mappings.policies.push(outOfScope);
  const patch = { policies: [
    ...mappings.policies.map(policy => policy.id === inScope.id || policy.id === outOfScope.id ? { ...policy, roleId: "llm-role" } : policy),
    { ...inScope, id: "new-cited", roleId: "llm-role" },
    { ...outOfScope, id: "new-uncited", roleId: "llm-role" },
  ] };
  const { mappings: merged, issues } = mergeExtraction(mappings, patch as never, [changedRevision]);
  const byId = new Map(merged.policies.map(policy => [policy.id, policy]));
  expect(byId.get(inScope.id)).toMatchObject({ roleId: "llm-role", reviewStatus: "candidate" });
  expect(byId.get(outOfScope.id)).toEqual(outOfScope);
  expect(byId.get("new-cited")?.reviewStatus).toBe("candidate");
  expect(byId.has("new-uncited")).toBe(false);
  expect(issues.map(issue => issue.code)).toEqual(expect.arrayContaining(["out_of_scope_edit_ignored", "out_of_scope_addition_ignored"]));
  // Omitting an unchanged mapping cannot delete it.
  const omitted = mergeExtraction(mappings, { policies: [] } as never, [changedRevision]);
  expect(omitted.mappings.policies.some(policy => policy.id === outOfScope.id)).toBe(true);
  expect(omitted.mappings.policies.some(policy => policy.id === inScope.id)).toBe(false);
});

it("candidate_and_validated_builds_of_the_same_inputs_get_distinct_release_ids", async () => {
  const validated = await buildRelease(await corpus());
  const candidate = await buildRelease({ ...(await corpus()), candidate: true });
  expect(candidate.manifest.releaseId).not.toBe(validated.manifest.releaseId);
  expect((await buildRelease(await corpus())).manifest.releaseId).toBe(validated.manifest.releaseId);
});

it("ignores changed IDs in descriptions and unknown metadata when deciding extraction scope", async () => {
  const input = await corpus(), changed = "unrelated-guide-revision";
  const original = input.mappings.policies[0];
  const proposals = [
    { ...original, id: "metadata-policy", extractionNote: changed },
    { ...original, id: "nested-metadata-policy", metadata: { evidenceRefs: [{ revisionId: changed }] } },
    { ...original, id: "quote-policy", evidenceRefs: [{ ...original.evidenceRefs[0], quote: changed }] },
    { ...original, id: changed },
  ];
  const result = mergeExtraction(input.mappings, { policies: [...input.mappings.policies, ...proposals] } as never, [changed]);
  expect(result.mappings.policies.map(policy => policy.id)).toEqual(["policy-create"]);
  expect(result.issues.filter(issue => issue.code === "out_of_scope_addition_ignored")).toHaveLength(4);
  const validated = await buildRelease({ ...input, mappings: result.mappings });
  expect(checkBundle(validated).valid).toBe(true);
  expect(validated.policies.map(policy => policy.id)).toEqual(["policy-create"]);
});

it("keeps unchanged mappings even when their descriptions contain a changed ID", async () => {
  const { mappings } = await corpus(), changed = "unrelated-guide-revision";
  mappings.roles[0].name = changed;
  const original = structuredClone(mappings.roles[0]);
  const edited = mergeExtraction(mappings, { roles: [{ ...original, name: "LLM replacement" }] }, [changed]);
  expect(edited.mappings.roles).toEqual([original]);
  expect(edited.issues).toContainEqual(expect.objectContaining({ code: "out_of_scope_edit_ignored", path: "roles:coordinator" }));
  const omitted = mergeExtraction(mappings, { roles: [] }, [changed]);
  expect(omitted.mappings.roles).toEqual([original]);
});

it("accepts explicit source, template, evidence and relation references to changed inputs", async () => {
  const { mappings } = await corpus();
  const evidence = { ...mappings.roles[0].evidenceRefs[0], revisionId: "changed-revision" };
  const result = mergeExtraction(mappings, {
    sources: [...mappings.sources, { ...mappings.sources[0], sourceCode: "NEW-SOURCE", revisionId: "changed-revision" }],
    recordTypes: [...mappings.recordTypes, { ...mappings.recordTypes[0], id: "new-type", templateArtifactId: "changed-template" }],
    roles: [...mappings.roles, { id: "new-role", name: "New role", evidenceRefs: [evidence] }],
    policies: [...mappings.policies, { ...mappings.policies[0], id: "new-policy", conditions: [{ field: "test", equals: true, reason: "Changed condition", evidenceRefs: [evidence] }] }],
    relations: [{ id: "new-relation", subjectId: "changed-revision", objectId: "example-procedure", type: "references", evidenceRefs: [] }],
  } as never, ["changed-revision", "changed-template"]);
  expect(result.mappings.sources.some(item => item.sourceCode === "NEW-SOURCE")).toBe(true);
  expect(result.mappings.recordTypes.some(item => item.id === "new-type")).toBe(true);
  expect(result.mappings.roles.some(item => item.id === "new-role")).toBe(true);
  expect(result.mappings.policies.some(item => item.id === "new-policy")).toBe(true);
  expect(result.mappings.relations?.some(item => item.id === "new-relation")).toBe(true);
});
