import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8' };

/**
 * Request handler for the production server: the copilot API, then the built SPA from `dist`.
 * Bad input (a malformed URL, an unreadable file) gets an HTTP error; it never throws out of the handler.
 */
export function createApp(opts: { dist: string; api: (req: IncomingMessage, res: ServerResponse) => unknown }) {
  const dist = normalize(opts.dist);
  return function handle(req: IncomingMessage, res: ServerResponse) {
    try {
      // A demo with invented data: keep it out of search indexes.
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      // Health check for the host: no model, no access code, no files.
      if ((req.url ?? '').split('?')[0] === '/healthz') { res.statusCode = 200; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); return void res.end('ok'); }
      if ((req.url ?? '').startsWith('/api/')) return void opts.api(req, res);
      const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
      let file = normalize(join(dist, path === '/' ? 'index.html' : path));
      // Stay inside dist (the separator stops a sibling folder such as "dist-old" from matching); unknown paths get the app.
      if (!file.startsWith(dist + sep) || !existsSync(file) || statSync(file).isDirectory()) file = join(dist, 'index.html');
      res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
      res.end(readFileSync(file));
    } catch {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Bad request');
    }
  };
}
