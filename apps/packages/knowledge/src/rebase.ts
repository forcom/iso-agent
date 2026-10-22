import type { EvidenceRef, ReviewedMapping, ReviewedMappings, SourceRevision, ValidationIssue } from "../../contracts/src/index";

export function extractSourceClauses(source: SourceRevision): ReviewedMapping["clauses"] {
  const lines = source.markdown.split("\n");
  const headings: Array<{ start: number; clause: string }> = [];
  lines.forEach((line, index) => {
    const match = line.match(/^#{1,6}\s+(.+)$/);
    if (match) headings.push({ start: index, clause: match[1].match(/^((?:\d+\.)*\d+)(?:\s|$)/)?.[1] ?? `제목:${match[1]}@${index + 1}` });
  });
  return headings.map((heading, index) => {
    let end = headings[index + 1]?.start ?? lines.length;
    while (end > heading.start + 1 && !lines[end - 1].trim()) end--;
    return { clause: heading.clause, lineStart: heading.start + 1, lineEnd: end, treatment: source.kind === "template" || source.kind === "index" || end === heading.start + 1 ? "not_applicable" : "defined", reason: "새 원문 구역의 후보 추출. 규범·목차·작성 구조의 구분과 권한 매핑을 검토한 후 확정하여야 한다." };
  });
}

/** Moving an unchanged quotation is only candidate extraction, never renewed regulatory approval. */
export function rebaseMappings(base: ReviewedMappings, sources: SourceRevision[]): { mappings: ReviewedMappings; issues: ValidationIssue[] } {
  const mappings = structuredClone(base); const issues: ValidationIssue[] = [];
  const changed = new Map<string, SourceRevision>(); const changedCodes = new Set<string>();
  for (const mapping of mappings.sources) {
    const source = sources.find(item => item.code === mapping.sourceCode);
    if (!source) { issues.push({ code: "missing_source", path: mapping.sourceCode, message: "Removed source requires explicit reconciliation" }); mapping.reviewStatus = "candidate"; continue; }
    const oldRevision = mapping.revisionId ?? base.policies.flatMap(policy => policy.evidenceRefs).find(ref => ref.sourceSha256 === mapping.sourceSha256)?.revisionId;
    if (source.sha256 === mapping.sourceSha256 && (!oldRevision || oldRevision === source.revisionId)) continue;
    changedCodes.add(source.code);
    changed.set(source.revisionId, source);
    if (mapping.revisionId) changed.set(mapping.revisionId, source);
    const oldHash = mapping.sourceSha256;
    const collect = (value: unknown): void => {
      if (Array.isArray(value)) { value.forEach(collect); return; }
      if (!value || typeof value !== "object") return;
      const object = value as Record<string, unknown>;
      if (object.sourceSha256 === oldHash && typeof object.revisionId === "string") changed.set(object.revisionId, source);
      Object.values(object).forEach(collect);
    };
    collect(base);
    mapping.sourceSha256 = source.sha256; mapping.revisionId = source.revisionId; mapping.reviewStatus = "candidate"; mapping.reviewedBy = ""; mapping.reviewedAt = "";
    mapping.clauses = extractSourceClauses(source);
    issues.push({ code: "source_review_required", path: source.code, message: "Changed source needs complete clause and permission review; previous review cannot be reused" });
  }
  for (const source of sources) if (!mappings.sources.some(item => item.sourceCode === source.code)) {
    mappings.sources.push({ sourceCode: source.code, sourceSha256: source.sha256, revisionId: source.revisionId, reviewStatus: "candidate", reviewedBy: "", reviewedAt: "", clauses: [] });
    changedCodes.add(source.code);
    issues.push({ code: "new_source_unmapped", path: source.code, message: "New regulation or template requires reviewed clause/type/action mappings" });
  }
  const rebase = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.map(rebase).some(Boolean);
    if (!value || typeof value !== "object") return false;
    const object = value as Record<string, unknown>;
    if (typeof object.revisionId === "string" && typeof object.quote === "string" && "lineStart" in object) {
      const source = changed.get(object.revisionId);
      if (!source) return false;
      const ref = object as unknown as EvidenceRef;
      const lines = source.markdown.split("\n"); const quoted = ref.quote.split("\n"); const starts: number[] = [];
      for (let index = 0; index <= lines.length - quoted.length; index++) if (lines.slice(index, index + quoted.length).join("\n") === ref.quote) starts.push(index);
      if (starts.length !== 1) issues.push({ code: starts.length ? "ambiguous_quote" : "missing_quote", path: source.code, message: "Changed source quotation requires explicit review and cannot be guessed" });
      else { ref.revisionId = source.revisionId; ref.sourceSha256 = source.sha256; ref.lineStart = starts[0] + 1; ref.lineEnd = starts[0] + quoted.length; }
      return true;
    }
    const touched = Object.values(object).map(rebase).some(Boolean);
    if (touched && "reviewStatus" in object) object.reviewStatus = "candidate";
    return touched;
  };
  rebase(mappings.roles); rebase(mappings.policies); rebase(mappings.recordTypes); rebase(mappings.productPolicies); rebase(mappings.relations);
  for (const type of mappings.recordTypes) {
    const template = sources.find(source => source.artifactId === type.templateArtifactId);
    if (template && template.revisionId !== type.templateRevisionId) { type.templateRevisionId = template.revisionId; type.reviewStatus = "candidate"; }
    if (changedCodes.has(type.procedureCode)) type.reviewStatus = "candidate";
  }
  return { mappings, issues };
}
