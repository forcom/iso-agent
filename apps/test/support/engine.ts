import { spawn, type ChildProcess } from 'node:child_process';
import { access, mkdir, readFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { repoRoot } from './environment';

export async function startTestEngine() {
  const url = process.env.ISO_TEST_ENGINE_URL ?? 'http://127.0.0.1:18765';
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) throw new Error('Test engine must use loopback HTTP');
  const rulesHash = createHash('sha256').update(await readFile(resolve(repoRoot, 'apps/packages/ontology/rules.dl'))).digest('hex');
  const healthy = async () => {
    try {
      const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) });
      const body = await response.json() as { engine?: { name: string; rulesHash: string } };
      return response.ok && body.engine?.name === 'PyreWire' && body.engine.rulesHash === rulesHash;
    } catch { return false; }
  };
  if (await healthy()) return async () => {};
  let python = '';
  for (const candidate of ['output/runtime/engine-venv/bin/python', 'output/test/engine/venv/bin/python']) {
    try { await access(resolve(repoRoot, candidate)); python = resolve(repoRoot, candidate); break; } catch { /* Try the isolated test environment next. */ }
  }
  if (!python) throw new Error('Prepare the isolated Python engine venv before running API tests');
  const dir = resolve(repoRoot, 'output/test/engine'); await mkdir(dir, { recursive: true });
  const log = createWriteStream(resolve(dir, `server-${process.pid}.log`), { flags: 'a' });
  const child: ChildProcess = spawn(python, [resolve(repoRoot, 'apps/engine/server.py')], {
    cwd: repoRoot, env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: '1', HOST: '127.0.0.1', PORT: parsed.port || '80' }, stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout?.pipe(log); child.stderr?.pipe(log);
  const cleanup = async () => {
    if (child.exitCode === null) {
      const done = new Promise<void>(done => child.once('exit', () => done()));
      child.kill('SIGTERM'); await done;
    }
    log.end();
  };
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await healthy()) return cleanup;
    if (child.exitCode !== null) break;
    await new Promise(done => setTimeout(done, 50));
  }
  await cleanup(); throw new Error(`Real PyreWire engine did not start; see ${dir}`);
}
