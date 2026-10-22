import { Hono } from "hono";
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { Env, SeedPayload } from "./types";
import { APP_HTML } from "./ui";
import { OntologyEngine } from "./lib/ontology";
import {
  listPersons,
  getApprovedFacts,
  getAllFacts,
  importSeed,
  createSession,
  getSessionPerson,
  requirePermission,
  logEvent,
} from "./lib/store";
import { scanDocuments, scanRecords } from "./lib/records";
import { openaiComplete } from "./lib/llm";

const app = new Hono<{ Bindings: Env }>();

async function currentPerson(c: Context<{ Bindings: Env }>) {
  const token = getCookie(c, "iso_session");
  return getSessionPerson(c.env.DB, token);
}

app.get("/", (c) => c.html(APP_HTML));

app.get("/api/health", (c) =>
  c.json({ ok: true, app: c.env.APP_NAME ?? "iso-agent" }),
);

/** First-time bootstrap: import example seed when no Person entities exist. */
app.post("/api/bootstrap", async (c) => {
  const existing = await c.env.DB.prepare(
    `SELECT COUNT(*) as n FROM entities WHERE type = 'Person'`,
  ).first<{ n: number }>();
  if ((existing?.n ?? 0) > 0) {
    return c.json({ ok: true, skipped: true, message: "already bootstrapped" });
  }
  const res = await c.env.ASSETS.fetch(
    new Request("http://assets/seed/example-persons-roles.json"),
  );
  if (!res.ok) {
    return c.json({ error: "example seed not found in assets" }, 500);
  }
  const seed = (await res.json()) as SeedPayload;
  const report = await importSeed(c.env.DB, seed, null, { overwrite: true });
  return c.json({ ok: true, report });
});

app.get("/api/persons", async (c) => {
  const { results } = await listPersons(c.env.DB);
  return c.json({ persons: results ?? [] });
});

app.get("/api/me", async (c) => {
  const person = await currentPerson(c);
  return c.json({ person });
});

app.post("/api/session", async (c) => {
  const body = await c.req.json<{ person_id: string }>();
  if (!body.person_id) return c.json({ error: "person_id required" }, 400);
  const ent = await c.env.DB.prepare(
    `SELECT id FROM entities WHERE id = ? AND type = 'Person'`,
  )
    .bind(body.person_id)
    .first();
  if (!ent) return c.json({ error: "unknown person" }, 404);
  const token = await createSession(c.env.DB, body.person_id);
  setCookie(c, "iso_session", token, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    maxAge: 604800,
  });
  await logEvent(c.env.DB, "session.select", body.person_id, {
    person_id: body.person_id,
  });
  return c.json({ ok: true, person_id: body.person_id });
});

app.get("/api/documents", async (c) => {
  const person = await currentPerson(c);
  const type = c.req.query("type");
  const need = type === "record" ? "record.read" : "doc.read";
  // Allow unauthenticated read of empty list before seed; after login enforce
  if (person) {
    const gate = await requirePermission(c.env, person.id, need);
    if (!gate.ok) return c.json({ error: gate.error }, gate.status);
  }
  const q = type
    ? c.env.DB.prepare(
        `SELECT id, information_type, title, path, sha256, author, updated_at
         FROM documents WHERE information_type = ? ORDER BY id`,
      ).bind(type)
    : c.env.DB.prepare(
        `SELECT id, information_type, title, path, sha256, author, updated_at
         FROM documents WHERE information_type != 'record' ORDER BY id`,
      );
  const { results } = await q.all();
  return c.json({ documents: results ?? [] });
});

app.post("/api/corpus/scan-docs", async (c) => {
  const person = await currentPerson(c);
  const gate = await requirePermission(c.env, person?.id ?? null, "record.scan");
  if (!gate.ok) return c.json({ error: gate.error }, gate.status);
  const report = await scanDocuments(c.env, person?.id ?? null);
  return c.json(report);
});

app.post("/api/corpus/scan-records", async (c) => {
  const person = await currentPerson(c);
  const gate = await requirePermission(c.env, person?.id ?? null, "record.scan");
  if (!gate.ok) return c.json({ error: gate.error }, gate.status);
  const report = await scanRecords(c.env, person?.id ?? null);
  return c.json(report);
});

app.get("/api/facts", async (c) => {
  const status = c.req.query("status") || undefined;
  const { results } = await getAllFacts(c.env.DB, status);
  return c.json({ facts: results ?? [] });
});

app.post("/api/facts/:id/approve", async (c) => {
  const person = await currentPerson(c);
  const gate = await requirePermission(c.env, person?.id ?? null, "fact.approve");
  if (!gate.ok) return c.json({ error: gate.error }, gate.status);
  const id = c.req.param("id");
  await c.env.DB.prepare(
    `UPDATE facts SET status = 'approved', updated_at = datetime('now') WHERE id = ? AND knowledge_kind = 'normative'`,
  )
    .bind(id)
    .run();
  await logEvent(c.env.DB, "fact.approve", person!.id, { id });
  return c.json({ ok: true });
});

app.post("/api/facts/:id/reject", async (c) => {
  const person = await currentPerson(c);
  const gate = await requirePermission(c.env, person?.id ?? null, "fact.approve");
  if (!gate.ok) return c.json({ error: gate.error }, gate.status);
  const id = c.req.param("id");
  await c.env.DB.prepare(
    `UPDATE facts SET status = 'rejected', updated_at = datetime('now') WHERE id = ? AND knowledge_kind = 'normative'`,
  )
    .bind(id)
    .run();
  await logEvent(c.env.DB, "fact.reject", person!.id, { id });
  return c.json({ ok: true });
});

app.post("/api/seed/import", async (c) => {
  const person = await currentPerson(c);
  const gate = await requirePermission(c.env, person?.id ?? null, "seed.import");
  if (!gate.ok) return c.json({ error: gate.error }, gate.status);
  const body = await c.req.json<{
    seed: SeedPayload;
    dry_run?: boolean;
    overwrite?: boolean;
  }>();
  if (!body.seed?.meta?.ontology_revision) {
    return c.json({ error: "seed.meta.ontology_revision required" }, 400);
  }
  const report = await importSeed(c.env.DB, body.seed, person!.id, {
    dryRun: !!body.dry_run,
    overwrite: !!body.overwrite,
  });
  return c.json({ report, dry_run: !!body.dry_run });
});

app.get("/api/wiki", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, title, status, body_md, updated_at FROM wiki_pages ORDER BY title`,
  ).all();
  return c.json({ pages: results ?? [] });
});

app.post("/api/graph/query", async (c) => {
  const person = await currentPerson(c);
  const gate = await requirePermission(c.env, person?.id ?? null, "query.ask");
  if (!gate.ok) return c.json({ error: gate.error }, gate.status);
  const body = await c.req.json<{ type: string; id: string }>();
  const facts = await getApprovedFacts(c.env.DB);
  const engine = new OntologyEngine(facts);

  // Prefer external Wirelog engine when configured
  if (c.env.ENGINE_URL) {
    try {
      const res = await fetch(`${c.env.ENGINE_URL}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: body.type, id: body.id, facts }),
      });
      if (res.ok) return c.json(await res.json());
    } catch {
      /* fall through to in-worker engine */
    }
  }

  switch (body.type) {
    case "trace":
      return c.json({
        type: "trace",
        id: body.id,
        result: engine.trace(body.id),
        note: "evidence links are candidates, not conformity judgments",
      });
    case "evidence":
      return c.json({
        type: "evidence",
        id: body.id,
        result: engine.evidenceCandidates(body.id || undefined),
        note: "evidence_candidate only",
      });
    case "missing":
      return c.json({
        type: "missing",
        result: engine.missingEvidence(body.id ? [body.id] : undefined),
        note: "absence is not nonconformity",
      });
    case "impact":
      return c.json({
        type: "impact",
        id: body.id,
        result: engine.impactSet(body.id),
      });
    default:
      return c.json({ error: "unknown query type" }, 400);
  }
});

app.post("/api/ask", async (c) => {
  const person = await currentPerson(c);
  const gate = await requirePermission(c.env, person?.id ?? null, "query.ask");
  if (!gate.ok) return c.json({ error: gate.error }, gate.status);
  const body = await c.req.json<{ question: string }>();
  const facts = await getApprovedFacts(c.env.DB);
  const engine = new OntologyEngine(facts);
  const wiki = await c.env.DB.prepare(
    `SELECT id, title, body_md, status FROM wiki_pages WHERE status = 'approved' LIMIT 20`,
  ).all();

  const graphCtx = {
    evidence: engine.evidenceCandidates(),
    missing: engine.missingEvidence(),
    edges_sample: engine.allEdges().slice(0, 80),
  };

  const system = `You are an AIMS ontology assistant for AIDU / Edu Score.
Answer using ONLY the provided approved graph facts and wiki.
Distinguish: normative (seed) vs record (auto_approved) knowledge.
Never claim ISO conformity or requirement satisfaction; evidence is candidate only.
Cite fact ids when possible. If unknown, say so.
Respond in Korean.`;

  const user = `Question: ${body.question}

Approved wiki:
${JSON.stringify(wiki.results ?? [], null, 2)}

Graph context:
${JSON.stringify(graphCtx, null, 2)}`;

  let answer: string;
  try {
    answer = await openaiComplete(
      c.env.OPENAI_API_KEY ?? "",
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      c.env.LLM_MODEL,
    );
  } catch (err) {
    return c.json(
      {
        error: err instanceof Error ? err.message : String(err),
        citations: { graph: graphCtx.evidence.slice(0, 10) },
        fallback: graphCtx,
      },
      502,
    );
  }

  await logEvent(c.env.DB, "query.ask", person!.id, {
    question: body.question,
  });

  return c.json({
    answer,
    citations: {
      graph: graphCtx.evidence.slice(0, 10),
      wiki: (wiki.results ?? []).map((w: { id: string }) => w.id),
    },
    grounding: ["graph", "wiki"],
  });
});

app.post("/api/impact/draft", async (c) => {
  const person = await currentPerson(c);
  const gate = await requirePermission(c.env, person?.id ?? null, "impact.draft");
  if (!gate.ok) return c.json({ error: gate.error }, gate.status);
  const body = await c.req.json<{ change: string; system_id?: string }>();
  const systemId = body.system_id || "aisystem:edu-score";
  const facts = await getApprovedFacts(c.env.DB);
  const engine = new OntologyEngine(facts);
  const impact = engine.impactSet(systemId);
  // Also include things that depend on the impact assessment activity / procedure
  const impactProc = engine.impactSet("doc:AIDU-AIP-06-02");
  const impactAct = engine.impactSet("activity:impact-assessment");

  const reviewSet = {
    system: systemId,
    from_system: impact,
    from_procedure: impactProc,
    from_activity: impactAct,
    related_templates: engine
      .allEdges()
      .filter(
        (e) =>
          e.predicate === "requires_record" &&
          (e.subject === "doc:AIDU-AIP-06-02" || e.subject === "doc:AIDU-AIP-06-01"),
      ),
    related_evidence: engine.evidenceCandidates("req:42001-6.1.4"),
  };

  let draft: string;
  try {
    draft = await openaiComplete(
      c.env.OPENAI_API_KEY ?? "",
      [
        {
          role: "system",
          content: `You draft an AI system impact assessment outline for AIDU Edu Score following AIDU-AIP-06-02.
Output Korean markdown with sections: 변경 요약, 재검토 대상, 영향 시나리오(초안), 필요 양식(F01~F03 연결만), 미확인 사항.
Do NOT claim the assessment is complete or approved. Do NOT invent record IDs.`,
        },
        {
          role: "user",
          content: `Change specification:\n${body.change}\n\nOntology impact set:\n${JSON.stringify(reviewSet, null, 2)}`,
        },
      ],
      c.env.LLM_MODEL,
    );
  } catch (err) {
    return c.json(
      {
        error: err instanceof Error ? err.message : String(err),
        impact_set: reviewSet,
        note: "Draft LLM call failed; impact_set still returned",
      },
      502,
    );
  }

  await logEvent(c.env.DB, "impact.draft", person!.id, {
    system_id: systemId,
    change: body.change,
  });

  return c.json({
    impact_set: reviewSet,
    draft_markdown: draft,
    note: "Draft only — no form autofill, no records created",
  });
});

app.post("/api/snapshots", async (c) => {
  const person = await currentPerson(c);
  const gate = await requirePermission(c.env, person?.id ?? null, "fact.approve");
  if (!gate.ok) return c.json({ error: gate.error }, gate.status);
  const facts = await getApprovedFacts(c.env.DB);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO snapshots (id, label, ontology_revision, rules_hash, engine_version, fact_ids_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      "approved-snapshot",
      "0.1.0",
      "rules.dl:mvp",
      "ontology-engine-ts/0.1",
      JSON.stringify(facts.map((f) => f.id)),
    )
    .run();
  return c.json({ id, fact_count: facts.length });
});

export default app;
