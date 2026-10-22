import { normalizeWikiClaims, pageToMarkdown } from "../../../../packages/wiki/src/index";
import type { OntologyFact } from "./ontology";

export interface StoredWikiPage {
  id: string;
  title: string;
  status: string;
  body_md: string;
  claims_json?: string;
}

export function selectWikiContext(question: string, pages: StoredWikiPage[]) {
  const terms = [...new Set((question.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}.:-]+/gu) ?? [])
    .flatMap(t => [t, t.replace(/(?:에서|으로|에게|은|는|이|가|을|를|의)$/u, "")])
    .filter(t => t.length >= 2))];
  const score = (text: string) => terms.reduce((n,t) => n + (text.toLowerCase().includes(t) ? 1 : 0), 0);
  return pages.filter(p => p.status === "approved")
    .map(p => ({ page: p, score: score(p.title) * 5 + score(p.id) * 10 + score(p.body_md) }))
    .sort((a,b) => b.score - a.score || a.page.id.localeCompare(b.page.id))
    .slice(0,6)
    .map(({ page }) => {
      let storedClaims: unknown = [];
      try { storedClaims = JSON.parse(page.claims_json ?? "[]"); } catch { /* Use stored Markdown for legacy data. */ }
      const claims = normalizeWikiClaims(storedClaims);
      const selected = claims.map((claim,i) => ({ claim, i, score: claim.heading.startsWith("온톨로지 연결") ? 0
        : score(claim.heading) * 8 + score(claim.text) * 2 + score(claim.quote ?? "") }))
        .sort((a,b) => b.score-a.score || a.i-b.i).slice(0,4).map(c => c.claim);
      return { ...page, claims: selected, fact_ids: [...new Set(claims.flatMap(c => c.fact_ids ?? []))], body_md: selected.length
        ? pageToMarkdown({ id: page.id, title: page.title, status: "approved", claims: selected })
        : page.body_md };
    });
}

export interface ContextEntity {
  id: string;
  name: string;
  aliases_json?: string;
  aliases?: string[];
}

/** Retrieve explicit graph knowledge even when no Wiki page describes the entity. */
export function selectGraphFacts(question: string, entities: ContextEntity[], facts: OntologyFact[], wikiFactIds: string[]): OntologyFact[] {
  const query = question.toLowerCase();
  const mentioned = (term: string) => {
    const value = term.toLowerCase().trim();
    if (value.length < 2) return false;
    if (/^[a-z0-9:._-]+$/.test(value)) {
      const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(^|[^a-z0-9:_-])${escaped}(?=$|[^a-z0-9:_-])`).test(query);
    }
    return query.includes(value);
  };
  const matched = new Set(entities.filter(entity => {
    let aliases = entity.aliases ?? [];
    try { const parsed = JSON.parse(entity.aliases_json ?? "[]"); if (Array.isArray(parsed)) aliases = parsed.filter(a => typeof a === "string"); } catch { /* Optional aliases. */ }
    return [entity.id, entity.id.split(":").slice(1).join(":"), entity.name, ...entity.name.split(/[·/]/), ...aliases].some(mentioned);
  }).map(e => e.id));
  const approved = facts.filter(f => f.status === "approved" || f.status === "auto_approved");
  const direct = approved.filter(f => matched.has(f.subject) || matched.has(f.object));
  const roles = new Set(direct.filter(f => f.predicate === "holds_role" && matched.has(f.subject)).map(f => f.object));
  const grants = approved.filter(f => f.predicate === "grants" && roles.has(f.subject));
  const wikiIds = new Set(wikiFactIds);
  const result = new Map<string, OntologyFact>();
  for (const fact of [...direct, ...grants, ...approved.filter(f => wikiIds.has(f.id))]) result.set(fact.id,fact);
  return [...result.values()].slice(0,160);
}
