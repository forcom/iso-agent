import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { createServer as createViteServer } from 'vite';
import react from '@vitejs/plugin-react';
import app from '../../worker/src/index';
import { createTestEnvironment, repoRoot } from '../support/environment';
import { startTestEngine } from '../support/engine';
import {installAppointment} from '../support/appointment';
import {loadFixture} from '../support/fixtures';
import {seedResearchResult} from './research-fixture';

// The browser harness only uses synthetic data and isolated local D1/R2 state.
const stopEngine = await startTestEngine();
const environment = await createTestEnvironment();
await environment.bindings.DB.prepare('INSERT INTO persons VALUES(?,?)').bind('appointment-reader',JSON.stringify({id:'appointment-reader',name:'시험 appointment-reader',active:true,isAdmin:false})).run();
await installAppointment(environment,(await loadFixture('korean-appointment.md')).replaceAll('시험 reader','시험 appointment-reader'));
const vite = await createViteServer({
  configFile: false, envDir: false, root: resolve(repoRoot, 'apps/worker'),
  plugins: [react()], cacheDir: resolve(repoRoot, 'output/test/vite-cache'),
  server: { middlewareMode: true, host: '127.0.0.1', hmr: false },
});
const server = createServer(async (request, response) => {
  if (!request.url?.startsWith('/api/')) { vite.middlewares(request, response); return; }
  try {
    if(request.method==='POST'&&['/api/test/research/fixture','/api/test/research/limited-fixture'].includes(request.url??'')){
      response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify(await seedResearchResult(environment,request.url?.endsWith('/limited-fixture'))));return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const url = `http://127.0.0.1:4173${request.url}`;
    const headers = new Headers();
    for (const [key,value] of Object.entries(request.headers)) if (value) headers.set(key,Array.isArray(value) ? value.join(',') : value);
    const result = await app.fetch(new Request(url, { method: request.method, headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) }), environment.bindings);
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(Buffer.from(await result.arrayBuffer()));
  } catch (error) { console.error(error); response.writeHead(500); response.end('test harness failure'); }
});
server.listen(4173,'127.0.0.1',() => console.log('Isolated browser harness http://127.0.0.1:4173'));
let stopping = false;
async function cleanup() { if (stopping) return; stopping = true; server.close(); await vite.close(); await environment.cleanup(); await stopEngine(); process.exit(0); }
process.on('SIGTERM', () => void cleanup());
process.on('SIGINT', () => void cleanup());
