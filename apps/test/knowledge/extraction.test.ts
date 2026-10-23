import { expect, it } from "vitest";
import { buildRelease, mergeExtraction } from "../../packages/knowledge/src/index";
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
