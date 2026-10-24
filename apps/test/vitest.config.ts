import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  cacheDir: '../../output/test/cache/vitest',
  test: { root: fileURLToPath(new URL('.', import.meta.url)), globalSetup: './support/global-setup.ts', include: ['**/*.test.ts'], exclude: ['e2e/**'], testTimeout: 30000, hookTimeout: 30000, fileParallelism: false,server:{deps:{inline:['@cloudflare/workers-oauth-provider']}} }
});
