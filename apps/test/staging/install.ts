import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {installRelease} from '../../worker/src/lib/installation';
import {canonical,sha256} from '../../packages/knowledge/src/index';
import {KNOWLEDGE_SCHEMA} from '../../packages/ontology/src/index';
import {syntheticBundle,syntheticAssignments} from '../support/fixtures';
import {repoRoot} from '../support/environment';
import {openStaging,stagingDirectory} from './platform';

const platform=await openStaging();
try{
 const {env,config}=platform;
 const occupied=await env.DB.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='context'").first<number>('n');
 if(!occupied){
  const migration=await readFile(resolve(repoRoot,'apps/worker/migrations/0001_erp.sql'),'utf8');
  for(const sql of migration.split('-- statement-breakpoint').map(s=>s.trim()).filter(Boolean))await env.DB.prepare(sql).run();
 }
 const markdown='# Synthetic external designation\nSynthetic author, reviewer, approver, director and admin assignments.\n';
 const hash=await sha256(markdown),revisionId='g10-designation-revision',at='2026-01-01T00:00:00Z';
 const assignments=(await syntheticAssignments()).map(a=>({...a,approvedRevisionId:revisionId,evidenceRefs:[{revisionId,sourceSha256:hash,lineStart:2,lineEnd:2,quote:markdown.split('\n')[1]}]}));
 const bundle=await syntheticBundle();
 const report=await installRelease(env,bundle,{environment:config.name,ruleBytes:await readFile(resolve(repoRoot,'apps/packages/ontology/rules.dl')),schemaBytes:new TextEncoder().encode(canonical(KNOWLEDGE_SCHEMA)),preparation:{
  environment:config.name,persons:['author','reviewer','approver','director','admin','reader'].map(id=>({id,name:`합성 시험 ${id}`,active:true,evidenceId:'synthetic-fixture-only'})),
  operatorDesignation:{personId:'admin',evidenceId:'synthetic-operator',designatedAt:at},assignments,
  designationSources:[{artifactId:'g10-designation',revisionId,documentCode:'G10-SYNTHETIC-ASSIGNMENTS',title:'Synthetic assignments only',markdown,sha256:hash,confirmedBy:'director',confirmedAt:at,approvalEvidenceId:'synthetic-external-approval'}]
 }});
 await writeFile(resolve(stagingDirectory,'installation.json'),JSON.stringify({...report,manifest:bundle.manifest},null,2));
 console.log(JSON.stringify(report));
}finally{await platform.dispose()}
