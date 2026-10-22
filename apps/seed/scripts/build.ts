import { readFile, mkdir, writeFile, realpath } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { BuildSource, ReviewedMappings } from "../../packages/contracts/src/index";
import { buildRelease, canonical, sourcePathAllowed, verifyBundle } from "../../packages/knowledge/src/index";
import { KNOWLEDGE_SCHEMA, SCHEMA_VERSION } from "../../packages/ontology/src/index";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const manifest = JSON.parse(await readFile(resolve(root, "apps/seed/inputs/regulations.manifest.json"), "utf8")) as { sources: Array<Omit<BuildSource, "bytes">> };
const mappings = JSON.parse(await readFile(resolve(root, "apps/seed/inputs/reviewed-mappings.json"), "utf8")) as ReviewedMappings;
const sources: BuildSource[] = [];
for (const source of manifest.sources) {
  if (!sourcePathAllowed(source.path, "production")) throw new Error(`source_path: ${source.path}`);
  const absolute = resolve(root, source.path);
  if (await realpath(absolute) !== absolute) throw new Error(`source_symlink: ${source.path}`);
  sources.push({ ...source, bytes: await readFile(absolute) });
}
const bundle = await buildRelease({ sources, mappings, rules: await readFile(resolve(root, "apps/packages/ontology/rules.dl")), schema: new TextEncoder().encode(canonical(KNOWLEDGE_SCHEMA)), schemaVersion: SCHEMA_VERSION, sourceMode: "production" });
const validation = await verifyBundle(bundle);
if (!validation.valid) throw new Error(JSON.stringify(validation.errors));
const output = resolve(root, "output/knowledge", bundle.manifest.releaseId);
await mkdir(output, { recursive: true });
const save = async (name: string, value: unknown) => {
  const content = JSON.stringify(value, null, 2) + "\n";
  try { await writeFile(resolve(output, name), content, { flag: "wx" }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST" || await readFile(resolve(output, name), "utf8") !== content) throw error; }
};
await save("bundle.json", bundle);
await save("manifest.json", bundle.manifest);
await save("coverage.json", bundle.coverage);
await save("permissions.json", bundle.recordTypes.map(type => ({ ...type, policies: bundle.policies.filter(policy => policy.resourceTypeId === type.id) })));
await save("validation.json", validation);
await writeFile(resolve(root, "output/knowledge/current-release.json"), JSON.stringify({ releaseId: bundle.manifest.releaseId, manifestHash: bundle.manifest.manifestHash }, null, 2) + "\n");
console.log(JSON.stringify({ output, ...bundle.coverage, manifestHash: bundle.manifest.manifestHash, validation: "PASS", installation: "not installed", people: "No employees or assignments were invented or imported" }, null, 2));
