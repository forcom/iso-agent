import {expect,it} from 'vitest';
import {prepareInventory} from './prepare';
import {createHttp} from './client';

it('prepares IDs from read-only installed APIs and leaves unknown scope/conditions blocked',async()=>{
 const calls:string[]=[];
 const http=createHttp({baseUrl:'http://synthetic.invalid',fetch:async(input,init)=>{
  const request=new Request(input,init);calls.push(`${request.method} ${new URL(request.url).pathname}`);
  const path=new URL(request.url).pathname;
  if(path==='/api/me')return Response.json({context:{releaseId:'installed',rulesHash:'rules',authorityRevision:1,dataRevision:2}});
  if(path==='/api/persons')return Response.json({items:[{id:'person-uuid',personaId:'P01',name:'Person'}]});
  if(path==='/api/entities')return Response.json({items:[{id:'type-uuid',type:'RecordType',metadata:{id:'type-uuid',code:'SYN-F01',templateRevisionId:'template-revision',templateArtifactId:'template-id',reviewRequired:true,approvalRequired:true}}]});
  return Response.json({evidenceStatus:'verified',markdown:'---\ninformation_id: SYN-F01\ntemplate_version: 1.0\n---\n# Template'});
 }});
 const plan=await prepareInventory({target:'local',baseUrl:'http://127.0.0.1:8787',http,client:{personId:'existing',cookie:'iso_session=secret',version:1},oracle:{rows:[]} as any,oraclePath:'oracle.json',oracleSha256:'hash',policySha256:'hash',sources:[{path:'docs/records/synthetic.md',bytes:Buffer.from('---\ninformation_id: SYN-001\nform_id: SYN-F01\ntemplate_version: 1.0\nstatus: 승인\n---\n# Record')}]});
 expect(calls.every(call=>call.startsWith('GET '))).toBe(true);
 expect(plan.rows[0]).toMatchObject({recordTypeId:'type-uuid',templateRevisionId:'template-revision',draftOnly:false});
 expect(plan.rows[0].issues.length).toBeGreaterThan(0);expect(JSON.stringify(plan)).not.toContain('iso_session');
});

it('selects only the frozen case assignee and derives its documented system',async()=>{
 const bytes=Buffer.from('---\ninformation_id: SYN-001\nform_id: SYN-F01\ntemplate_version: 1.0\n---\n# Synthetic');
 const {hash}=await import('./inventory');
 const http=createHttp({baseUrl:'http://synthetic.invalid',fetch:async(input)=>{
  const path=new URL(new Request(input).url).pathname;
  if(path==='/api/me')return Response.json({context:{releaseId:'installed'}});
  if(path==='/api/persons')return Response.json({items:[{id:'one',personaId:'S01',name:'One'},{id:'two',personaId:'S02',name:'Two'}]});
  if(path==='/api/entities')return Response.json({items:[{id:'system-id',type:'AISystem',metadata:{code:'synthetic-system'}}]});
  throw Error('Unexpected request');
 }});
 const one={personaId:'S01',name:'One',scope:'synthetic-system'},two={personaId:'S02',name:'Two',scope:'synthetic-system'};
 const oracle={rows:['create','submit','review','approve','circulate'].map(action=>({formCode:'SYN-F01',action,allowedPersons:[one,two],recordCases:[{informationId:'SYN-001',sourcePath:'docs/records/synthetic.md',sourceSha256:hash(bytes),systemCode:'synthetic-system',allowedPersons:[two]}]}))} as any;
 const input={target:'local' as const,baseUrl:'http://127.0.0.1:8787',http,client:{personId:'existing',cookie:'iso_session=secret',version:1},oracle,oraclePath:'oracle.json',oracleSha256:'hash',policySha256:'hash',sources:[{path:'docs/records/synthetic.md',bytes}]};
 const plan=await prepareInventory(input);
 expect(plan.rows[0]).toMatchObject({targetSystemId:'system-id',targetSystemCode:'synthetic-system',actors:{author:'two',reviewers:['two']}});
 const changed=await prepareInventory({...input,sources:[{...input.sources[0],bytes:Buffer.concat([bytes,Buffer.from('\nchanged')])}]});
 expect(changed.rows[0].actors.author).toBe('');
});
