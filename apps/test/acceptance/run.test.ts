import {afterEach,expect,it} from 'vitest';
import app from '../../worker/src/index';
import {createTestEnvironment,type TestEnvironment} from '../support/environment';
import {createHttp} from './client';
import {DRAFT_ONLY,hash,type Inventory} from './inventory';
import {runRecords,type Checkpoint} from './run';
import {syntheticBundle} from '../support/fixtures';
import type {KnowledgeBundle} from '../../packages/contracts/src/index';
import {canonical,sha256} from '../../packages/knowledge/src/index';

let env:TestEnvironment;afterEach(async()=>env?.cleanup());
function fixture(code='SYN-001') {
 const bytes=Buffer.from(`---\ninformation_id: ${code}\nform_id: test-F01\ntemplate_version: 1.0\nstatus: 승인\n---\n# Synthetic acceptance\n`);
 const row={sourcePath:'docs/records/synthetic.md',sourceSha256:hash(bytes),informationId:code,formId:'test-F01',templateVersion:'1.0',title:'Synthetic acceptance',recordTypeId:'test-F01',templateRevisionId:'test-tpl-rev-1',targetSystemId:'',draftOnly:code===DRAFT_ONLY,actors:{author:'author',submitter:'author',reviewers:['reviewer'],approvers:['approver'],circulator:'author',recipients:['reader']},confirmations:[],issues:[]};
 return {bytes,row};
}
async function setup(code?:string,bundle?:KnowledgeBundle) {
 if(bundle){bundle.manifest.manifestHash='';bundle.manifest.manifestHash=await sha256(canonical(bundle));}
 env=await createTestEnvironment(bundle);const {bytes,row}=fixture(code),logs:any[]=[];
 const plan={schemaVersion:1,target:'local',baseUrl:'http://127.0.0.1:8787',context:{releaseId:env.bundle.manifest.releaseId,rulesHash:env.bundle.manifest.rulesHash,authorityRevision:0,dataRevision:0},persons:[],recordTypes:env.bundle.recordTypes,rows:[row]} as unknown as Inventory;
 const checkpoint:Checkpoint={planSha256:hash(JSON.stringify(plan)),operations:{},records:{}};
 const http=createHttp({baseUrl:plan.baseUrl,fetch:async(input,init)=>app.request(new Request(input,init),undefined,env.bindings)});
 const options={plan,runId:'synthetic',http,checkpoint,readSource:async()=>bytes,persist:async()=>{},record:async(entry:any)=>{logs.push(entry)}};
 return {options,logs};
}
it('runs the public upload/submit/review/approve/circulate/receipt flow and resumes without duplicate writes',async()=>{
 const {options,logs}=await setup();await runRecords(options);
 expect(options.checkpoint.records['SYN-001']).toMatchObject({appState:'approved',verification:'passed',error:null});
 const before=await env.bindings.DB.prepare('SELECT count(*) AS n FROM events').first();
 await runRecords(options);expect(await env.bindings.DB.prepare('SELECT count(*) AS n FROM events').first()).toEqual(before);
 expect(logs.map(row=>row.operation)).toEqual(expect.arrayContaining(['upload','submit','review:reviewer','approve:approver','circulate','receipt:reader:received','receipt:reader:understood']));
 expect(logs.every(row=>row.sourcePath&&row.sourceSha256&&row.informationId&&row.formId&&row.recordTypeId&&row.templateVersion&&row.templateRevisionId&&row.actors&&'targetSystemId' in row&&'appState' in row&&'error' in row&&'verification' in row&&row.context)).toBe(true);
});
it('reuses verified completed circulation and receipts across a new run and authority context without new business writes',async()=>{
 const {options,logs}=await setup();await runRecords(options);
 const before=await env.bindings.DB.prepare('SELECT count(*) AS n FROM events').first();
 const original=(await env.bindings.DB.prepare('SELECT body FROM circulations').all<{body:string}>()).results.map(row=>JSON.parse(row.body))[0];
 await env.bindings.DB.prepare('UPDATE context SET authority_revision=1').run();
 options.plan.context.authorityRevision=1;options.runId='synthetic-resume';options.checkpoint={planSha256:hash(JSON.stringify(options.plan)),operations:{},records:{}};
 await runRecords(options);
 expect(await env.bindings.DB.prepare('SELECT count(*) AS n FROM events').first()).toEqual(before);
 expect(options.checkpoint.records['SYN-001']).toMatchObject({appState:'approved',verification:'passed',disposition:'existing'});
 expect(logs).toEqual(expect.arrayContaining([expect.objectContaining({operation:'reuse-circulation',circulationId:original.id,circulationContext:original.context})]));
 expect(Object.keys(options.checkpoint.operations)).toHaveLength(0);
});
it('resubmits only a stale pending revision and preserves the old review round in history',async()=>{
 const {options}=await setup();const real=options.http;
 options.http=async(path,settings)=>{if(path.endsWith('/decisions')&&(settings?.json as any)?.decision==='approve')throw new Error('synthetic stop before approval');return real(path,settings) as any};
 await expect(runRecords(options)).rejects.toThrow('synthetic stop before approval');
 const oldDecisions=(await env.bindings.DB.prepare('SELECT id, body FROM decisions').all<{id:string;body:string}>()).results;
 expect(oldDecisions).toHaveLength(2);
 await env.bindings.DB.prepare('UPDATE context SET authority_revision=1').run();
 options.plan.context.authorityRevision=1;options.runId='synthetic-resume';options.checkpoint={planSha256:hash(JSON.stringify(options.plan)),operations:{},records:{}};options.http=real;
 await runRecords(options);
 const decisions=(await env.bindings.DB.prepare('SELECT id, body FROM decisions').all<{id:string;body:string}>()).results;
 for(const old of oldDecisions)expect(decisions.find(row=>row.id===old.id)).toEqual(old);
 expect(decisions.map(row=>JSON.parse(row.body).decision).sort()).toEqual(['approve','review','review','submit','submit']);
 const submissions=decisions.map(row=>JSON.parse(row.body)).filter(row=>row.decision==='submit');
 expect(submissions[0].submissionId).not.toEqual(submissions[1].submissionId);
 expect(options.checkpoint.records['SYN-001'].verification).toBe('passed');
});
it('resumes a partial prior circulation with only its missing receipt',async()=>{
 const {options,logs}=await setup();const real=options.http;
 options.http=async(path,settings)=>{if(path.endsWith('/receipts')&&(settings?.json as any)?.kind==='understood')throw new Error('synthetic stop before understanding');return real(path,settings) as any};
 await expect(runRecords(options)).rejects.toThrow('synthetic stop before understanding');
 const before=(await env.bindings.DB.prepare('SELECT count(*) AS n FROM events').first<{n:number}>())!.n;
 options.runId='synthetic-resume';options.checkpoint={planSha256:hash(JSON.stringify(options.plan)),operations:{},records:{}};options.http=real;
 await runRecords(options);
 expect((await env.bindings.DB.prepare('SELECT count(*) AS n FROM events').first<{n:number}>())!.n).toBe(before+1);
 expect((await env.bindings.DB.prepare('SELECT count(*) AS n FROM circulations').first<{n:number}>())!.n).toBe(1);
 expect(logs.at(-2)).toMatchObject({operation:'reuse-circulation'});
 expect(Object.values(options.checkpoint.operations).map(row=>row.payload.kind)).toEqual(['understood']);
});
it('rejects mismatched prior receipt evidence instead of treating a new run as completed',async()=>{
 const {options}=await setup();await runRecords(options);const real=options.http;
 const before=await env.bindings.DB.prepare('SELECT count(*) AS n FROM events').first();
 options.runId='synthetic-resume';options.checkpoint={planSha256:hash(JSON.stringify(options.plan)),operations:{},records:{}};
 options.http=async(path,settings)=>{const response=await real(path,settings);if(path==='/api/circulations?all=true')response.body.items[0].receipts[0].revisionId='different-revision';return response as any};
 await expect(runRecords(options)).rejects.toThrow('mismatched receipt evidence');
 expect(await env.bindings.DB.prepare('SELECT count(*) AS n FROM events').first()).toEqual(before);
 expect(options.checkpoint.records['SYN-001'].verification).toBe('failed');
});
it('does not reuse an old registered record when the current plan requires approval',async()=>{
 const bundle=await syntheticBundle();bundle.recordTypes.find(type=>type.id==='test-F01')!.approvalRequired=false;
 const {options}=await setup(undefined,bundle);options.plan.rows[0].actors.approvers=[];await runRecords(options);
 expect(options.checkpoint.records['SYN-001'].appState).toBe('registered');
 const before=await env.bindings.DB.prepare('SELECT count(*) AS n FROM events').first();options.plan.recordTypes.find(type=>type.id==='test-F01')!.approvalRequired=true;options.plan.rows[0].actors.approvers=['approver'];
 options.runId='synthetic-new-approval-contract';options.checkpoint={planSha256:hash(JSON.stringify(options.plan)),operations:{},records:{}};
 await expect(runRecords(options)).rejects.toThrow(/registered revision now requires approval/);
 expect(await env.bindings.DB.prepare('SELECT count(*) AS n FROM events').first()).toEqual(before);
});
it('leaves the designated in-progress record draft even if source says approved',async()=>{
 const {options,logs}=await setup(DRAFT_ONLY);await runRecords(options);
 expect(options.checkpoint.records[DRAFT_ONLY]).toMatchObject({appState:'draft',verification:'passed'});
 expect(logs.filter(row=>row.method==='POST').map(row=>row.operation)).toEqual(['upload']);
});
it('rejects an upload response that skips the required draft stage',async()=>{
 const {options}=await setup();const real=options.http;
 options.http=async(path,settings)=>{const result=await real(path,settings);return path==='/api/records'?{...result,body:{...result.body,status:'approved'}} as any:result as any};
 await expect(runRecords(options)).rejects.toThrow(/start as draft/);
 expect((await env.bindings.DB.prepare('SELECT count(*) AS n FROM decisions').first<{n:number}>())?.n).toBe(0);
});
it('replays the exact pending payload after a lost mutation response',async()=>{
 const {options}=await setup();let lost=false;const real=options.http;
 options.http=async(path,settings)=>{const result=await real(path,settings);if(path.endsWith('/submit')&&!lost){lost=true;throw new Error('synthetic lost response')}return result as any};
 await expect(runRecords(options)).rejects.toThrow('synthetic lost response');
 options.http=real;await runRecords(options);
 expect((await env.bindings.DB.prepare('SELECT body FROM decisions').all<{body:string}>()).results.map(row=>JSON.parse(row.body)).filter(row=>row.decision==='submit')).toHaveLength(1);
});
it('retries context conflicts once and stops on a denied decision',async()=>{
 const {options}=await setup();const real=options.http;let conflicts=0;
 options.http=async(path,settings)=>{
  if(path.endsWith('/submit')&&conflicts++===0)return {status:409,body:{error:{code:'CONTEXT_CONFLICT'}},headers:new Headers(),durationMs:0} as any;
  if(path.endsWith('/decisions'))return {status:403,body:{error:{code:'ACTION_DENIED'}},headers:new Headers(),durationMs:0} as any;
  return real(path,settings) as any;
 };
 await expect(runRecords(options)).rejects.toThrow('ACTION_DENIED');expect(conflicts).toBe(2);
 expect(options.checkpoint.records['SYN-001'].verification).toBe('failed');
 expect((await env.bindings.DB.prepare('SELECT count(*) AS n FROM circulations').first<{n:number}>())?.n).toBe(0);
});
it('verifies source-supported approval denial without approval, circulation or duplicate writes on resume',async()=>{
 const bundle=await syntheticBundle();
 for(const policy of bundle.policies.filter(p=>p.action==='approve'))policy.conditions=[{field:'requiredControlsVerified',equals:true,reason:'Synthetic controls must be verified',evidenceRefs:policy.evidenceRefs}];
 const {options,logs}=await setup(undefined,bundle);
 options.plan.rows[0].confirmations=[{field:'requiredControlsVerified',value:false,lineStart:7,lineEnd:7,quote:'# Synthetic acceptance',comment:'Synthetic pending-control case',personId:'reviewer'}];
 await runRecords(options);
 expect(options.checkpoint.records['SYN-001']).toMatchObject({appState:'reviewed',verification:'passed',expectedOutcome:'approval-denied'});
 expect(logs).toEqual(expect.arrayContaining([expect.objectContaining({operation:'approval-denied:approver',status:403,error:'ACTION_DENIED'})]));
 const before=await env.bindings.DB.prepare('SELECT count(*) AS n FROM events').first();await runRecords(options);
 expect(await env.bindings.DB.prepare('SELECT count(*) AS n FROM events').first()).toEqual(before);
 expect((await env.bindings.DB.prepare('SELECT body FROM decisions').all<{body:string}>()).results.map(r=>JSON.parse(r.body)).some(r=>r.decision==='approve')).toBe(false);
 expect((await env.bindings.DB.prepare('SELECT count(*) AS n FROM circulations').first<{n:number}>())?.n).toBe(0);
});
it('keeps unfinished controls false while explicitly approving and circulating only the record scope',async()=>{
 const bundle=await syntheticBundle(),policy=bundle.policies.find(policy=>policy.resourceTypeId==='test-F01'&&policy.action==='approve')!;
 policy.conditions=[{field:'requiredControlsVerified',equals:true,reason:'Synthetic outcome requires completed controls',evidenceRefs:policy.evidenceRefs}];
 const recordPolicy={...structuredClone(policy),id:'test-F01-record-approve',approvalScope:'record' as const,conditions:[]};bundle.policies.push(recordPolicy);
 const type=bundle.recordTypes.find(type=>type.id==='test-F01')!;type.recordApproval={label:'Synthetic record approval',limitations:'Does not approve execution or control completion'};
 const {options,logs}=await setup(undefined,bundle);options.plan.rows[0].approvalScope='record';
 options.plan.rows[0].confirmations=[{field:'requiredControlsVerified',value:false,lineStart:7,lineEnd:7,quote:'# Synthetic acceptance',comment:'Synthetic pending-control case',personId:'reviewer'}];
 await runRecords(options);
 expect(options.checkpoint.records['SYN-001']).toMatchObject({appState:'approved',verification:'passed',expectedOutcome:'record-approved'});
 expect(logs).toEqual(expect.arrayContaining([expect.objectContaining({operation:'outcome-scope-denied:approver',status:409,error:'APPROVAL_SCOPE_CONFLICT'})]));
 const revision=JSON.parse((await env.bindings.DB.prepare('SELECT body FROM revisions WHERE id=?').bind(options.checkpoint.records['SYN-001'].revisionId).first<{body:string}>())!.body);
 expect(revision).toMatchObject({approvalScope:'record',conditions:{requiredControlsVerified:false}});
 const approvals=(await env.bindings.DB.prepare('SELECT body FROM decisions').all<{body:string}>()).results.map(row=>JSON.parse(row.body)).filter(row=>row.decision==='approve');expect(approvals).toHaveLength(1);expect(approvals[0].approvalScope).toBe('record');
 const before=await env.bindings.DB.prepare('SELECT count(*) AS n FROM events').first();options.runId='synthetic-record-resume';options.checkpoint={planSha256:hash(JSON.stringify(options.plan)),operations:{},records:{}};
 await runRecords(options);expect(await env.bindings.DB.prepare('SELECT count(*) AS n FROM events').first()).toEqual(before);
});
it('fails when the ERP approves a pending-control case instead of silently accepting the unexpected approval',async()=>{
 const bundle=await syntheticBundle();
 for(const policy of bundle.policies.filter(p=>p.action==='approve'))policy.conditions=[{field:'requiredControlsVerified',equals:false,reason:'Synthetic incorrect approval policy',evidenceRefs:policy.evidenceRefs}];
 const {options}=await setup(undefined,bundle);
 options.plan.rows[0].confirmations=[{field:'requiredControlsVerified',value:false,lineStart:7,lineEnd:7,quote:'# Synthetic acceptance',comment:'Synthetic pending-control case',personId:'reviewer'}];
 await expect(runRecords(options)).rejects.toThrow(/expected.*403.*ACTION_DENIED/i);
 expect(options.checkpoint.records['SYN-001'].verification).toBe('failed');
 expect((await env.bindings.DB.prepare('SELECT count(*) AS n FROM circulations').first<{n:number}>())?.n).toBe(0);
});
