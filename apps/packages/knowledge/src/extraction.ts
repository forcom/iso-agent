import type { ReviewedMappings, ValidationIssue } from "../../contracts/src/index";
import { canonical } from "./build";

const FIELDS = ["sources", "recordTypes", "roles", "policies", "relations"] as const;
type Row = Record<string, unknown>;
const keyOf = (field: (typeof FIELDS)[number], item: Row) => String(field === "sources" ? item.sourceCode : item.id);
// Any ID field naming a changed revision, artifact or reopened record type puts the item in scope.
const cites = (value: unknown, changed: Set<string>): boolean => typeof value === "string" ? changed.has(value)
  : Array.isArray(value) ? value.some(item => cites(item, changed))
  : !!value && typeof value === "object" && Object.values(value).some(item => cites(item, changed));

/**
 * Applies an LLM extraction to rebased mappings. Only items that rebasing already reopened as
 * candidates, or that refer to a changed revision or artifact (or to a record type reopened that
 * way), may be edited or removed. A new item must refer to one of them. Other proposals are
 * ignored and reported, so unchanged regulations keep the mappings that were reviewed for them.
 */
export function mergeExtraction(base: ReviewedMappings, patch: Partial<Record<(typeof FIELDS)[number], Row[]>>, changedIds: string[]): { mappings: ReviewedMappings; issues: ValidationIssue[] } {
  const changed = new Set(changedIds); const mappings = structuredClone(base); const issues: ValidationIssue[] = [];
  const open = (item: Row) => item.reviewStatus === "candidate" || cites(item, changed);
  for (const type of mappings.recordTypes as unknown as Row[]) if (open(type)) changed.add(String(type.id));
  const asCandidate = (field: (typeof FIELDS)[number], item: Row): Row => field === "sources" ? { ...item, reviewStatus: "candidate", reviewedBy: "", reviewedAt: "" } : field === "roles" ? item : { ...item, reviewStatus: "candidate" };
  for (const field of FIELDS) {
    const proposed = patch[field]; if (proposed === undefined) continue;
    const remaining = new Map(proposed.map(item => [keyOf(field, item), item]));
    const next: Row[] = [];
    for (const item of (mappings[field] ?? []) as unknown as Row[]) {
      const key = keyOf(field, item), replacement = remaining.get(key); remaining.delete(key);
      if (!open(item)) {
        if (!replacement) issues.push({ code: "out_of_scope_removal_ignored", path: `${field}:${key}`, message: "Extraction omitted a mapping of an unchanged source; the reviewed mapping is kept" });
        else if (canonical(replacement) !== canonical(item)) issues.push({ code: "out_of_scope_edit_ignored", path: `${field}:${key}`, message: "Extraction tried to change a mapping of an unchanged source; the reviewed mapping is kept" });
        next.push(item);
      } else if (replacement) next.push(asCandidate(field, replacement));
      else issues.push({ code: "candidate_removed", path: `${field}:${key}`, message: "Extraction removed a mapping of a changed source; confirm the removal in review" });
    }
    for (const [key, item] of remaining) {
      if (cites(item, changed)) next.push(asCandidate(field, item));
      else issues.push({ code: "out_of_scope_addition_ignored", path: `${field}:${key}`, message: "A new mapping must refer to a changed source" });
    }
    (mappings as unknown as Record<string, Row[]>)[field] = next;
  }
  return { mappings, issues };
}
