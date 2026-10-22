import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app';

// The production static server: the app is served, unknown paths fall back to the app,
// and bad input is answered with an error instead of taking the process down.
let server: Server, port: number, tmp: string;
const apiCalls: string[] = [];

/** A raw request line, so the client does not tidy the path first. */
const raw = (path: string) => new Promise<{ status: number; body: string; type: string }>((resolve, reject) => {
  const r = request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
    let body = ''; res.on('data', (c) => (body += c)); res.on('end', () => resolve({ status: res.statusCode ?? 0, body, type: String(res.headers['content-type'] ?? '') }));
  });
  r.on('error', reject); r.end();
});

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'mf-static-'));
  mkdirSync(join(tmp, 'dist')); mkdirSync(join(tmp, 'dist-old'));
  writeFileSync(join(tmp, 'dist', 'index.html'), '<html>APP</html>');
  writeFileSync(join(tmp, 'dist', 'robots.txt'), 'User-agent: *\nDisallow: /\n');
  writeFileSync(join(tmp, 'dist-old', 'secret.txt'), 'SECRET');
  writeFileSync(join(tmp, 'secret.txt'), 'SECRET');
  server = createServer(createApp({ dist: join(tmp, 'dist'), api: (req, res) => { apiCalls.push(req.url ?? ''); res.end('api'); } }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => { server.close(); rmSync(tmp, { recursive: true, force: true }); });

describe('static server', () => {
  it('serves the app at / and for unknown paths (hash routing needs nothing else)', async () => {
    expect(await raw('/')).toMatchObject({ status: 200, body: '<html>APP</html>' });
    expect((await raw('/no/such/file')).body).toBe('<html>APP</html>');
  });
  it('serves robots.txt as text', async () => {
    const r = await raw('/robots.txt');
    expect(r.status).toBe(200); expect(r.type).toContain('text/plain'); expect(r.body).toContain('Disallow: /');
  });
  it('does not throw on a malformed URL and keeps serving afterwards', async () => {
    for (const bad of ['/%', '/%E0%A4%A', '/%zz']) expect((await raw(bad)).status).toBe(400);
    expect((await raw('/')).status).toBe(200);
  });
  it('stays inside dist, including a sibling folder whose name starts with "dist"', async () => {
    for (const p of ['/../secret.txt', '/../dist-old/secret.txt', '/%2e%2e/%2e%2e/secret.txt', '/..%2fdist-old%2fsecret.txt']) {
      const r = await raw(p);
      expect(r.body, p).not.toContain('SECRET');
    }
  });
  it('hands /api/ requests to the API', async () => {
    expect((await raw('/api/copilot/status')).body).toBe('api');
    expect(apiCalls).toContain('/api/copilot/status');
  });
});
