import type { BuildInput, Entity, EvidenceRef, KnowledgeBundle, Relation, SourceRevision, ValidationReport } from "../../contracts/src/index";
import { checkBundle } from "./validate";

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b, "en")).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
export async function sha256(value: Uint8Array | string): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)))).map(byte => byte.toString(16).padStart(2, "0")).join("");
}
export function sourcePathAllowed(path: string, mode: "production" | "synthetic"): boolean {
  if (path.includes("\\") || path.split("/").some(segment => segment === "." || segment === "..")) return false;
  return mode === "synthetic" ? /^synthetic\/[\w./-]+\.md$/.test(path) : /^docs\/(manual|procedure|guide|forms)\/[^/]+\.md$/.test(path);
}
const derivedId = async (value: string): Promise<string> => {
  const hash = await sha256(value);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
};

export async function buildRelease(input: BuildInput): Promise<KnowledgeBundle> {
  const sources: SourceRevision[] = [];
  for (const source of input.sources) {
    if (!sourcePathAllowed(source.path, input.sourceMode ?? "production")) throw new Error(`source_path: ${source.path}`);
    const hash = await sha256(source.bytes);
    if (source.sha256 && source.sha256 !== hash) throw new Error(`source_hash: ${source.code}`);
    let markdown: string;
    try { markdown = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(source.bytes).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n"); } catch { throw new Error(`source_utf8: ${source.code}`); }
    const declaredCode = markdown.match(/^information_id:\s*["']?([^\n"']+)["']?\s*$/m)?.[1]?.trim();
    if (declaredCode && declaredCode !== source.code) throw new Error(`source_identity: ${source.code}`);
    const declaredKind = markdown.match(/^information_type:\s*["']?([^\n"']+)["']?\s*$/m)?.[1]?.trim();
    const declaredSourceKind = declaredKind === "guideline" ? "guide" : declaredKind === "form" ? "template" : declaredKind;
    if (source.kind !== "index" && declaredSourceKind && declaredSourceKind !== source.kind) throw new Error(`source_kind: ${source.code}`);
    const { bytes: _bytes, ...meta } = source;
    sources.push({ ...meta, sha256: hash, textSha256: await sha256(markdown), markdown });
  }
  sources.sort((a, b) => a.code.localeCompare(b.code, "en"));
  const mappings = structuredClone(input.mappings);
  const sourcesHash = await sha256(canonical(sources.map(({ markdown: _markdown, ...source }) => source)));
  const mappingsHash = await sha256(canonical(mappings)); const rulesHash = await sha256(input.rules); const schemaHash = await sha256(input.schema);
  // Candidate builds rewrite review states, so they get their own ID; installed release IDs stay unchanged.
  const releaseId = await derivedId(canonical({ sourcesHash, mappingsHash, rulesHash, schemaHash, schemaVersion: input.schemaVersion, ...(input.candidate ? { candidate: true } : {}) }));
  const entities: Entity[] = []; const relations: Relation[] = [];
  const relation = async (subjectId: string, type: Relation["type"], objectId: string, evidenceRefs: EvidenceRef[], origin: Relation["origin"] = "regulation", condition?: string, conditionStatus?: Relation["conditionStatus"]) => relations.push({ id: await derivedId(`${releaseId}:${subjectId}:${type}:${objectId}`), subjectId, type, objectId, evidenceRefs, origin, releaseId, reviewStatus: "validated", evidenceStatus: "verified", ...(condition ? { condition, conditionStatus } : {}) });
  const wiki: KnowledgeBundle["wiki"] = [];
  let clauseCount = 0;
  for (const source of sources) {
    if (source.kind === "index") continue;
    const lines = source.markdown.split("\n");
    const ref = (start: number, end: number): EvidenceRef => ({ revisionId: source.revisionId, sourceSha256: source.sha256, lineStart: start, lineEnd: end, quote: lines.slice(start - 1, end).join("\n") });
    const artifactKind = source.kind === "template" ? "template" : "regulation";
    entities.push({ id: source.artifactId, type: source.kind === "template" ? "Template" : "Regulation", label: source.title, evidenceRefs: [], metadata: { documentCode: source.code, artifactKind, regulationType: source.kind, effectiveRevisionId: source.revisionId } });
    entities.push({ id: source.revisionId, type: "ArtifactRevision", label: `${source.code} 원문`, evidenceRefs: [], metadata: { artifactId: source.artifactId, artifactKind, sha256: source.sha256, sourcePath: source.path } });
    await relation(source.artifactId, "has_revision", source.revisionId, [ref(1, 1)], "explicit_metadata");
    const mapping = mappings.sources.find(item => item.sourceCode === source.code);
    const claims: KnowledgeBundle["wiki"][number]["claims"] = [];
    if (source.kind !== "template") for (const clause of mapping?.clauses ?? []) {
      if (clause.treatment === "not_applicable") continue;
      const evidenceRefs = [ref(clause.lineStart, clause.lineEnd)];
      const clauseId = await derivedId(`${source.revisionId}:clause:${clause.clause}`);
      entities.push({ id: clauseId, type: "Clause", label: `${source.code} ${clause.clause}`, evidenceRefs, metadata: { clause: clause.clause, revisionId: source.revisionId, reviewReason: clause.reason } });
      await relation(source.revisionId, "contains_clause", clauseId, evidenceRefs); clauseCount++;
      if (/하여야|한다\.|아니 된다|책임|권한/.test(evidenceRefs[0].quote)) {
        const requirementId = await derivedId(`${clauseId}:requirement`);
        entities.push({ id: requirementId, type: "Requirement", label: `${source.code} ${clause.clause}`, evidenceRefs, metadata: { text: evidenceRefs[0].quote, status: "normative_definition" } });
        await relation(clauseId, "states_requirement", requirementId, evidenceRefs);
      }
      claims.push({ id: await derivedId(`${clauseId}:claim`), heading: clause.clause, text: evidenceRefs[0].quote, evidenceRefs, origin: "regulation", reviewStatus: "validated" });
    }
    if (claims.length) wiki.push({ id: await derivedId(`${source.artifactId}:wiki`), title: source.title, claims, releaseId });
    for (let i = 0; i < lines.length; i++) {
      const mentioned = new Set(lines[i].match(/AIDU-(?:AIM|AIP|AIG)-\d{2}(?:-\d{2})?(?:-F\d{2})?/g) ?? []);
      for (const code of mentioned) {
        const target = sources.find(candidate => candidate.code === code && candidate.kind !== "index");
        if (!target || target.artifactId === source.artifactId) continue;
        const existing = relations.find(item => item.subjectId === source.revisionId && item.objectId === target.artifactId && item.type === "references");
        if (existing) existing.evidenceRefs.push(ref(i + 1, i + 1));
        else await relation(source.revisionId, "references", target.artifactId, [ref(i + 1, i + 1)], "reference_extraction");
      }
    }
  }
  for (const role of mappings.roles) entities.push({ id: role.id, type: "FunctionalRole", label: role.name, evidenceRefs: role.evidenceRefs });
  for (const target of mappings.assessmentTargets ?? []) entities.push({ id: target.id, type: "AISystem", label: target.name, evidenceRefs: [], metadata: { origin: "product_policy", productPolicyId: target.productPolicyId, definitionStatus: "assessment_target", actualOperation: false, scopeStatus: "unconfirmed" } });
  for (const type of mappings.recordTypes) {
    entities.push({ id: type.id, type: "RecordType", label: type.name, evidenceRefs: type.evidenceRefs, metadata: { code: type.code, approvalRequired: type.approvalRequired, reviewRequired: type.reviewRequired } });
    const activityId = await derivedId(`${type.id}:activity`);
    entities.push({ id: activityId, type: "ActivityDefinition", label: type.name, evidenceRefs: type.evidenceRefs, metadata: { applicability: type.applicability, actualWork: false } });
    const procedure = sources.find(source => source.code === type.procedureCode);
    if (procedure) { await relation(type.id, "governed_by", procedure.revisionId, type.evidenceRefs); await relation(activityId, "governed_by", procedure.revisionId, type.evidenceRefs); }
    await relation(activityId, "requires_record_type", type.id, type.evidenceRefs, "regulation", type.applicability, type.applicabilityCondition ? "unknown" : "met");
  }
  const policies = mappings.policies.map(policy => ({ ...policy, effectiveReleaseId: releaseId }));
  for (const policy of policies) {
    entities.push({ id: policy.id, type: "ActionPolicy", label: `${policy.resourceTypeId} · ${policy.action}`, evidenceRefs: policy.evidenceRefs, metadata: { action: policy.action, scopeCondition: policy.scopeCondition, stateCondition: policy.stateCondition, separationCondition: policy.separationCondition, decisionKind: policy.decisionKind } });
    if (mappings.roles.some(role => role.id === policy.roleId)) await relation(policy.id, "policy_role", policy.roleId, policy.evidenceRefs, policy.origin);
    if (mappings.recordTypes.some(type => type.id === policy.resourceTypeId)) await relation(policy.id, "policy_resource_type", policy.resourceTypeId, policy.evidenceRefs, policy.origin);
  }
  relations.push(...(mappings.relations ?? []).map(item => ({ ...item, releaseId })));
  const bundle: KnowledgeBundle = { manifest: { releaseId, manifestHash: "", sourcesHash, mappingsHash, rulesHash, schemaHash, schemaVersion: input.schemaVersion, reviewStatus: "validated", sourceCount: sources.length, recordTypeCount: mappings.recordTypes.length }, sources, entities, relations, policies, recordTypes: mappings.recordTypes, roles: mappings.roles, wiki, productPolicies: mappings.productPolicies, mappings, coverage: { sourceCount: sources.length, clauseCount, recordTypeCount: mappings.recordTypes.length, policyCount: policies.length, unresolved: [], excludedSources: sources.filter(source => source.kind === "index").map(source => source.path), reviewScope: mappings.reviewScope } };
  const validation = checkBundle(bundle);
  if (!validation.valid && !input.candidate) throw new Error(validation.errors.map(error => `${error.code}: ${error.path}: ${error.message}`).join("\n"));
  if (!validation.valid || input.candidate) {
    bundle.manifest.reviewStatus = "candidate";
    bundle.coverage.unresolved = validation.errors;
    bundle.relations.forEach(item => { item.reviewStatus = "candidate"; });
    bundle.wiki.forEach(page => page.claims.forEach(claim => { claim.reviewStatus = "candidate"; }));
  }
  bundle.manifest.manifestHash = await sha256(canonical(bundle));
  return bundle;
}

export async function verifyBundle(bundle: KnowledgeBundle): Promise<ValidationReport> {
  const result = checkBundle(bundle);
  const copy = structuredClone(bundle); copy.manifest.manifestHash = "";
  if (await sha256(canonical(copy)) !== bundle.manifest.manifestHash) result.errors.push({ code: "bundle_hash", path: "manifest", message: "Bundle contents changed after compilation" });
  // Bundles carry the normalized text (LF, no BOM) that quotes use; the raw byte digest stays in sha256.
  for (const source of bundle.sources) if (await sha256(source.markdown) !== source.textSha256) result.errors.push({ code: "source_hash", path: source.code, message: "Source text does not match stored digest" });
  if (await sha256(canonical(bundle.mappings)) !== bundle.manifest.mappingsHash) result.errors.push({ code: "mappings_hash", path: "mappings", message: "Mapping content changed" });
  result.valid = result.errors.length === 0;
  return result;
}
