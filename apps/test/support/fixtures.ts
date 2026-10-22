import type { KnowledgeBundle, ActionPolicy, RoleAssignment } from '../../packages/contracts/src/index';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { repoRoot, validateFixturePath } from './environment';
import { sha256 } from '../../worker/src/lib/markdown';
import {buildRelease,canonical,extractSourceClauses} from '../../packages/knowledge/src/index';
import {KNOWLEDGE_SCHEMA,SCHEMA_VERSION} from '../../packages/ontology/src/index';
export async function loadFixture(name:string) { return readFile(validateFixturePath(`fixtures/${name}`),'utf8'); }
export const sourceText='# 시험 절차\n시험 작성자는 기록을 작성한다. 시험 검토자는 검토한다. 시험 승인자는 F01을 승인하고 시험 대표는 F02를 승인한다. 시험 관리자는 규정을 등록한다.\n';
export async function syntheticBundle():Promise<KnowledgeBundle> {
 const hash=await sha256(sourceText);const rules=await readFile(resolve(repoRoot,'apps/packages/ontology/rules.dl'));
 const evidence={revisionId:'test-reg-rev',sourceSha256:hash,lineStart:2,lineEnd:2,quote:sourceText.split('\n')[1]};
 const policies:ActionPolicy[]=[];
 for(const type of ['test-F01','test-F02']) for(const [action,role] of [['create','author'],['revise','author'],['submit','author'],['review','reviewer'],['approve',type==='test-F01'?'approver':'director'],['reject',type==='test-F01'?'approver':'director'],['circulate','author'],['apply_assignment','director']] as const) policies.push({id:`${type}-${action}`,resourceTypeId:type,action,roleId:role,scopeCondition:{kind:'all'},stateCondition:action==='create'?['new']:action==='review'?['in_review']:action==='approve'?['reviewed']:['draft','in_review','reviewed','approved','registered','rejected'],separationCondition:'none',decisionKind:action==='approve'?'approval':'registration',evidenceRefs:[evidence],effectiveReleaseId:'test-release',origin:'regulation',conditions:[],requiresExactRevision:action!=='create',reviewStatus:'validated'});
 for(const type of ['manual','procedure','guide','template']) for(const [action,role] of [['create','author'],['revise','author'],['review','reviewer'],['approve','director'],['publish','director']] as const) policies.push({id:`${type}-${action}`,resourceTypeId:type,action,roleId:role,scopeCondition:{kind:'all'},stateCondition:['new','draft','in_review','reviewed','built','validated','approved'],separationCondition:'none',decisionKind:'publication',evidenceRefs:[evidence],effectiveReleaseId:'test-release',origin:'regulation',conditions:[],requiresExactRevision:!['create','revise'].includes(action),reviewStatus:'validated'});
 const recordTypes=['test-F01','test-F02'].map((id,index)=>({id,code:id,name:`시험 기록 ${index+1}`,templateArtifactId:`test-tpl-${index+1}`,templateRevisionId:`test-tpl-rev-${index+1}`,procedureCode:'TEST-PROC',reviewRequired:true,approvalRequired:true,applicability:'시험용',actionCoverage:policies.filter(p=>p.resourceTypeId===id).map(p=>({action:p.action,status:'defined' as const,reason:'합성 시험 규정',evidenceRefs:[evidence],policyIds:[p.id]})),evidenceRefs:[evidence],reviewStatus:'validated' as const}));
 const sources=[{artifactId:'test-reg',revisionId:'test-reg-rev',path:'synthetic/regulations/test.md',code:'TEST-PROC',title:'시험 절차',kind:'procedure' as const,sha256:hash,textSha256:hash,markdown:sourceText},...recordTypes.map((t,i)=>({artifactId:t.templateArtifactId,revisionId:t.templateRevisionId,path:`synthetic/templates/${t.id}.md`,code:t.id,title:t.name,kind:'template' as const,sha256:hash,textSha256:hash,markdown:sourceText}))];
 const roles=['author','reviewer','approver','director'].map(id=>({id,name:`시험 ${id}`,evidenceRefs:[evidence]}));
 return buildRelease({sourceMode:'synthetic',sources:sources.map(({markdown,sha256:hash,textSha256,...s})=>({...s,bytes:new TextEncoder().encode(markdown),sha256:hash})),rules,schema:new TextEncoder().encode(canonical(KNOWLEDGE_SCHEMA)),schemaVersion:SCHEMA_VERSION,mappings:{version:'1',reviewedBy:'synthetic fixture',reviewedAt:'2026-01-01',reviewScope:'Synthetic inputs only',sources:sources.map(s=>({sourceCode:s.code,sourceSha256:s.sha256,revisionId:s.revisionId,reviewStatus:'validated',reviewedBy:'synthetic fixture',reviewedAt:'2026-01-01',clauses:extractSourceClauses(s)})),recordTypes,roles,policies,productPolicies:[]}});
}
export async function syntheticAssignments():Promise<RoleAssignment[]> {
 const evidence={revisionId:'test-reg-rev',sourceSha256:await sha256(sourceText),lineStart:2,lineEnd:2,quote:sourceText.split('\n')[1]};
 return ['author','reviewer','approver','director','admin'].map(id=>({id:`test-assignment-${id}`,personId:id,roleId:id==='admin'?'author':id,scope:{kind:'all',ids:[]},validFrom:'2020-01-01T00:00:00Z',approvedRevisionId:'test-reg-rev',evidenceRefs:[evidence],status:'active'}));
}
