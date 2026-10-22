import {describe,expect,it} from 'vitest';
import {demoBindingsConfiguration,installationEnvironment} from '../../seed/scripts/deployment';

function configuration(){return {name:'iso-agent-demo',account_id:'1234567890abcdef1234567890abcdef',compatibility_date:'2025-10-01',vars:{ALLOW_FICTIONAL_PERSONNEL:'true',UNRELATED_SECRET:'do not copy'},d1_databases:[{binding:'DB',database_name:'iso-agent-demo',database_id:'12345678-abcd-4000-8000-123456789012',remote:true}],r2_buckets:[{binding:'SOURCES',bucket_name:'iso-agent-demo-sources',remote:true}],durable_objects:{bindings:[{name:'ENGINE',class_name:'UnneededContainer'}]}}}

describe('explicit deployment-only targets',()=>{
 it('requires the exact local or demo CLI environment',()=>{
  expect(installationEnvironment('local')).toBe('local');expect(installationEnvironment('demo')).toBe('demo');
  for(const value of [undefined,'production','staging','iso-test-demo'])expect(()=>installationEnvironment(value)).toThrow();
 });
 it('keeps only verified demo D1/R2 bindings and the fictional flag',()=>{
  const actual=demoBindingsConfiguration(configuration());
  expect(actual).toEqual({name:'iso-agent-demo-installation',account_id:'1234567890abcdef1234567890abcdef',compatibility_date:'2025-10-01',vars:{ALLOW_FICTIONAL_PERSONNEL:'true'},d1_databases:[{binding:'DB',database_name:'iso-agent-demo',database_id:'12345678-abcd-4000-8000-123456789012',remote:true}],r2_buckets:[{binding:'SOURCES',bucket_name:'iso-agent-demo-sources',remote:true}]});
 });
 it.each([
  ['worker name',(c:any)=>{c.name='iso-agent'}],
  ['account',(c:any)=>{c.account_id=''}],
  ['database name',(c:any)=>{c.d1_databases[0].database_name='iso-agent-production'}],
  ['placeholder database',(c:any)=>{c.d1_databases[0].database_id='00000000-0000-0000-0000-000000000002'}],
  ['invalid database ID',(c:any)=>{c.d1_databases[0].database_id='local-iso-agent'}],
  ['local database',(c:any)=>{c.d1_databases[0].remote=false}],
  ['bucket name',(c:any)=>{c.r2_buckets[0].bucket_name='iso-agent-sources'}],
  ['local bucket',(c:any)=>{c.r2_buckets[0].remote=false}],
  ['fictional setting',(c:any)=>{c.vars.ALLOW_FICTIONAL_PERSONNEL='false'}],
  ['unexpected database',(c:any)=>{c.d1_databases.push({...c.d1_databases[0],binding:'OTHER'})}],
 ])('rejects unsafe %s before opening any proxy',(_label,mutate)=>{
  const value=configuration();mutate(value);expect(()=>demoBindingsConfiguration(value)).toThrow(/demo|Demo/);
 });
});
