#!/usr/bin/env node
/**
 * Walks docs/ and records/ and writes apps/worker/public/corpus-manifest.json
 * so the Worker can scan assets without directory listing.
 */
import { readdir, writeFile, mkdir, cp } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const publicDir = join(root, "apps/worker/public");

async function walk(dir, acc = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, acc);
    else if (e.isFile() && e.name.endsWith(".md")) acc.push(p);
  }
  return acc;
}

const docsRoot = join(root, "docs");
const recordsRoot = join(root, "records");
const docFiles = (await walk(docsRoot))
  .filter((p) => /\/(manual|procedure|guide|forms)\//.test(p))
  .map((p) => relative(docsRoot, p).split("\\").join("/"));
const recordFiles = (await walk(recordsRoot))
  .filter((p) => !p.endsWith("README.md"))
  .map((p) => relative(recordsRoot, p).split("\\").join("/"));

await mkdir(publicDir, { recursive: true });
const manifest = {
  generated_at: new Date().toISOString(),
  docs: docFiles,
  records: recordFiles,
};
await writeFile(
  join(publicDir, "corpus-manifest.json"),
  JSON.stringify(manifest, null, 2),
);

// Copy seed example into public for bootstrap
await mkdir(join(publicDir, "seed"), { recursive: true });
await cp(
  join(root, "seed/example-persons-roles.json"),
  join(publicDir, "seed/example-persons-roles.json"),
);
await cp(join(root, "seed/schema.json"), join(publicDir, "seed/schema.json"));

console.log(
  `corpus-manifest: ${docFiles.length} docs, ${recordFiles.length} records`,
);
