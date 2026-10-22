import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { createCopilotApi } from './api';

// Production server: serves the built SPA from dist/ and the copilot API.
// Usage: npm run build && npm start   (reads new_assmt/.env if present)

const root = resolve(process.cwd());
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
const dist = join(root, 'dist');
const port = Number(process.env.PORT ?? 8787);
// All interfaces by default so a host such as Render can reach it; set HOST=127.0.0.1 to keep it local.
const host = process.env.HOST ?? '0.0.0.0';
const api = createCopilotApi({ packetPath: join(root, 'public/data/okafor_lindqvist_2025_packet.json') });

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

createServer((req, res) => {
  if ((req.url ?? '').startsWith('/api/')) return void api(req, res);
  const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let file = normalize(join(dist, path === '/' ? 'index.html' : path));
  if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) file = join(dist, 'index.html');
  res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
  res.end(readFileSync(file));
}).listen(port, host, () => console.log(`Workpaper listening on ${host}:${port} (copilot ${process.env.ANTHROPIC_API_KEY ? 'configured' : 'not configured'})`));
