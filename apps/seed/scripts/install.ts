import {installInitialSchema} from "./schema";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { DeploymentPreparation, KnowledgeBundle } from "../../packages/contracts/src/index";
import { canonical, sha256, sourcePathAllowed, verifyBundle } from "../../packages/knowledge/src/index";
import { KNOWLEDGE_SCHEMA } from "../../packages/ontology/src/index";
import { installRelease } from "../../worker/src/lib/installation";
import { installationEnvironment, openInstallationPlatform } from "./deployment";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const { values } = parseArgs({ options: { environment: { type: "string" }, bundle: { type: "string" }, preparation: { type: "string" } }, strict: true });
const environment = installationEnvironment(values.environment);
if (!values.bundle) throw new Error("Use --environment local|demo --bundle output/knowledge/<release-id>/bundle.json.");
if (environment === "demo" && values.preparation) throw new Error("Demo personnel must use the separate fictional-personnel configuration, not real deployment preparation.");
const bundlePath = resolve(root, values.bundle);
if (!/^output\/knowledge\/[\da-f-]{36}\/bundle\.json$/.test(relative(root, bundlePath))) throw new Error("Only a verified regulation knowledge output can be installed");
const bundle = JSON.parse(await readFile(bundlePath, "utf8")) as KnowledgeBundle;
const validation = await verifyBundle(bundle);
if (!validation.valid) throw new Error(`Invalid bundle: ${validation.errors.map(issue => issue.code).join(", ")}`);
const sourceBytes: Record<string, Uint8Array> = {};
for (const source of bundle.sources) {
  if (!sourcePathAllowed(source.path, "production")) throw new Error(`Invalid installation source path: ${source.path}`);
  const bytes = await readFile(resolve(root, source.path));
  if (await sha256(bytes) !== source.sha256) throw new Error(`Installation source hash changed: ${source.code}`);
  sourceBytes[source.revisionId] = bytes;
}
let preparation: DeploymentPreparation | undefined;
if (values.preparation) {
  const path = resolve(root, values.preparation);
  if (!relative(root, path).startsWith("output/runtime/deploy/")) throw new Error("Private deployment preparation must be under output/runtime/deploy/");
  preparation = JSON.parse(await readFile(path, "utf8")) as DeploymentPreparation;
}
const platform = await openInstallationPlatform(root, environment);
try {
  const tables = await platform.env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all<{ name: string }>();
  if (!tables.results.length) {
    await installInitialSchema(platform.env.DB,root);
  } else if (!tables.results.some(table => table.name === "context")) throw new Error("Existing database has another schema; use a separate new database without modifying old data");
  const result = await installRelease(platform.env, bundle, { environment, preparation, sourceBytes, ruleBytes: await readFile(resolve(root, "apps/packages/ontology/rules.dl")), schemaBytes: new TextEncoder().encode(canonical(KNOWLEDGE_SCHEMA)) });
  const report = { ...result, environment, platform: environment === "demo" ? "remote demo D1/R2" : "local D1/R2 only", applicationDeployment: "not performed by this command" };
  await writeFile(resolve(platform.reportDirectory, "installation-report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} finally { await platform.dispose(); }
