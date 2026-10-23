import type {TestEnvironment} from './environment';
import {parseMarkdown} from '../../worker/src/lib/markdown';
import type {Artifact,Revision} from '../../worker/src/types';
import {canonical,sha256} from '../../packages/knowledge/src/index';
export async function installAppointment(env:TestEnvironment,markdown:string) {
 env.bundle.recordTypes.find(type=>type.id==='test-F01')!.roleAssignment = true;
 const policy=env.bundle.policies.find(p=>p.resourceTypeId==='test-F01'&&p.action==='apply_assignment')!;
 Object.assign(policy,{roleId:'administrator',origin:'product_policy',productPolicyId:'synthetic-admin-application',adminRequired:true,evidenceRefs:[],stateCondition:['approved']});
 env.bundle.productPolicies.push({id:'synthetic-admin-application',title:'Synthetic application',origin:'product_policy',sourceUrl:'https://example.invalid/synthetic',decision:'Synthetic administrator application of already approved appointment',conflicts:[]});
 env.bundle.manifest.manifestHash='';env.bundle.manifest.manifestHash=await sha256(canonical(env.bundle));
 await env.bindings.SOURCES.put('releases/test-release.json',JSON.stringify(env.bundle));
 await env.bindings.DB.prepare('UPDATE releases SET body=? WHERE id=?').bind(JSON.stringify(env.bundle.manifest),env.bundle.manifest.releaseId).run();
 const parsed=await parseMarkdown('synthetic.md',new TextEncoder().encode(markdown));
 const artifact:Artifact={id:'appointment',documentCode:'SYNTHETIC-APPOINTMENT',kind:'record',title:'Synthetic appointment',recordTypeIds:['test-F01'],workingRevisionId:'appointment-v1',effectiveRevisionId:'appointment-v1',systemIds:[]};
 const revision:Revision={id:'appointment-v1',artifactId:artifact.id,filename:'synthetic.md',sourceSha256:parsed.sha256,textSha256:parsed.textSha256,objectKey:'sources/appointment-v1.md',textKey:'text/appointment-v1.txt',state:'approved',createdAt:'2026-01-01',createdBy:'author',previousRevisionId:null,templateRevisionIds:['test-tpl-rev-1'],systemIds:[],conditions:{},fieldMappings:{},evidenceStatus:'verified',approvedBy:['approver']};
 await env.bindings.SOURCES.put(revision.objectKey,markdown);await env.bindings.SOURCES.put(revision.textKey,markdown);
 await env.bindings.DB.prepare('INSERT INTO artifacts VALUES(?,?,?,?)').bind(artifact.id,artifact.documentCode,artifact.kind,JSON.stringify(artifact)).run();
 await env.bindings.DB.prepare('INSERT INTO revisions VALUES(?,?,?)').bind(revision.id,artifact.id,JSON.stringify(revision)).run();
 await env.bindings.DB.prepare('INSERT INTO decisions VALUES(?,?,?)').bind('appointment-approval',revision.id,JSON.stringify({id:'appointment-approval',revisionId:revision.id,decision:'approve',sourceSha256:revision.sourceSha256,actorId:'approver'})).run();
 return {artifact,revision};
}
