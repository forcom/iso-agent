import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const output = fileURLToPath(new URL('../../output/test/',import.meta.url));
process.env.PLAYWRIGHT_BROWSERS_PATH = `${output}/browsers`;
const baseURL=`http://127.0.0.1:${process.env.ISO_TEST_WEB_PORT??4173}`;
export default defineConfig({
  testDir: './e2e', testMatch: '**/*.spec.ts', outputDir: `${output}/playwright-results`,
  fullyParallel: false, workers: 1, timeout: 60_000,
  reporter: [['list'],['html',{outputFolder:`${output}/playwright-report`,open:'never'}]],
  use: { baseURL, trace:'retain-on-failure', screenshot:'only-on-failure', browserName:'chromium' },
  webServer: { command:'pnpm exec tsx e2e/server.ts', url:baseURL, reuseExistingServer:!process.env.CI, timeout:60_000, env:{ ISO_TEST_ENGINE_URL:process.env.ISO_TEST_ENGINE_URL??'http://127.0.0.1:18766' } },
});
