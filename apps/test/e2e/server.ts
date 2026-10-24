import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { createServer as createViteServer } from 'vite';
import react from '@vitejs/plugin-react';
import app from '../../worker/src/index';
import { createTestEnvironment, repoRoot } from '../support/environment';
import { startTestEngine } from '../support/engine';
import {installAppointment} from '../support/appointment';
import {loadFixture} from '../support/fixtures';
import {canonical,sha256} from '../../packages/knowledge/src/index';

// The browser harness only uses synthetic data and isolated local D1/R2 state.
const stopEngine = await startTestEngine();
const environment = await createTestEnvironment();
const port=Number(process.env.ISO_TEST_WEB_PORT??4173);
const scopedType=environment.bundle.recordTypes.find(type=>type.id==='test-F01')!;
scopedType.recordApproval={label:'계획 승인',limitations:'계획 문서만 승인합니다. 실제 운영·잔여 리스크 수용·시정조치 종결을 승인하지 않습니다.'};
const scopedApproval={...environment.bundle.policies.find(policy=>policy.id==='test-F01-approve')!,id:'test-F01-approve-record',approvalScope:'record' as const};
environment.bundle.policies.push(scopedApproval);environment.bundle.mappings.policies.push(structuredClone(scopedApproval));
environment.bundle.mappings.recordTypes.find(type=>type.id==='test-F01')!.recordApproval=scopedType.recordApproval;
scopedType.actionCoverage.find(coverage=>coverage.action==='approve')!.policyIds.push(scopedApproval.id);
environment.bundle.manifest.manifestHash='';environment.bundle.manifest.manifestHash=await sha256(canonical(environment.bundle));
await environment.bindings.SOURCES.put('releases/test-release.json',JSON.stringify(environment.bundle));
await environment.bindings.DB.prepare('UPDATE releases SET body=? WHERE id=?').bind(JSON.stringify(environment.bundle.manifest),environment.bundle.manifest.releaseId).run();
await environment.bindings.DB.prepare('INSERT INTO persons VALUES(?,?)').bind('appointment-reader',JSON.stringify({id:'appointment-reader',name:'시험 appointment-reader',active:true,isAdmin:false})).run();
await installAppointment(environment,(await loadFixture('korean-appointment.md')).replaceAll('시험 reader','시험 appointment-reader'),'director');
const vite = await createViteServer({
  configFile: false, envDir: false, root: resolve(repoRoot, 'apps/worker'),
  plugins: [react()], cacheDir: resolve(repoRoot, 'output/test/vite-cache'),
  server: { middlewareMode: true, host: '127.0.0.1', hmr: false, ws: {port:Number(process.env.ISO_TEST_WS_PORT??24678)} },
});
const server = createServer(async (request, response) => {
  if (!request.url?.startsWith('/api/')) { vite.middlewares(request, response); return; }
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const url = `http://127.0.0.1:${port}${request.url}`;
    const headers = new Headers();
    for (const [key,value] of Object.entries(request.headers)) if (value) headers.set(key,Array.isArray(value) ? value.join(',') : value);
    const result = await app.fetch(new Request(url, { method: request.method, headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) }), environment.bindings);
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(Buffer.from(await result.arrayBuffer()));
  } catch (error) { console.error(error); response.writeHead(500); response.end('test harness failure'); }
});
server.listen(port,'127.0.0.1',() => console.log(`Isolated browser harness http://127.0.0.1:${port}`));
let stopping = false;
async function cleanup() { if (stopping) return; stopping = true; server.close(); await vite.close(); await environment.cleanup(); await stopEngine(); process.exit(0); }
process.on('SIGTERM', () => void cleanup());
process.on('SIGINT', () => void cleanup());
