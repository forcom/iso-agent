import {installInitialSchema} from "../../seed/scripts/schema";
import { afterEach, describe, expect, it } from "vitest";
import { Miniflare } from "miniflare";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Env } from "../../worker/src/types";
import { installRelease } from "../../worker/src/lib/installation";
import { buildRelease,sha256 } from "../../packages/knowledge/src/index";
import { corpus } from "./fixture";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const cleanups: Array<() => Promise<void>> = [];
async function emptyEnvironment() {
  const base = resolve(root, "output/test/installation"); await mkdir(base, { recursive: true });
  const dir = await mkdtemp(resolve(base, "iso-test-"));
  const mf = new Miniflare({ name: "iso-test-install", modules: true, script: "export default { fetch(){return new Response('test')} }", compatibilityDate: "2025-10-01", d1Databases: { DB: "iso-test-install" }, r2Buckets: { SOURCES: "iso-test-install" }, d1Persist: resolve(dir, "d1"), r2Persist: resolve(dir, "r2") });
  cleanups.push(async () => { await mf.dispose(); await rm(dir, { recursive: true, force: true }); });
  const env = { DB: await mf.getD1Database("DB"), SOURCES: await mf.getR2Bucket("SOURCES") } as unknown as Env;
  await installInitialSchema(env.DB,root);
  return env;
}
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
describe("knowledge installation", () => {
  it("stores index and regulation originals without losing BOM or CRLF bytes", async () => {
    const input = await corpus(), oldHash = input.sources[0].sha256!;
    const rawProcedure = "\uFEFF# 1 Example procedure\r\nThe coordinator writes the register.\r\nThe reviewer reviews the exact version.\r\n";
    input.sources[0].bytes = new TextEncoder().encode(rawProcedure);
    input.sources[0].sha256 = await sha256(rawProcedure);
    input.mappings = JSON.parse(JSON.stringify(input.mappings).replaceAll(oldHash, input.sources[0].sha256));
    const rawIndex = "\uFEFF# Contents\r\nNavigation only.\r\n", indexHash = await sha256(rawIndex);
    input.sources.push({ artifactId: "index", revisionId: "index-revision", code: "INDEX", title: "Contents", path: "synthetic/index.md", kind: "index", bytes: new TextEncoder().encode(rawIndex), sha256: indexHash });
    input.mappings.sources.push({ sourceCode: "INDEX", revisionId: "index-revision", sourceSha256: indexHash, reviewStatus: "validated", reviewedBy: "synthetic reviewer", reviewedAt: "2026-01-01", clauses: [] });
    const bundle = await buildRelease(input), env = await emptyEnvironment();
    await installRelease(env, bundle, { environment: "iso-test-install", ruleBytes: input.rules, schemaBytes: input.schema, sourceBytes: Object.fromEntries(input.sources.map(source => [source.revisionId, source.bytes])) });
    const procedure = bundle.sources.find(source => source.revisionId === "example-revision")!;
    expect(await (await env.SOURCES.get(`sources/example-revision/${procedure.sha256}.md`))!.text()).toBe(rawProcedure);
    expect(await (await env.SOURCES.get(`text/example-revision/${procedure.textSha256}.txt`))!.text()).toBe("# 1 Example procedure\nThe coordinator writes the register.\nThe reviewer reviews the exact version.\n");
    expect(await (await env.SOURCES.get(`sources/index-revision/${indexHash}.md`))!.text()).toBe(rawIndex);
    expect(await env.DB.prepare("SELECT id FROM revisions WHERE id='index-revision'").first()).toBeNull();
  });
  it("rejects provided source bytes whose hash differs before storing any object", async () => {
    const input = await corpus(), bundle = await buildRelease(input), env = await emptyEnvironment();
    await expect(installRelease(env, bundle, { environment: "iso-test-install", ruleBytes: input.rules, schemaBytes: input.schema, sourceBytes: { "example-revision": new TextEncoder().encode("different source") } })).rejects.toMatchObject({ code: "SOURCE_HASH" });
    expect((await env.SOURCES.list()).objects).toHaveLength(0);
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM context").first("n")).toBe(0);
  });
  it("requires original bytes when a bundle contains only normalized text with a different raw hash", async () => {
    const input = await corpus(), rawIndex = "# Contents\r\nNavigation only.\r\n", hash = await sha256(rawIndex);
    input.sources.push({ artifactId: "index", revisionId: "index-revision", code: "INDEX", title: "Contents", path: "synthetic/index.md", kind: "index", bytes: new TextEncoder().encode(rawIndex), sha256: hash });
    input.mappings.sources.push({ sourceCode: "INDEX", revisionId: "index-revision", sourceSha256: hash, reviewStatus: "validated", reviewedBy: "synthetic reviewer", reviewedAt: "2026-01-01", clauses: [] });
    const bundle = await buildRelease(input), env = await emptyEnvironment();
    await expect(installRelease(env, bundle, { environment: "iso-test-install", ruleBytes: input.rules, schemaBytes: input.schema })).rejects.toMatchObject({ code: "SOURCE_BYTES_REQUIRED" });
    expect((await env.SOURCES.list()).objects).toHaveLength(0);
  });
  it("installs explicit demo knowledge without weakening source isolation or the empty-database fence", async () => {
    const input = await corpus();
    input.sourceMode = "production";
    input.sources[0].path = "docs/procedure/SYNTHETIC-P.md";
    input.sources[1].path = "docs/forms/SYNTHETIC-F.md";
    const bundle = await buildRelease(input), env = await emptyEnvironment();
    await expect(installRelease(env, bundle, { environment: "demo", ruleBytes: input.rules, schemaBytes: input.schema })).rejects.toMatchObject({code:"DEMO_DISABLED"});
    expect((await env.SOURCES.list()).objects).toHaveLength(0);
    env.ALLOW_FICTIONAL_PERSONNEL = "true";
    const result = await installRelease(env, bundle, { environment: "demo", ruleBytes: input.rules, schemaBytes: input.schema });
    expect(result.installed).toBe(true);
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM persons").first("n")).toBe(0);
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM decisions").first("n")).toBe(0);
    await expect(installRelease(env, bundle, { environment: "demo", ruleBytes: input.rules, schemaBytes: input.schema })).rejects.toMatchObject({code:"ALREADY_INSTALLED"});
    const other = await emptyEnvironment(); other.ALLOW_FICTIONAL_PERSONNEL = "true";
    const synthetic = await corpus();
    await expect(installRelease(other, await buildRelease(synthetic), { environment: "demo", ruleBytes: synthetic.rules, schemaBytes: synthetic.schema })).rejects.toMatchObject({code:"SOURCE_ISOLATION"});
    expect((await other.SOURCES.list()).objects).toHaveLength(0);
  });
  it("installs_verified_sources_without_fictional_people_or_decisions", async () => {
    const input = await corpus(); const bundle = await buildRelease(input); const env = await emptyEnvironment();
    const result = await installRelease(env, bundle, { environment: "iso-test-install", ruleBytes: input.rules, schemaBytes: input.schema });
    expect(result.installed).toBe(true); expect(result.unassignedRoleIds).toEqual(["coordinator"]);
    expect(await env.DB.prepare("SELECT COUNT(*) FROM persons").first("COUNT(*)")).toBe(0);
    expect(await env.DB.prepare("SELECT COUNT(*) FROM decisions").first("COUNT(*)")).toBe(0);
    for (const source of bundle.sources) expect(await (await env.SOURCES.get(`sources/${source.revisionId}/${source.sha256}.md`))!.text()).toBe(source.markdown);
    await expect(installRelease(env, bundle, { environment: "iso-test-install" })).rejects.toThrow(/already|기존/);
  });
  it("rejects_tampering_before_writes_and_rolls_back_a_failed_batch", async () => {
    const input = await corpus(); const bundle = await buildRelease(input); const env = await emptyEnvironment();
    bundle.entities[0].label = "tampered";
    await expect(installRelease(env, bundle, { environment: "iso-test-install" })).rejects.toThrow(/bundle|검증/);
    expect((await env.SOURCES.list()).objects).toHaveLength(0);
    const valid = await buildRelease(input);
    await env.DB.prepare("CREATE TRIGGER injected BEFORE INSERT ON revisions BEGIN SELECT RAISE(ABORT,'injected failure'); END").run();
    await expect(installRelease(env, valid, { environment: "iso-test-install", ruleBytes: input.rules, schemaBytes: input.schema })).rejects.toThrow();
    expect(await env.DB.prepare("SELECT COUNT(*) FROM context").first("COUNT(*)")).toBe(0);
    expect(await env.DB.prepare("SELECT COUNT(*) FROM artifacts").first("COUNT(*)")).toBe(0);
  });
  it("records_confirmed_external_designation_without_inventing_an_application_decision",async()=>{
    const input=await corpus(),bundle=await buildRelease(input),env=await emptyEnvironment();
    const markdown='# Synthetic external designation\nSynthetic coordinator assignment.',hash=await sha256(markdown),confirmedAt='2026-01-01T00:00:00Z';
    const external={confirmedBy:'synthetic-person',confirmedAt,approvalEvidenceId:'synthetic-external-approval',sourceSha256:hash};
    await installRelease(env,bundle,{environment:'iso-test-install',ruleBytes:input.rules,schemaBytes:input.schema,preparation:{environment:'iso-test-install',persons:[{id:'synthetic-person',name:'Synthetic person',active:true,evidenceId:'synthetic-employment'}],operatorDesignation:{personId:'synthetic-person',evidenceId:'synthetic-operator',designatedAt:confirmedAt},designationSources:[{artifactId:'synthetic-designation',revisionId:'synthetic-designation-revision',documentCode:'SYNTHETIC-APPOINTMENT',title:'Synthetic appointment',markdown,sha256:hash,confirmedBy:external.confirmedBy,confirmedAt,approvalEvidenceId:external.approvalEvidenceId}],assignments:[{id:'synthetic-assignment',personId:'synthetic-person',roleId:'coordinator',scope:{kind:'all',ids:[]},validFrom:confirmedAt,approvedRevisionId:'synthetic-designation-revision',evidenceRefs:[{revisionId:'synthetic-designation-revision',sourceSha256:hash,lineStart:2,lineEnd:2,quote:'Synthetic coordinator assignment.'}],status:'active'}]}});
    const row=await env.DB.prepare("SELECT body FROM revisions WHERE id='synthetic-designation-revision'").first<{body:string}>();
    expect(JSON.parse(row!.body).externalDesignation).toEqual(external);
    expect(await env.DB.prepare('SELECT COUNT(*) n FROM decisions').first('n')).toBe(0);
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM events WHERE json_extract(body,'$.kind')='external_designation_confirmed'").first('n')).toBe(1);
  });
});
