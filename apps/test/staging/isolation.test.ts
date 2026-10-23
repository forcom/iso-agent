import {expect,it} from 'vitest';
import {validateStagingConfig} from './platform';
const name='iso-test-g10-fixture',id='11111111-2222-3333-4444-555555555555';
const config={name,account_id:'a'.repeat(32),vars:{APP_NAME:name},d1_databases:[{binding:'DB',database_name:name,database_id:id,remote:true}],r2_buckets:[{binding:'SOURCES',bucket_name:`${name}-sources`,remote:true}],durable_objects:{bindings:[{name:'ENGINE',class_name:'G10Engine'}]},containers:[{class_name:'G10Engine'}]};
it('rejects an aliased production database or bucket before staging writes',()=>{
 expect(()=>validateStagingConfig(config,{uuid:id,name})).not.toThrow();
 expect(()=>validateStagingConfig(config,{uuid:id,name:'production'})).toThrow();
 const bucket=structuredClone(config);bucket.r2_buckets[0].bucket_name='production-sources';expect(()=>validateStagingConfig(bucket,{uuid:id,name})).toThrow();
 const worker=structuredClone(config);worker.name='iso-agent-demo';expect(()=>validateStagingConfig(worker,{uuid:id,name})).toThrow();
 const engine=structuredClone(config);(engine.durable_objects.bindings[0] as any).script_name='production';expect(()=>validateStagingConfig(engine,{uuid:id,name})).toThrow();
 const preview=structuredClone(config);(preview.d1_databases[0] as any).preview_database_id='production-id';expect(()=>validateStagingConfig(preview,{uuid:id,name})).toThrow();
 const previewBucket=structuredClone(config);(previewBucket.r2_buckets[0] as any).preview_bucket_name='production-sources';expect(()=>validateStagingConfig(previewBucket,{uuid:id,name})).toThrow();
});
