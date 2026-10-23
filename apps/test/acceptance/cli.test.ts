import {expect,it} from 'vitest';
import {main,validatePrerequisites,validatePlan} from './cli';
import {hash,type Inventory} from './inventory';
import {stable} from './client';

it('requires explicit target/run/plan and refuses a different remote URL before reads or writes',async()=>{
 await expect(main([])).rejects.toThrow(/Required/);
 await expect(main(['--target','remote','--run-id','synthetic','--plan','synthetic.json','--base-url','https://other.invalid'])).rejects.toThrow(/pinned/);
});
it('blocks an unconfirmed human oracle before reading originals or operational policy inputs',async()=>{
 const forms=Array.from({length:54},(_,index)=>`SYN-F${index}`);
 const oracle={schemaVersion:1,authoredBy:{kind:'ai',name:'Synthetic'},formCodes:forms,humanAuthor:null,humanReviewer:null,rows:forms.flatMap(formCode=>['create','revise','submit','review','approve','reject','circulate'].map(action=>({formCode,action,allowedRoles:[],allowedPersons:[],deniedSamples:[],source:{path:'docs/procedure/synthetic.md',clause:'1',quote:'synthetic',sha256:'a'.repeat(64)},additionalSources:[],status:'approved',note:'Synthetic fixture only',condition:null,separation:null,states:[]})))};
 const bytes=Buffer.from(JSON.stringify(oracle)),reads:string[]=[];
 const recordTypes=forms.map(code=>({id:code,code,templateRevisionId:`${code}-revision`}));
 const plan={schemaVersion:1,target:'local',baseUrl:'http://127.0.0.1:8787',oraclePath:'synthetic-oracle.json',oracleSha256:hash(bytes),recordTypes,rows:Array.from({length:74},(_,index)=>({sourcePath:`docs/records/synthetic-${index}.md`,informationId:`SYN-${index}`,formId:forms[index%54],recordTypeId:forms[index%54],templateRevisionId:`${forms[index%54]}-revision`,draftOnly:false,issues:[],confirmations:[],actors:{author:'synthetic',submitter:'synthetic',reviewers:['reviewer'],approvers:[],circulator:'synthetic',recipients:['recipient']}}))} as unknown as Inventory;
 await expect(validatePlan(plan,async path=>{reads.push(path);return bytes})).rejects.toThrow(/human confirmations/);
 expect(reads).toEqual(['synthetic-oracle.json']);
});
it('requires same-input completed local acceptance, verified reset rehearsal and a remote backup',async()=>{
 const rows=[{informationId:'SYN-001',sourceSha256:'synthetic-hash'}],reports:Record<string,any>={
  local:{kind:'erp-records-acceptance',target:'local',status:'passed',inputSha256:hash(stable([['SYN-001','synthetic-hash']])),releaseId:'release',scenarios:Object.fromEntries(Array.from({length:18},(_,i)=>[`AT-${String(i+1).padStart(2,'0')}`,'passed']))},
  rehearsal:{kind:'maintenance-rehearsal',target:'local',status:'passed',sourceReadOnly:true,originalUnchanged:true,backupRestored:true,idempotent:true},
  backup:{kind:'maintenance-backup',target:'remote',status:'passed',snapshotPath:'synthetic',snapshotHash:'hash',stateHash:'hash',createdAt:'2026-10-23'},
 };
 const plan={target:'remote',rows,context:{releaseId:'release'},prerequisites:{}} as unknown as Inventory;
 await expect(validatePrerequisites(plan,async()=>Buffer.from(''))).rejects.toThrow(/missing/);
 for(const [key,name] of [['localAcceptanceReport','local'],['resetRehearsalReport','rehearsal'],['remoteBackupReport','backup']] as const)plan.prerequisites[key]={path:`output/test/acceptance/synthetic/${name}.json`,sha256:hash(JSON.stringify(reports[name]))};
 const read=async(path:string)=>Buffer.from(JSON.stringify(reports[path.split('/').at(-1)!.replace('.json','')]));
 await expect(validatePrerequisites(plan,read)).resolves.toBeUndefined();
 reports.local.status='failed';await expect(validatePrerequisites(plan,read)).rejects.toThrow(/Changed prerequisite/);
 plan.prerequisites.localAcceptanceReport!.sha256=hash(JSON.stringify(reports.local));await expect(validatePrerequisites(plan,read)).rejects.toThrow(/not passed/);
});
it('blocks local writes until the actual clone rehearsal has passed',async()=>{
 const plan={target:'local',rows:[],context:{},prerequisites:{}} as unknown as Inventory;
 await expect(validatePrerequisites(plan,async()=>Buffer.from(''))).rejects.toThrow(/local prerequisite missing: resetRehearsalReport/);
 const report={kind:'maintenance-rehearsal',target:'local',status:'passed',sourceReadOnly:true,originalUnchanged:true,backupRestored:true,idempotent:true,provenanceRepaired:false};
 const read=async()=>Buffer.from(JSON.stringify(report));plan.prerequisites.resetRehearsalReport={path:'output/test/acceptance/synthetic/rehearsal/maintenance-report.json',sha256:hash(await read())};
 await expect(validatePrerequisites(plan,read)).resolves.toBeUndefined();
 report.provenanceRepaired=true;plan.prerequisites.resetRehearsalReport.sha256=hash(await read());
 await expect(validatePrerequisites(plan,read)).rejects.toThrow(/provenance/);
 report.provenanceRepaired=false;
 report.backupRestored=false;plan.prerequisites.resetRehearsalReport.sha256=hash(await read());
 await expect(validatePrerequisites(plan,read)).rejects.toThrow(/backupRestored/);
});
