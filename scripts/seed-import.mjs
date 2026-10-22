#!/usr/bin/env node
/**
 * CLI helper: validates seed JSON shape and prints a dry-run summary.
 * Live import goes through Worker POST /api/seed/import (or bootstrap).
 */
import { readFile } from "node:fs/promises";

const path = process.argv[2];
if (!path) {
  console.error("Usage: node scripts/seed-import.mjs <seed.json>");
  process.exit(1);
}
const seed = JSON.parse(await readFile(path, "utf8"));
if (!seed.meta?.ontology_revision) {
  console.error("missing meta.ontology_revision");
  process.exit(1);
}
console.log(
  JSON.stringify(
    {
      ontology_revision: seed.meta.ontology_revision,
      entities: seed.entities?.length ?? 0,
      facts: seed.facts?.length ?? 0,
      wiki_pages: seed.wiki_pages?.length ?? 0,
      tip: "POST this JSON to /api/seed/import after selecting a Person with seed.import",
    },
    null,
    2,
  ),
);
