import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createCopilotApi } from './api';
import { createApp } from './app';

// Production server: serves the built SPA from dist/ and the copilot API.
// Usage: npm run build && npm start   (reads new_assmt/.env if present)

const root = resolve(process.cwd());
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
const dist = join(root, 'dist');
const port = Number(process.env.PORT ?? 8787);
// All interfaces by default so a host such as Render can reach it; set HOST=127.0.0.1 to keep it local.
const host = process.env.HOST ?? '0.0.0.0';
const api = createCopilotApi({ packetPath: join(root, 'public/data/okafor_lindqvist_2025_packet.json') });

createServer(createApp({ dist, api })).listen(port, host, () => console.log(`Workpaper listening on ${host}:${port} (copilot ${process.env.ANTHROPIC_API_KEY ? 'configured' : 'not configured'})`));
