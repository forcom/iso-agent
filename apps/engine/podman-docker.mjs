#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const digestDir = process.env.PODMAN_DIGEST_DIR ?? resolve(fileURLToPath(new URL('../../output/runtime/podman', import.meta.url)));
const digestFile = image => resolve(digestDir, `${createHash('sha256').update(image).digest('hex')}.digest`);
function run(command, capture = false) {
  const result = spawnSync('podman', command, {
    stdio: capture ? ['inherit', 'pipe', 'inherit'] : 'inherit', encoding: 'utf8',
  });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result.stdout;
}

const formatIndex = args.indexOf('--format');
const images = args.slice(2).filter((_, index) => index + 2 !== formatIndex && index + 2 !== formatIndex + 1);
if (args[0] === 'image' && args[1] === 'inspect' && formatIndex >= 2
    && args[formatIndex + 1]?.replace(/\s/g, '') === '{{json.RepoDigests}}' && images.length === 1) {
  // The registry's manifest digest recorded at push time is authoritative. Local RepoDigests and
  // .Digest can keep the build-time manifest, which the registry may not hold.
  const pushed = digestFile(images[0]);
  const digest = existsSync(pushed) ? readFileSync(pushed, 'utf8').trim() : run(['image', 'inspect', images[0], '--format', '{{.Digest}}'], true).trim();
  if (!/^sha256:[a-f\d]{64}$/i.test(digest)) {
    console.error('Podman did not return a valid current image digest.');
    process.exit(1);
  }
  const repository = images[0].split('@')[0].replace(/:[^/:]+$/, '');
  console.log(JSON.stringify([`${repository}@${digest}`]));
} else if (args[0] === 'push') {
  mkdirSync(digestDir, { recursive: true });
  run(['push', '--digestfile', digestFile(args.at(-1)), ...args.slice(1)]);
} else {
  // Podman loads built images by default and does not implement Docker attestations.
  run(args[0] === 'build' ? args.filter(arg => arg !== '--load' && arg !== '--provenance=false') : args);
}
