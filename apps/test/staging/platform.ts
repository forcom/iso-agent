import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {execFileSync} from 'node:child_process';
import type {Env} from '../../worker/src/types';
import {repoRoot} from '../support/environment';

export const stagingDirectory=resolve(repoRoot,'output/test/staging');
export function validateStagingConfig(config:any,remoteDatabase:{uuid:string;name:string}){
 assert.match(config.name,/^iso-test-g10-[a-z0-9-]+$/);
 assert.equal(config.vars?.APP_NAME,config.name);
 assert.match(config.account_id,/^[a-f\d]{32}$/);
 assert.equal(config.d1_databases?.length,1);assert.equal(config.r2_buckets?.length,1);
 const db=config.d1_databases[0],bucket=config.r2_buckets[0];
 assert.equal(db.binding,'DB');assert.equal(db.database_name,config.name);assert.equal(db.remote,true);
 assert.equal(db.database_id,remoteDatabase.uuid);assert.equal(remoteDatabase.name,config.name);
 assert.ok(!db.preview_database_id||db.preview_database_id===db.database_id);
 assert.equal(bucket.binding,'SOURCES');assert.equal(bucket.bucket_name,`${config.name}-sources`);assert.equal(bucket.remote,true);
 assert.ok(!bucket.preview_bucket_name||bucket.preview_bucket_name===bucket.bucket_name);
 assert.equal(config.durable_objects?.bindings?.length,1);
 assert.deepEqual(config.durable_objects.bindings[0],{name:'ENGINE',class_name:'G10Engine'});
 assert.equal(config.containers?.length,1);assert.equal(config.containers[0].class_name,'G10Engine');
 return config;
}
export async function openStaging(configPath=resolve(stagingDirectory,'wrangler.json')){
 const path=resolve(configPath),rel=relative(stagingDirectory,path);
 assert.ok(!rel.startsWith('..')&&!rel.startsWith('/'),'Staging config must be inside output/test/staging');
 const config=JSON.parse(await readFile(path,'utf8'));
 // Verify the remote ID's real name before exposing any writable bindings.
 assert.match(config.d1_databases?.[0]?.database_id??'',/^[a-f\d-]{36}$/);
 process.env.WRANGLER_LOG_PATH=resolve(stagingDirectory,'logs');process.env.WRANGLER_CACHE_DIR=resolve(stagingDirectory,'cache');
 const require=createRequire(resolve(repoRoot,'apps/worker/package.json'));
 const info=JSON.parse(execFileSync(process.execPath,[resolve(repoRoot,'apps/worker/node_modules/wrangler/bin/wrangler.js'),'d1','info',config.d1_databases[0].database_id,'--json','--config',path],{encoding:'utf8',env:process.env}));
 validateStagingConfig(config,info);
 const db=config.d1_databases[0],bucket=config.r2_buckets[0];
 const bindings={name:`${config.name}-bindings`,account_id:config.account_id,compatibility_date:config.compatibility_date,d1_databases:[{binding:'DB',database_name:db.database_name,database_id:db.database_id,remote:true}],r2_buckets:[{binding:'SOURCES',bucket_name:bucket.bucket_name,remote:true}]};
 await mkdir(stagingDirectory,{recursive:true});const bindingsPath=resolve(stagingDirectory,'bindings.json');await writeFile(bindingsPath,JSON.stringify(bindings,null,2));
 const wrangler=require('wrangler') as {getPlatformProxy(options:object):Promise<{env:Env;dispose():Promise<void>}>};
 return {...await wrangler.getPlatformProxy({configPath:bindingsPath,remoteBindings:true,envFiles:[],persist:false}),config};
}
