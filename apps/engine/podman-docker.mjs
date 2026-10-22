#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

// Podman loads built images by default and does not implement Docker attestations.
const args = process.argv.slice(2);
const result = spawnSync('podman', args[0] === 'build'
  ? args.filter(arg => arg !== '--load' && arg !== '--provenance=false') : args,
  { stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
