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
it('fails when the ERP approves a pending-control case instead of silently accepting the unexpected approval',async()=>{
 const bundle=await syntheticBundle();
 for(const policy of bundle.policies.filter(p=>p.action==='approve'))policy.conditions=[{field:'requiredControlsVerified',equals:false,reason:'Synthetic incorrect approval policy',evidenceRefs:policy.evidenceRefs}];
 const {options}=await setup(undefined,bundle);
 options.plan.rows[0].confirmations=[{field:'requiredControlsVerified',value:false,lineStart:7,lineEnd:7,quote:'# Synthetic acceptance',comment:'Synthetic pending-control case',personId:'reviewer'}];
 await expect(runRecords(options)).rejects.toThrow(/expected.*403.*ACTION_DENIED/i);
 expect(options.checkpoint.records['SYN-001'].verification).toBe('failed');
 expect((await env.bindings.DB.prepare('SELECT count(*) AS n FROM circulations').first<{n:number}>())?.n).toBe(0);
});
