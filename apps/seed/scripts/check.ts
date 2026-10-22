import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { KnowledgeBundle } from "../../packages/contracts/src/index";
import { verifyBundle, sha256, canonical, sourcePathAllowed } from "../../packages/knowledge/src/index";
import { KNOWLEDGE_SCHEMA } from "../../packages/ontology/src/index";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const pointer = JSON.parse(await readFile(resolve(root, "output/knowledge/current-release.json"), "utf8")) as { releaseId: string; manifestHash: string };
if (!/^[\da-f-]{36}$/.test(pointer.releaseId)) throw new Error("Invalid release ID");
const directory = resolve(root, "output/knowledge", pointer.releaseId);
const bundle = JSON.parse(await readFile(resolve(directory, "bundle.json"), "utf8")) as KnowledgeBundle;
const result = await verifyBundle(bundle);
if (pointer.manifestHash !== bundle.manifest.manifestHash) result.errors.push({ code: "pointer_hash", path: "current-release", message: "Pointer and bundle differ" });
for (const source of bundle.sources) {
  if (!sourcePathAllowed(source.path, "production")) throw new Error(`source_path: ${source.path}`);
  const bytes = await readFile(resolve(root, source.path));
  if (await sha256(bytes) !== source.sha256) result.errors.push({ code: "current_source_changed", path: source.path, message: "Current source differs from release source" });
}
if (await sha256(await readFile(resolve(root, "apps/packages/ontology/rules.dl"))) !== bundle.manifest.rulesHash) result.errors.push({ code: "rules_changed", path: "rules.dl", message: "Current engine rules differ from bundle" });
if (await sha256(canonical(KNOWLEDGE_SCHEMA)) !== bundle.manifest.schemaHash) result.errors.push({ code: "schema_changed", path: "schema", message: "Current schema differs from bundle" });
result.valid = result.errors.length === 0;
await writeFile(resolve(directory, "current-check.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ releaseId: pointer.releaseId, sources: bundle.sources.length, recordTypes: bundle.recordTypes.length, ...result }, null, 2));
if (!result.valid) process.exitCode = 1;
