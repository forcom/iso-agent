import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {defineConfig} from '@playwright/test';
import {hash,requestKey,targetUrl,type Target} from './inventory';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const target=process.env.ACCEPTANCE_TARGET as Target,runId=process.env.ACCEPTANCE_RUN_ID??'';
const baseURL=targetUrl(target,process.env.ACCEPTANCE_BASE_URL);requestKey(runId,target,'screens','validation');
assert.ok(process.env.ACCEPTANCE_PLAN&&process.env.ACCEPTANCE_SAMPLE_CODE,'Use the guarded acceptance/run.ts --screens launcher');
assert.equal(hash(readFileSync(process.env.ACCEPTANCE_PLAN)),process.env.ACCEPTANCE_SCREEN_AUTHORIZED,'Screen preflight authorization missing');
const output=resolve(root,'output/test/acceptance',runId,target,'screens');
process.env.PLAYWRIGHT_BROWSERS_PATH=resolve(root,'output/test/browsers');
export default defineConfig({
 testDir:'.',testMatch:'screens.spec.ts',outputDir:resolve(output,'results'),fullyParallel:false,workers:1,timeout:900_000,retries:0,
 reporter:[['list'],['html',{outputFolder:resolve(output,'report'),open:'never'}]],
 use:{baseURL,browserName:'chromium',trace:'off',video:'off',screenshot:'only-on-failure'},
});
