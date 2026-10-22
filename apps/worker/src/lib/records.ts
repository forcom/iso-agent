import type { Env } from "../types";
import { parseFrontmatter, formIdFromRecordId, procedureIdFromFormId } from "./frontmatter";
import { sha256Hex } from "./ontology";
import { replaceRecordFacts, upsertDocument, logEvent } from "./store";

async function listAssetPaths(
  env: Env,
  prefix: string,
): Promise<string[]> {
  // Workers Assets directory listing is not always available; use known scan via fetch index
  // Fallback: try common paths from a lightweight index endpoint we generate, or probe README.
  const paths: string[] = [];
  const idxRes = await env.ASSETS.fetch(new Request(`http://assets/${prefix}/README.md`));
  if (idxRes.ok) {
    const text = await idxRes.text();
    const linkRe = /\(([A-Z0-9-]+\.md)\)/gi;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(text))) {
      paths.push(`${prefix}/${m[1]}`);
    }
  }
  // Also try fetching a generated manifest if present
  const man = await env.ASSETS.fetch(new Request("http://assets/corpus-manifest.json"));
  if (man.ok) {
    try {
      const data = (await man.json()) as { records?: string[]; docs?: string[] };
      if (prefix === "records" && data.records) return data.records.map((p) => `records/${p}`);
      if (prefix.startsWith("docs") && data.docs) {
        return data.docs
          .filter((p) => p.startsWith(prefix.replace(/^docs\/?/, "") || "") || true)
          .map((p) => (p.startsWith("docs/") ? p : `docs/${p}`));
      }
    } catch {
      /* ignore */
    }
  }
  return paths;
}

export async function scanDocuments(env: Env, actor: string | null) {
  const dirs = ["docs/manual", "docs/procedure", "docs/guide", "docs/forms"];
  let scanned = 0;
  const manifestRes = await env.ASSETS.fetch(
    new Request("http://assets/corpus-manifest.json"),
  );
  let docs: string[] = [];
  if (manifestRes.ok) {
    const data = (await manifestRes.json()) as { docs?: string[] };
    docs = (data.docs ?? []).map((p) => (p.startsWith("docs/") ? p : `docs/${p}`));
  } else {
    for (const d of dirs) {
      docs.push(...(await listAssetPaths(env, d)));
    }
  }

  for (const path of docs) {
    const res = await env.ASSETS.fetch(new Request(`http://assets/${path}`));
    if (!res.ok) continue;
    const text = await res.text();
    const { meta } = parseFrontmatter(text);
    const id = meta.information_id || path.split("/").pop()?.replace(/\.md$/, "");
    if (!id) continue;
    const sha = await sha256Hex(text);
    await upsertDocument(env.DB, {
      id,
      information_type: meta.information_type || path.split("/")[1] || "document",
      title: meta.information_title || id,
      path,
      sha256: sha,
      author: meta.author,
      meta,
    });
    // Ensure document entity exists
    await env.DB.prepare(
      `INSERT INTO entities (id, type, name) VALUES (?, 'Document', ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name`,
    )
      .bind(`doc:${id}`, meta.information_title || id)
      .run();
    scanned++;
  }
  await logEvent(env.DB, "corpus.scan.docs", actor, { scanned });
  return { scanned };
}

export async function scanRecords(env: Env, actor: string | null) {
  const manifestRes = await env.ASSETS.fetch(
    new Request("http://assets/corpus-manifest.json"),
  );
  let files: string[] = [];
  if (manifestRes.ok) {
    const data = (await manifestRes.json()) as { records?: string[] };
    files = (data.records ?? []).map((p) =>
      p.startsWith("records/") ? p : `records/${p}`,
    );
  } else {
    files = await listAssetPaths(env, "records");
  }

  let scanned = 0;
  let factsCreated = 0;

  for (const path of files) {
    if (!path.endsWith(".md") || path.endsWith("README.md")) continue;
    const res = await env.ASSETS.fetch(new Request(`http://assets/${path}`));
    if (!res.ok) continue;
    const text = await res.text();
    const { meta, body } = parseFrontmatter(text);
    const recordId =
      meta.information_id ||
      path.split("/").pop()?.replace(/\.md$/, "") ||
      "";
    if (!recordId) continue;
    const sha = await sha256Hex(text);
    const formId = meta.form_id || formIdFromRecordId(recordId);
    const procedureId = formId ? procedureIdFromFormId(formId) : null;
    const title = meta.information_title || recordId;

    await upsertDocument(env.DB, {
      id: recordId,
      information_type: "record",
      title,
      path,
      sha256: sha,
      author: meta.author,
      meta: { ...meta, form_id: formId ?? "", record_status: meta.record_status ?? "" },
    });

    await env.DB.prepare(
      `INSERT INTO entities (id, type, name) VALUES (?, 'Record', ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name`,
    )
      .bind(`record:${recordId}`, title)
      .run();

    if (formId) {
      await env.DB.prepare(
        `INSERT INTO entities (id, type, name) VALUES (?, 'RecordTemplate', ?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name`,
      )
        .bind(`tpl:${formId}`, formId)
        .run();
    }

    const facts: {
      id: string;
      subject: string;
      predicate: string;
      object: string;
      quote?: string;
      source_sha: string;
    }[] = [];

    const subject = `record:${recordId}`;
    if (formId) {
      facts.push({
        id: `fact:record:${recordId}:instance_of`,
        subject,
        predicate: "instance_of",
        object: `tpl:${formId}`,
        quote: `form_id=${formId}`,
        source_sha: sha,
      });
    }
    if (procedureId) {
      facts.push({
        id: `fact:record:${recordId}:produced_by`,
        subject,
        predicate: "produced_by",
        object: `doc:${procedureId}`,
        quote: `procedure=${procedureId}`,
        source_sha: sha,
      });
      facts.push({
        id: `fact:record:${recordId}:governed_by`,
        subject,
        predicate: "governed_by",
        object: `doc:${procedureId}`,
        source_sha: sha,
      });
    }

    // about_system if Edu Score mentioned
    if (/Edu\s*Score/i.test(title) || /Edu\s*Score/i.test(body.slice(0, 2000))) {
      facts.push({
        id: `fact:record:${recordId}:about_system`,
        subject,
        predicate: "about_system",
        object: "aisystem:edu-score",
        source_sha: sha,
      });
    }

    // evidence_for activities by procedure family
    if (procedureId === "AIDU-AIP-06-02") {
      facts.push({
        id: `fact:record:${recordId}:evidence_for`,
        subject,
        predicate: "evidence_for",
        object: "activity:impact-assessment",
        source_sha: sha,
      });
      facts.push({
        id: `fact:record:${recordId}:evidence_for_req`,
        subject,
        predicate: "evidence_for",
        object: "req:42001-6.1.4",
        source_sha: sha,
      });
    }
    if (procedureId === "AIDU-AIP-06-01") {
      facts.push({
        id: `fact:record:${recordId}:evidence_for`,
        subject,
        predicate: "evidence_for",
        object: "activity:risk-assessment",
        source_sha: sha,
      });
      facts.push({
        id: `fact:record:${recordId}:evidence_for_req`,
        subject,
        predicate: "evidence_for",
        object: "req:42001-6.1.2",
        source_sha: sha,
      });
    }

    // Linked record IDs in body tables
    const linkRe = /\b(AIDU-AIP-\d{2}-\d{2}-F\d{2}-\d{4}-\d+)\b/g;
    const linked = new Set<string>();
    let lm: RegExpExecArray | null;
    while ((lm = linkRe.exec(body))) {
      if (lm[1] !== recordId) linked.add(lm[1]);
    }
    for (const other of linked) {
      facts.push({
        id: `fact:record:${recordId}:dep:${other}`,
        subject,
        predicate: "depends_on",
        object: `record:${other}`,
        quote: other,
        source_sha: sha,
      });
    }

    await replaceRecordFacts(env.DB, recordId, facts);
    factsCreated += facts.length;
    scanned++;
  }

  await logEvent(env.DB, "corpus.scan.records", actor, {
    scanned,
    factsCreated,
    triggered_by: actor,
    actor: "system:record-ingest",
  });
  return { scanned, factsCreated };
}
