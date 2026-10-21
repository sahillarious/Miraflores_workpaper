/// <reference types="vitest" />
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// In dev and preview the copilot API is mounted as middleware, so one command
// runs the app and its server. Env vars are loaded for the server side only;
// nothing without a VITE_ prefix is exposed to the browser bundle.
function copilotApi(mode: string): Plugin {
  const mount = async (use: (fn: any) => void) => {
    const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') };
    const { createCopilotApi } = await import('./server/api');
    use(createCopilotApi({ packetPath: resolve(process.cwd(), 'public/data/okafor_lindqvist_2025_packet.json'), env }));
  };
  return {
    name: 'copilot-api',
    configureServer: (server) => mount((fn) => server.middlewares.use(fn)),
    configurePreviewServer: (server) => mount((fn) => server.middlewares.use(fn)),
  };
}

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), copilotApi(mode)],
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
}));
