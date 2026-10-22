import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const output = fileURLToPath(new URL('../../output/test/',import.meta.url));
process.env.PLAYWRIGHT_BROWSERS_PATH = `${output}/browsers`;
export default defineConfig({
  testDir: './e2e', testMatch: '**/*.spec.ts', outputDir: `${output}/playwright-results`,
  fullyParallel: false, workers: 1, timeout: 60_000,
  reporter: [['list'],['html',{outputFolder:`${output}/playwright-report`,open:'never'}]],
  use: { baseURL:'http://127.0.0.1:4173', trace:'retain-on-failure', screenshot:'only-on-failure', browserName:'chromium' },
  webServer: { command:'pnpm exec tsx e2e/server.ts', url:'http://127.0.0.1:4173', reuseExistingServer:!process.env.CI, timeout:60_000, env:{ ISO_TEST_ENGINE_URL:'http://127.0.0.1:18766' } },
});
