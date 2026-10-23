import { expect, it } from "vitest";
import type { Relation } from "../../packages/contracts/src/index";
import { KNOWLEDGE_SCHEMA, validateKnowledge } from "../../packages/ontology/src/index";
import { buildRelease, extractSourceClauses, rebaseMappings, sha256 } from "../../packages/knowledge/src/index";
import { corpus } from "../knowledge/fixture";

async function hierarchy() {
  const input = await corpus();
  for (const kind of ["manual", "guide"] as const) {
    const markdown = `# 1 Synthetic ${kind}\nSynthetic hierarchy definition.\n`;
    const source = { artifactId: kind, revisionId: `${kind}-revision`, path: `synthetic/${kind}.md`, code: kind, title: kind, kind, bytes: new TextEncoder().encode(markdown), sha256: await sha256(markdown) };
    input.sources.push(source);
    input.mappings.sources.push({ sourceCode: kind, revisionId: source.revisionId, sourceSha256: source.sha256, reviewStatus: "validated", reviewedBy: "synthetic author", reviewedAt: "2026-01-01", clauses: extractSourceClauses({ ...source, markdown, textSha256: source.sha256 }) });
  }
  const manual = input.sources.find(source => source.kind === "manual")!;
  const evidence = { revisionId: manual.revisionId, sourceSha256: manual.sha256!, lineStart: 2, lineEnd: 2, quote: "Synthetic hierarchy definition." };
  input.mappings.relations = [["example-revision", "manual-revision"], ["guide-revision", "example-revision"]].map(([subjectId, objectId], index) => ({ id: `hierarchy-${index}`, type: "subordinate_to" as Relation["type"], subjectId, objectId, origin: "regulation", evidenceRefs: [evidence], reviewStatus: "validated", releaseId: "" }));
  return input;
}

it("builds three regulation levels and preserves the two explicit hierarchy steps", async () => {
  const bundle = await buildRelease(await hierarchy());
  expect(KNOWLEDGE_SCHEMA).toMatchObject({ regulationHierarchy: { manual: { level: 1 }, procedure: { level: 2 }, guide: { level: 3 } } });
  for (const [kind, level] of [["manual", 1], ["procedure", 2], ["guide", 3]] as const) {
    const source = bundle.sources.find(source => source.kind === kind)!;
    for (const id of [source.artifactId, source.revisionId]) expect(bundle.entities.find(entity => entity.id === id)?.metadata).toMatchObject({ regulationType: kind, hierarchyLevel: level });
  }
  expect(bundle.relations.filter(relation => relation.type === "subordinate_to")).toHaveLength(2);
  const template = bundle.sources.find(source => source.kind === "template")!;
  expect(bundle.entities.find(entity => entity.id === template.artifactId)?.type).toBe("Template");
  for (const id of [template.artifactId, template.revisionId]) {
    const metadata = bundle.entities.find(entity => entity.id === id)?.metadata;
    expect(metadata).toMatchObject({ regulationType: "template", artifactKind: "template" });
    expect(metadata).not.toHaveProperty("hierarchyLevel");
  }
  expect(bundle.relations.some(relation => relation.type === "change_depends_on")).toBe(false);
});

it.each([
  ["manual-revision", "example-revision"], ["guide-revision", "manual-revision"],
  ["example-revision", "example-revision"], ["template-revision", "manual-revision"],
  ["example-revision", "missing-revision"], ["example-procedure", "manual"],
])("rejects invalid hierarchy %s -> %s", async (subjectId, objectId) => {
  const input = await hierarchy(); Object.assign(input.mappings.relations![0], { subjectId, objectId });
  await expect(buildRelease(input)).rejects.toThrow(/invalid_hierarchy:/);
});

it("requires reviewed regulatory evidence and never upgrades ordinary references", async () => {
  for (const patch of [{ evidenceRefs: [] }, { origin: "reference_extraction" }, { origin: "product_policy" }, { reviewStatus: "candidate" }]) {
    const input = await hierarchy(); Object.assign(input.mappings.relations![0], patch);
    await expect(buildRelease(input)).rejects.toThrow(/hierarchy_evidence:|unreviewed_hierarchy:/);
  }
  const input = await hierarchy(); input.mappings.relations!.forEach(relation => { relation.type = "references"; });
  const bundle = await buildRelease(input);
  expect(bundle.relations.some(relation => relation.type === "subordinate_to")).toBe(false);
});

it("allows multiple parents and checks their source kinds rather than forged metadata", async () => {
  const input = await hierarchy();
  const manual = input.sources.find(source => source.kind === "manual")!;
  input.sources.push({ ...manual, artifactId: "manual-2", revisionId: "manual-2-revision", code: "manual-2", path: "synthetic/manual-2.md" });
  input.mappings.sources.push({ ...input.mappings.sources.find(source => source.sourceCode === "manual")!, sourceCode: "manual-2", revisionId: "manual-2-revision" });
  input.mappings.relations!.push({ ...input.mappings.relations![0], id: "second-parent", objectId: "manual-2-revision" });
  const bundle = await buildRelease(input);
  expect(bundle.relations.filter(relation => relation.type === "subordinate_to" && relation.subjectId === "example-revision")).toHaveLength(2);
  bundle.sources.find(source => source.kind === "manual")!.kind = "guide";
  expect(validateKnowledge(bundle).errors.some(issue => issue.code === "invalid_hierarchy")).toBe(true);
});

it("rebases both hierarchy endpoints and reopens review even with unchanged third-party evidence", async () => {
  const bundle = await buildRelease(await hierarchy());
  const sources = structuredClone(bundle.sources);
  sources.find(source => source.kind === "procedure")!.revisionId = "new-procedure-revision";
  const result = rebaseMappings(bundle.mappings, sources);
  expect(result.mappings.relations).toEqual(expect.arrayContaining([
    expect.objectContaining({ subjectId: "new-procedure-revision", objectId: "manual-revision", reviewStatus: "candidate" }),
    expect.objectContaining({ subjectId: "guide-revision", objectId: "new-procedure-revision", reviewStatus: "candidate" }),
  ]));
});
