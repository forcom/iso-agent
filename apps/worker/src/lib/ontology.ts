export interface OntologyFact {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  knowledge_kind: "normative" | "record";
  status: string;
  quote?: string | null;
  source_document_id?: string | null;
}

export interface GraphEdge {
  subject: string;
  predicate: string;
  object: string;
  factId: string;
}

export class OntologyEngine {
  private edges: GraphEdge[];

  constructor(facts: OntologyFact[]) {
    this.edges = facts
      .filter((f) => f.status === "approved" || f.status === "auto_approved")
      .map((f) => ({
        subject: f.subject,
        predicate: f.predicate,
        object: f.object,
        factId: f.id,
      }));
  }

  allEdges(): GraphEdge[] {
    return [...this.edges];
  }

  reach(start: string, predicate: string): { node: string; path: string[] }[] {
    const results: { node: string; path: string[] }[] = [];
    const seen = new Set<string>([start]);
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

  /**
   * Items that depend on `root` (reverse depends_on reachability).
   * If A depends_on B and B changes, A is in the impact set of B.
   */
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

  evidenceCandidates(requirementId?: string) {
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

  missingEvidence(scopeRequirementIds?: string[]) {
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
    const permEntity = permissionId.startsWith("perm:")
      ? permissionId
      : `perm:${permissionId}`;
    const roles = this.edges
      .filter((e) => e.predicate === "holds_role" && e.subject === personId)
      .map((e) => e.object);
    for (const role of roles) {
      const ok = this.edges.some(
        (e) =>
          e.predicate === "grants" &&
          e.subject === role &&
          (e.object === permEntity || e.object === permissionId),
      );
      if (ok) return true;
    }
    return false;
  }

  trace(requirementId: string) {
    const docs = this.edges.filter(
      (e) => e.predicate === "addresses" && e.object === requirementId,
    );
    const templates: { document: string; template: string; factId: string }[] = [];
    const records: {
      record: string;
      template: string;
      factId: string;
    }[] = [];
    for (const d of docs) {
      for (const r of this.edges.filter(
        (e) => e.predicate === "requires_record" && e.subject === d.subject,
      )) {
        templates.push({
          document: d.subject,
          template: r.object,
          factId: r.factId,
        });
        for (const i of this.edges.filter(
          (e) => e.predicate === "instance_of" && e.object === r.object,
        )) {
          records.push({
            record: i.subject,
            template: r.object,
            factId: i.factId,
          });
        }
      }
    }
    return { documents: docs, templates, records };
  }
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
