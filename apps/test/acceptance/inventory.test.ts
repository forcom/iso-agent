import {expect,it} from 'vitest';
import {assertInventory,hash,metadata,requestKey,targetUrl,validateSources,validateActors,type Inventory,type InventoryRow} from './inventory';

const bytes=Buffer.from('---\ninformation_id: SYN-001\nform_id: SYN-F01\ntemplate_version: "1.0"\nstatus: 승인\n---\n# Synthetic\n');
const row={sourcePath:'docs/records/synthetic.md',sourceSha256:'',informationId:'SYN-001',formId:'SYN-F01',templateVersion:'1.0'} as InventoryRow;
it('requires a declared record approval scope before a prepared plan can use it',()=>{
 const source={...row,recordTypeId:'type',templateRevisionId:'template',draftOnly:false,approvalScope:'record',actors:{author:'author',submitter:'author',reviewers:['reviewer'],approvers:['approver'],circulator:'author',recipients:['reader']},confirmations:[],issues:[]};
 const type:any={id:'type',code:'SYN-F01',templateRevisionId:'template',reviewRequired:true,approvalRequired:true};
 const plan={schemaVersion:1,target:'local',baseUrl:'http://127.0.0.1:5173',rows:[source],recordTypes:[type]} as unknown as Inventory;
 expect(()=>assertInventory(plan,1)).toThrow(/not defined/);type.recordApproval={label:'Record approval',limitations:'No outcome approval'};expect(()=>assertInventory(plan,1)).not.toThrow();
 source.approvalScope='invented';expect(()=>assertInventory(plan,1)).toThrow(/Invalid approval scope/);
});
it('rejects an unintended target or unsafe run directory',()=>{
 expect(targetUrl('local')).toBe('http://127.0.0.1:5173');
 expect(targetUrl('remote')).toBe('https://iso-agent-demo.your-e37.workers.dev');
 expect(()=>targetUrl('remote','https://other.invalid')).toThrow();
 expect(()=>targetUrl('local','https://demo.invalid')).toThrow();
 expect(()=>requestKey('../escape','local','SYN-001','upload')).toThrow();
 expect(requestKey('synthetic','local','SYN-001','upload')).toBe(requestKey('synthetic','local','SYN-001','upload'));
 expect(requestKey('synthetic','local','SYN-001','upload')).not.toBe(requestKey('synthetic','remote','SYN-001','upload'));
});
it('does not accept a selected actor outside the independent oracle or invented condition evidence',()=>{
 const source={...row,sourceSha256:hash(bytes),actors:{author:'person-1',submitter:'person-1',reviewers:['person-2'],approvers:[],circulator:'person-1',recipients:['person-2']},confirmations:[]} as InventoryRow;
 const plan={persons:[{id:'person-1',personaId:'P01',name:'Author'},{id:'person-2',personaId:'P02',name:'Reviewer'}],rows:[source]} as Inventory;
 const oracle={rows:['create','submit','review','circulate'].map(action=>({formCode:'SYN-F01',action,allowedPersons:[{personaId:action==='review'?'P02':'P01',name:action==='review'?'Reviewer':'Author',scope:'all'}]}))} as any;
 expect(()=>validateActors(plan,oracle)).not.toThrow();
 source.actors.reviewers=['person-1'];expect(()=>validateActors(plan,oracle)).toThrow(/oracle/);
});
it('checks original bytes and explicit frontmatter before any upload',async()=>{
 const source={...row,sourceSha256:hash(bytes)};
 expect(metadata(bytes)).toMatchObject({information_id:'SYN-001',form_id:'SYN-F01',template_version:'1.0'});
 await expect(validateSources([source],async()=>bytes)).resolves.toBeUndefined();
 await expect(validateSources([source],async()=>Buffer.concat([bytes,Buffer.from('changed')]))).rejects.toThrow(/hash/);
 await expect(validateSources([{...source,informationId:'forged'}],async()=>bytes)).rejects.toThrow(/information_id/);
 await expect(validateSources([{...source,sourcePath:'docs/records/../../.dev.vars'}],async()=>bytes)).rejects.toThrow(/source path/);
});
it('rejects a valid employee assigned to another record of the same form',()=>{
 const source={...row,sourceSha256:hash(bytes),targetSystemId:'system-id',targetSystemCode:'synthetic',actors:{author:'person-1',submitter:'person-1',reviewers:['person-2'],approvers:[],circulator:'person-1',recipients:[]},confirmations:[]} as InventoryRow;
 const first={personaId:'P01',name:'Author',scope:'all'},second={personaId:'P02',name:'Reviewer',scope:'all'};
 const plan={persons:[{id:'person-1',...first},{id:'person-2',...second}],rows:[source]} as unknown as Inventory;
 const oracle={rows:['create','submit','review','circulate'].map(action=>({formCode:'SYN-F01',action,allowedPersons:[first,second],recordCases:[{informationId:'SYN-001',sourcePath:source.sourcePath,sourceSha256:source.sourceSha256,systemCode:'synthetic',allowedPersons:[action==='review'?second:first]}]}))} as any;
 expect(()=>validateActors(plan,oracle)).not.toThrow();
 source.actors.reviewers=['person-1'];expect(()=>validateActors(plan,oracle)).toThrow(/oracle/);
 source.actors.reviewers=['person-2'];source.sourceSha256=hash('changed');expect(()=>validateActors(plan,oracle)).toThrow(/oracle/);
 source.sourceSha256=hash(bytes);source.targetSystemId='';expect(()=>validateActors(plan,oracle)).toThrow(/oracle/);
});
