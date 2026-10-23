import {installInitialSchema} from '../../seed/scripts/schema';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import type { Env } from '../../worker/src/types';
import type { ActorContext, KnowledgeBundle } from '../../packages/contracts/src/index';
import { syntheticBundle, syntheticAssignments } from './fixtures';
import {canonical} from '../../packages/knowledge/src/index';
import {KNOWLEDGE_SCHEMA} from '../../packages/ontology/src/index';
export const testRoot = fileURLToPath(new URL('..', import.meta.url));
export const repoRoot = resolve(testRoot, '../..');
function within(path:string, root:string) {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
export function validateTestTarget(target: {name:string;remote:boolean;persistPath:string}) {
  if (!target.name.startsWith('iso-test') || target.remote || !within(resolve(testRoot,target.persistPath), resolve(repoRoot,'output/test'))) throw new Error('Unsafe test target');
}
export function validateFixturePath(path:string) {
  const resolved = resolve(testRoot,path);
  if (!within(resolved,resolve(testRoot,'fixtures'))) throw new Error('Only isolated fixtures are allowed');
  return resolved;
}
export async function createTestEnvironment(inputBundle?: KnowledgeBundle) {
 const base=resolve(repoRoot,'output/test/state');await mkdir(base,{recursive:true});
 const dir=await mkdtemp(resolve(base,'iso-test-'));
 validateTestTarget({name:'iso-test',remote:false,persistPath:dir});
 const mf=new Miniflare({name:'iso-test',modules:true,script:'export default { fetch(){return new Response("isolated")} }',compatibilityDate:'2025-10-01',d1Databases:{DB:'iso-test-database'},r2Buckets:{SOURCES:'iso-test-sources'},d1Persist:resolve(dir,'d1'),r2Persist:resolve(dir,'r2')});
 const bindings={DB:await mf.getD1Database('DB'),SOURCES:await mf.getR2Bucket('SOURCES'),ENGINE_URL:process.env.ISO_TEST_ENGINE_URL??'http://127.0.0.1:18765'} as unknown as Env;
 await installInitialSchema(bindings.DB,repoRoot);
 const bundle=inputBundle??await syntheticBundle();
 await bindings.DB.prepare('INSERT INTO context VALUES(1,?,?,0,0)').bind(bundle.manifest.releaseId,bundle.manifest.rulesHash).run();
 await bindings.SOURCES.put('releases/test-release.json',JSON.stringify(bundle));
 await bindings.SOURCES.put(`definitions/rules/${bundle.manifest.rulesHash}`,await readFile(resolve(repoRoot,'apps/packages/ontology/rules.dl')));
 await bindings.SOURCES.put(`definitions/schema/${bundle.manifest.schemaHash}`,canonical(KNOWLEDGE_SCHEMA));
 await bindings.DB.prepare('INSERT INTO releases VALUES(?,?,?)').bind(bundle.manifest.releaseId,'releases/test-release.json',JSON.stringify(bundle.manifest)).run();
 for(const s of bundle.sources) {
  const objectKey=`sources/${s.revisionId}/${s.sha256}.md`,textKey=`text/${s.revisionId}.txt`;
  await bindings.SOURCES.put(objectKey,s.markdown);await bindings.SOURCES.put(textKey,s.markdown);
  if(s.kind==='index')continue;
  const a={id:s.artifactId,documentCode:s.code,title:s.title,kind:s.kind==='template'?'template':'regulation',regulationType:s.kind,recordTypeIds:[],workingRevisionId:s.revisionId,effectiveRevisionId:s.revisionId,systemIds:[]};
  const r={id:s.revisionId,artifactId:s.artifactId,filename:'test.md',sourceSha256:s.sha256,textSha256:s.textSha256,objectKey,textKey,state:'approved',createdAt:'2026-01-01',createdBy:'director',previousRevisionId:null,templateRevisionIds:[],systemIds:[],conditions:{},fieldMappings:{},evidenceStatus:'verified',...(s.revisionId==='test-reg-rev'?{externalDesignation:{confirmedBy:'director',confirmedAt:'2026-01-01',approvalEvidenceId:'synthetic-external-approval',sourceSha256:s.sha256}}:{})};
  await bindings.DB.prepare('INSERT INTO artifacts VALUES(?,?,?,?)').bind(a.id,a.documentCode,a.kind,JSON.stringify(a)).run();
  await bindings.DB.prepare('INSERT INTO revisions VALUES(?,?,?)').bind(r.id,r.artifactId,JSON.stringify(r)).run();
 }
 for(const id of ['author','reviewer','approver','director','admin','reader']) await bindings.DB.prepare('INSERT INTO persons VALUES(?,?)').bind(id,JSON.stringify({id,name:`시험 ${id}`,active:true,isAdmin:id==='admin',evidenceId:'synthetic-only'})).run();
 for(const a of await syntheticAssignments()) await bindings.DB.prepare('INSERT INTO assignments VALUES(?,?)').bind(a.id,JSON.stringify(a)).run();
 return {bindings,bundle,dir,async select(personId:string):Promise<ActorContext>{
  const id=crypto.randomUUID();await bindings.DB.prepare('INSERT INTO sessions VALUES(?,?,1,?)').bind(id,personId,new Date().toISOString()).run();
  return {personId,sessionId:id,sessionVersion:1,isAdmin:personId==='admin'};
 },async cleanup(){await mf.dispose();await rm(dir,{recursive:true,force:true})}};
}
export type TestEnvironment=Awaited<ReturnType<typeof createTestEnvironment>>;
