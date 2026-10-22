import typesJson from "../types.json" with { type: "json" };
import relationsJson from "../relations.json" with { type: "json" };
import permissionsJson from "../permissions.json" with { type: "json" };

export type EntityType = (typeof typesJson.types)[number]["id"];

export interface OntologyFact {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  knowledge_kind: "normative" | "record";
  status: "draft" | "approved" | "rejected" | "auto_approved";
  quote?: string;
  source_document_id?: string;
  revision?: string;
  source_sha?: string;
}

export interface GraphEdge {
  subject: string;
  predicate: string;
  object: string;
  factId: string;
}

export const ENTITY_TYPES = typesJson.types;
export const RELATIONS = relationsJson.relations;
export const PERMISSIONS = permissionsJson.permissions;
export const ROLE_GRANTS = permissionsJson.role_grants;

export function relationById(id: string) {
  return RELATIONS.find((r) => r.id === id);
}

export function validateFactTypes(
  subjectType: string,
  predicate: string,
  objectType: string,
): { ok: true } | { ok: false; error: string } {
  const rel = relationById(predicate);
  if (!rel) return { ok: false, error: `unknown predicate: ${predicate}` };
  if (!rel.subject_types.includes(subjectType)) {
    return {
      ok: false,
      error: `${predicate} does not allow subject type ${subjectType}`,
    };
  }
  if (!rel.object_types.includes(objectType)) {
    return {
      ok: false,
      error: `${predicate} does not allow object type ${objectType}`,
    };
  }
  return { ok: true };
}

/** In-worker Wirelog-compatible evaluation over approved edges. */
export class OntologyEngine {
  private edges: GraphEdge[];
  private entityTypes: Map<string, string>;

  constructor(facts: OntologyFact[], entityTypes: Map<string, string> = new Map()) {
    this.edges = facts
      .filter((f) => f.status === "approved" || f.status === "auto_approved")
      .map((f) => ({
        subject: f.subject,
        predicate: f.predicate,
        object: f.object,
        factId: f.id,
      }));
    this.entityTypes = entityTypes;
  }

  direct(predicate?: string): GraphEdge[] {
    return predicate
      ? this.edges.filter((e) => e.predicate === predicate)
      : [...this.edges];
  }

  /** Same-predicate reachability (Wirelog reach/3). */
  reach(start: string, predicate: string): { node: string; path: string[] }[] {
    const results: { node: string; path: string[] }[] = [];
    const seen = new Set<string>();
    const queue: { node: string; path: string[] }[] = [{ node: start, path: [] }];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const e of this.edges) {
        if (e.predicate !== predicate || e.subject !== cur.node) continue;
        if (seen.has(e.object)) continue;
        seen.add(e.object);
        const path = [...cur.path, e.factId];
        results.push({ node: e.object, path });
        queue.push({ node: e.object, path });
      }
    }
    return results;
  }

  /** Who depends on root (reverse depends_on). */
  impactSet(root: string): { node: string; path: string[] }[] {
    const results: { node: string; path: string[] }[] = [];
    const seen = new Set<string>([root]);
    const queue: { node: string; path: string[] }[] = [{ node: root, path: [] }];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const e of this.edges) {
        if (e.predicate !== "depends_on" || e.object !== cur.node) continue;
        if (seen.has(e.subject)) continue;
        seen.add(e.subject);
        const path = [...cur.path, e.factId];
        results.push({ node: e.subject, path });
        queue.push({ node: e.subject, path });
      }
    }
    return results;
  }

  /**
   * evidence_candidate(R, Req):
   * addresses(Doc,Req), requires_record(Doc,T), instance_of(Rec,T)
   * OR evidence_for(Rec, Req)
   */
  evidenceCandidates(requirementId?: string): {
    record: string;
    requirement: string;
    via: string[];
  }[] {
    const out: { record: string; requirement: string; via: string[] }[] = [];
    const addresses = this.edges.filter((e) => e.predicate === "addresses");
    const requires = this.edges.filter((e) => e.predicate === "requires_record");
    const instances = this.edges.filter((e) => e.predicate === "instance_of");
    const directEv = this.edges.filter((e) => e.predicate === "evidence_for");

    for (const a of addresses) {
      if (requirementId && a.object !== requirementId) continue;
      for (const r of requires) {
        if (r.subject !== a.subject) continue;
        for (const i of instances) {
          if (i.object !== r.object) continue;
          out.push({
            record: i.subject,
            requirement: a.object,
            via: [a.factId, r.factId, i.factId],
          });
        }
      }
    }
    for (const e of directEv) {
      if (requirementId && e.object !== requirementId) continue;
      out.push({ record: e.subject, requirement: e.object, via: [e.factId] });
    }
    return out;
  }

  /** Missing evidence: templates required but no instance_of record. */
  missingEvidence(scopeRequirementIds?: string[]): {
    requirement: string;
    document: string;
    template: string;
  }[] {
    const missing: { requirement: string; document: string; template: string }[] =
      [];
    const addresses = this.edges.filter((e) => e.predicate === "addresses");
    const requires = this.edges.filter((e) => e.predicate === "requires_record");
    const instances = this.edges.filter((e) => e.predicate === "instance_of");
    const covered = new Set(instances.map((i) => i.object));

    for (const a of addresses) {
      if (scopeRequirementIds && !scopeRequirementIds.includes(a.object)) continue;
      for (const r of requires) {
        if (r.subject !== a.subject) continue;
        if (!covered.has(r.object)) {
          missing.push({
            requirement: a.object,
            document: a.subject,
            template: r.object,
          });
        }
      }
    }
    return missing;
  }

  hasPermission(personId: string, permissionId: string): boolean {
    const roles = this.edges
      .filter((e) => e.predicate === "holds_role" && e.subject === personId)
      .map((e) => e.object);
    for (const role of roles) {
      const grants = this.edges.filter(
        (e) => e.predicate === "grants" && e.subject === role && e.object === permissionId,
      );
      if (grants.length) return true;
      // Also check ROLE_GRANTS static table for bootstrap
      const staticGrants = ROLE_GRANTS[role as keyof typeof ROLE_GRANTS];
      if (staticGrants?.includes(permissionId)) return true;
    }
    return false;
  }

  entityType(id: string): string | undefined {
    return this.entityTypes.get(id);
  }
}
