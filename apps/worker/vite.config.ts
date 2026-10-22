import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig(({command}) => ({
  plugins: [react(), cloudflare({ configPath: command === 'serve' ? 'wrangler.local.toml' : 'wrangler.toml', persistState: { path: '../../output/runtime/erp-state' }, remoteBindings: false })],
  cacheDir: '../../output/runtime/vite-cache',
  build: { outDir: '../../output/build/worker', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
}));
