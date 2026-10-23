import {afterEach,expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../../',import.meta.url)),dirs:string[]=[];
afterEach(async()=>{for(const dir of dirs.splice(0))await rm(dir,{recursive:true,force:true})});
async function caseDir(){const base=resolve(root,'output/test/podman');await mkdir(base,{recursive:true});const dir=await mkdtemp(resolve(base,'case-'));dirs.push(dir);return dir}
async function run(args:string[],extra:Record<string,string>={},dir?:string){
 dir??=await caseDir();
 const log=resolve(dir,'calls.jsonl');
 await writeFile(resolve(dir,'podman'),`#!/usr/bin/env node
import fs from 'node:fs';const args=process.argv.slice(2);fs.appendFileSync(process.env.CALL_LOG,JSON.stringify(args)+'\\n');
if(args[0]==='push'){if(process.env.PUSH_STATUS)process.exit(Number(process.env.PUSH_STATUS));fs.writeFileSync(args[2],process.env.PUSHED_DIGEST+'\\n');}
if(args[0]==='image'&&args[1]==='inspect'){
 if(process.env.INSPECT_STATUS)process.exit(Number(process.env.INSPECT_STATUS));
 if(args.includes('{{.Digest}}'))process.stdout.write(process.env.CURRENT_DIGEST+'\\n');
 else process.stdout.write(JSON.stringify(['registry.example/repo@sha256:old','registry.example/repo@sha256:stale'])+'\\n');
}
`,{mode:0o755});
 const result=spawnSync(process.execPath,[resolve(root,'apps/engine/podman-docker.mjs'),...args],{encoding:'utf8',env:{...process.env,PATH:`${dir}:${process.env.PATH}`,CALL_LOG:log,PODMAN_DIGEST_DIR:resolve(dir,'digests'),PUSHED_DIGEST:`sha256:${'b'.repeat(64)}`,CURRENT_DIGEST:`sha256:${'a'.repeat(64)}`,...extra}});
 const calls=(await readFile(log,'utf8').catch(()=>'')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
 return {result,calls};
}
it('records the registry digest at push time and reports it for the pushed tag',async()=>{
 const image='registry.example/repo:version',dir=await caseDir();
 const push=await run(['push',image],{},dir);expect(push.result.status).toBe(0);
 expect(push.calls).toHaveLength(1);expect(push.calls[0].slice(0,2)).toEqual(['push','--digestfile']);expect(push.calls[0].at(-1)).toBe(image);
 const inspect=await run(['image','inspect',image,'--format','{{ json .RepoDigests }}'],{},dir);
 expect(JSON.parse(inspect.result.stdout)).toEqual([`registry.example/repo@sha256:${'b'.repeat(64)}`]);expect(inspect.calls).toEqual(push.calls);
 const pushFailure=await run(['push',image],{PUSH_STATUS:'17'});expect(pushFailure.result.status).toBe(17);
});
it('falls back to the current local digest for an image this adapter did not push',async()=>{
 const image='registry.example:5000/team/repo:version';
 const {result,calls}=await run(['image','inspect',image,'--format','{{ json .RepoDigests }}']);
 expect(result.status).toBe(0);expect(JSON.parse(result.stdout)).toEqual([`registry.example:5000/team/repo@sha256:${'a'.repeat(64)}`]);
 expect(calls).toEqual([['image','inspect',image,'--format','{{.Digest}}']]);
});
it('refuses an unavailable or malformed current digest',async()=>{
 expect((await run(['image','inspect','registry.example/repo:v1','--format','{{ json .RepoDigests }}'],{INSPECT_STATUS:'12'})).result.status).toBe(12);
 const invalid=await run(['image','inspect','registry.example/repo:v1','--format','{{ json .RepoDigests }}'],{CURRENT_DIGEST:''});
 expect(invalid.result.status).toBe(1);expect(invalid.result.stdout).toBe('');
});
it('preserves build adjustments and unrelated commands',async()=>{
 expect((await run(['build','--load','--provenance=false','-t','image','.'])).calls).toEqual([['build','-t','image','.']]);
 for(const args of [['login','registry.example'],['tag','source','destination'],['image','rm','old'],['image','inspect','image','--format','{{.Id}}']])expect((await run(args)).calls).toEqual([args]);
});
