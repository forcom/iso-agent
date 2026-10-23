import type { ReviewedMappings, ValidationIssue } from "../../contracts/src/index";
import { canonical } from "./build";

const FIELDS = ["sources", "recordTypes", "roles", "policies", "relations"] as const;
type Field = (typeof FIELDS)[number];
type Row = Record<string, unknown>;
const keyOf = (field: Field, item: Row) => String(field === "sources" ? item.sourceCode : item.id);
// Only contract-defined references establish scope; descriptions, identities and unknown metadata do not.
function cites(field: Field, item: Row, changed: Set<string>): boolean {
  const matches = (id: unknown) => typeof id === "string" && changed.has(id);
  const evidence = (value: unknown) => !!value && typeof value === "object" && Array.isArray((value as Row).evidenceRefs)
    && ((value as Row).evidenceRefs as Row[]).some(ref => ref && matches(ref.revisionId));
  if (field === "sources") return matches(item.revisionId);
  if (evidence(item)) return true;
  if (field === "recordTypes") return matches(item.templateArtifactId) || matches(item.templateRevisionId)
    || [item.approvalCondition, item.reviewCondition, item.applicabilityCondition].some(evidence)
    || Array.isArray(item.actionCoverage) && item.actionCoverage.some(evidence);
  if (field === "policies") return matches(item.resourceTypeId) || Array.isArray(item.conditions) && item.conditions.some(evidence);
  if (field === "relations") return matches(item.subjectId) || matches(item.objectId);
  return false;
}

/**
 * Applies an LLM extraction to rebased mappings. Only items that rebasing already reopened as
 * candidates, or that refer to a changed revision or artifact (or to a record type reopened that
 * way), may be edited or removed. A new item must refer to one of them. Other proposals are
 * ignored and reported, so unchanged regulations keep the mappings that were reviewed for them.
 */
export function mergeExtraction(base: ReviewedMappings, patch: Partial<Record<(typeof FIELDS)[number], Row[]>>, changedIds: string[]): { mappings: ReviewedMappings; issues: ValidationIssue[] } {
  const changed = new Set(changedIds); const mappings = structuredClone(base); const issues: ValidationIssue[] = [];
  const open = (field: Field, item: Row) => item.reviewStatus === "candidate" || cites(field, item, changed);
  for (const type of mappings.recordTypes as unknown as Row[]) if (open("recordTypes", type)) changed.add(String(type.id));
  const asCandidate = (field: Field, item: Row): Row => field === "sources" ? { ...item, reviewStatus: "candidate", reviewedBy: "", reviewedAt: "" } : field === "roles" ? item : { ...item, reviewStatus: "candidate" };
  for (const field of FIELDS) {
    const proposed = patch[field]; if (proposed === undefined) continue;
    const remaining = new Map(proposed.map(item => [keyOf(field, item), item]));
    const next: Row[] = [];
    for (const item of (mappings[field] ?? []) as unknown as Row[]) {
      const key = keyOf(field, item), replacement = remaining.get(key); remaining.delete(key);
      if (!open(field, item)) {
        if (!replacement) issues.push({ code: "out_of_scope_removal_ignored", path: `${field}:${key}`, message: "Extraction omitted a mapping of an unchanged source; the reviewed mapping is kept" });
        else if (canonical(replacement) !== canonical(item)) issues.push({ code: "out_of_scope_edit_ignored", path: `${field}:${key}`, message: "Extraction tried to change a mapping of an unchanged source; the reviewed mapping is kept" });
        next.push(item);
      } else if (replacement) next.push(asCandidate(field, replacement));
      else issues.push({ code: "candidate_removed", path: `${field}:${key}`, message: "Extraction removed a mapping of a changed source; confirm the removal in review" });
    }
    for (const [key, item] of remaining) {
      if (cites(field, item, changed)) next.push(asCandidate(field, item));
      else issues.push({ code: "out_of_scope_addition_ignored", path: `${field}:${key}`, message: "A new mapping must refer to a changed source" });
    }
    (mappings as unknown as Record<string, Row[]>)[field] = next;
  }
  return { mappings, issues };
}
