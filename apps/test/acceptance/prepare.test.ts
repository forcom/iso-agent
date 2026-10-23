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
