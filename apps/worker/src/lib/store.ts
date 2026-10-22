import type { Env, SeedPayload } from "../types";
import type { OntologyFact } from "./ontology";
import { sha256Hex } from "./ontology";
import { normalizeWikiClaims, pageToMarkdown } from "../../../../packages/wiki/src/index";

export async function listPersons(db: D1Database) {
  return db
    .prepare(
      `SELECT id, name, type FROM entities WHERE type = 'Person' ORDER BY id`,
    )
    .all<{ id: string; name: string; type: string }>();
}

export async function getApprovedFacts(db: D1Database): Promise<OntologyFact[]> {
  const { results } = await db
    .prepare(
      `SELECT id, subject, predicate, object, knowledge_kind, status, quote, source_document_id
       FROM facts WHERE status IN ('approved', 'auto_approved')`,
    )
    .all<OntologyFact>();
  return results ?? [];
}

export async function getAllFacts(db: D1Database, status?: string) {
  if (status) {
    return db
      .prepare(
        `SELECT * FROM facts WHERE status = ? ORDER BY updated_at DESC`,
      )
      .bind(status)
      .all();
  }
  return db.prepare(`SELECT * FROM facts ORDER BY updated_at DESC`).all();
}

export async function logEvent(
  db: D1Database,
  kind: string,
  actor: string | null,
  payload: unknown,
) {
  await db
    .prepare(
      `INSERT INTO events (kind, actor_person_id, payload_json) VALUES (?, ?, ?)`,
    )
    .bind(kind, actor, JSON.stringify(payload))
    .run();
}

export async function importSeed(
  db: D1Database,
  seed: SeedPayload,
  actor: string | null,
  opts: { dryRun?: boolean; overwrite?: boolean } = {},
) {
  const report = {
    entities: 0,
    facts: 0,
    wiki: 0,
    skipped: 0,
    errors: [] as string[],
  };

  const knownPredicates = new Set([
    "addresses",
    "governed_by",
    "requires_record",
    "instance_of",
    "evidence_for",
    "depends_on",
    "mitigates",
    "supersedes",
    "about_system",
    "holds_role",
    "grants",
    "produced_by",
  ]);

  for (const e of seed.entities ?? []) {
    if (!e.id || !e.type || !e.name) {
      report.errors.push(`invalid entity: ${JSON.stringify(e)}`);
      continue;
    }
    report.entities++;
    if (opts.dryRun) continue;
    await db
      .prepare(
        `INSERT INTO entities (id, type, name, aliases_json, source_ref)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           type=excluded.type, name=excluded.name,
           aliases_json=excluded.aliases_json, source_ref=excluded.source_ref`,
      )
      .bind(
        e.id,
        e.type,
        e.name,
        JSON.stringify(e.aliases ?? []),
        e.source_ref ?? null,
      )
      .run();
  }

  for (const f of seed.facts ?? []) {
    if (!knownPredicates.has(f.predicate)) {
      report.errors.push(`unknown predicate: ${f.predicate}`);
      continue;
    }
    const id =
      f.id ??
      `fact:seed:${await sha256Hex(`${f.subject}|${f.predicate}|${f.object}`)}`;
    const status = f.status ?? "draft";
    if (!opts.overwrite) {
      const existing = await db
        .prepare(`SELECT id FROM facts WHERE id = ?`)
        .bind(id)
        .first();
      if (existing) {
        report.skipped++;
        continue;
      }
    }
    report.facts++;
    if (opts.dryRun) continue;
    await db
      .prepare(
        `INSERT INTO facts (
           id, subject, predicate, object, knowledge_kind, status, quote,
           source_document_id, revision, updated_at
         ) VALUES (?, ?, ?, ?, 'normative', ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           subject=excluded.subject, predicate=excluded.predicate,
           object=excluded.object, status=excluded.status, quote=excluded.quote,
           source_document_id=excluded.source_document_id,
           revision=excluded.revision, updated_at=datetime('now')`,
      )
      .bind(
        id,
        f.subject,
        f.predicate,
        f.object,
        status,
        f.quote ?? null,
        f.source_document_id ?? null,
        f.revision ?? null,
      )
      .run();
  }

  for (const w of seed.wiki_pages ?? []) {
    const id =
      w.id ?? `wiki:${await sha256Hex(w.title + JSON.stringify(w.claims))}`;
    const claims = normalizeWikiClaims(w.claims);
    const body = pageToMarkdown({ ...w, id, claims, status: w.status ?? "draft" });
    report.wiki++;
    if (opts.dryRun) continue;
    await db
      .prepare(
        `INSERT INTO wiki_pages (id, title, status, body_md, claims_json, links_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           title=excluded.title, status=excluded.status, body_md=excluded.body_md,
           claims_json=excluded.claims_json, links_json=excluded.links_json,
           updated_at=datetime('now')`,
      )
      .bind(
        id,
        w.title,
        w.status ?? "draft",
        body,
        JSON.stringify(claims),
        JSON.stringify(w.links ?? []),
      )
      .run();
  }

  if (!opts.dryRun) {
    await logEvent(db, "seed.import", actor, {
      ontology_revision: seed.meta.ontology_revision,
      report,
    });
  }
  return report;
}

export async function upsertDocument(
  db: D1Database,
  doc: {
    id: string;
    information_type: string;
    title: string;
    path: string;
    sha256: string;
    author?: string;
    meta?: Record<string, unknown>;
  },
) {
  await db
    .prepare(
      `INSERT INTO documents (id, information_type, title, path, sha256, author, meta_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         information_type=excluded.information_type, title=excluded.title,
         path=excluded.path, sha256=excluded.sha256, author=excluded.author,
         meta_json=excluded.meta_json, updated_at=datetime('now')`,
    )
    .bind(
      doc.id,
      doc.information_type,
      doc.title,
      doc.path,
      doc.sha256,
      doc.author ?? null,
      JSON.stringify(doc.meta ?? {}),
    )
    .run();
}

export async function replaceRecordFacts(
  db: D1Database,
  recordId: string,
  facts: {
    id: string;
    subject: string;
    predicate: string;
    object: string;
    quote?: string;
    source_sha: string;
  }[],
) {
  await db
    .prepare(
      `DELETE FROM facts WHERE knowledge_kind = 'record' AND source_document_id = ?`,
    )
    .bind(recordId)
    .run();

  for (const f of facts) {
    await db
      .prepare(
        `INSERT INTO facts (
           id, subject, predicate, object, knowledge_kind, status, quote,
           source_document_id, source_sha, updated_at
         ) VALUES (?, ?, ?, ?, 'record', 'auto_approved', ?, ?, ?, datetime('now'))`,
      )
      .bind(
        f.id,
        f.subject,
        f.predicate,
        f.object,
        f.quote ?? null,
        recordId,
        f.source_sha,
      )
      .run();
  }
}

export function sessionCookie(token: string) {
  return `iso_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`;
}

export async function createSession(db: D1Database, personId: string) {
  const token = crypto.randomUUID();
  await db
    .prepare(`INSERT INTO sessions (token, person_id) VALUES (?, ?)`)
    .bind(token, personId)
    .run();
  return token;
}

export async function getSessionPerson(db: D1Database, token: string | undefined) {
  if (!token) return null;
  const row = await db
    .prepare(
      `SELECT s.person_id as id, e.name as name
       FROM sessions s LEFT JOIN entities e ON e.id = s.person_id
       WHERE s.token = ?`,
    )
    .bind(token)
    .first<{ id: string; name: string }>();
  return row ?? null;
}

export function parseCookie(header: string | undefined, name: string) {
  if (!header) return undefined;
  const parts = header.split(";").map((p) => p.trim());
  for (const p of parts) {
    if (p.startsWith(name + "=")) return p.slice(name.length + 1);
  }
  return undefined;
}

export async function requirePermission(
  env: Env,
  personId: string | null,
  permission: string,
): Promise<{ ok: true } | { ok: false; status: 401 | 403; error: string }> {
  if (!personId) {
    return { ok: false, status: 401, error: "select a person first" };
  }
  const facts = await getApprovedFacts(env.DB);
  const engine = new (await import("./ontology")).OntologyEngine(facts);
  if (!engine.hasPermission(personId, permission)) {
    return {
      ok: false,
      status: 403,
      error: `missing permission: ${permission}`,
    };
  }
  return { ok: true };
}
