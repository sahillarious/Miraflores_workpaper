// Secrets check (run after `npm run build`): nothing secret in dist/, no source
// maps, no secret read through import.meta.env, and the real values from .env
// (if present) in no tracked file. Prints names only, never values.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const problems = [];
const walk = (dir) => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });

if (!existsSync('dist')) { console.error('dist/ not found: run npm run build first'); process.exit(2); }
const distFiles = walk('dist');
for (const f of distFiles) {
  if (f.endsWith('.map')) problems.push(`source map in build: ${f}`);
  if (f.endsWith('.json')) continue; // the packet (invented data, served on purpose)
  const s = readFileSync(f, 'utf8');
  for (const [name, re] of [['sk-ant key pattern', /sk-ant-[A-Za-z0-9_-]{8,}/], ['Anthropic SDK', /@anthropic-ai|anthropic-version|x-api-key/], ['ANTHROPIC_API_KEY name', /ANTHROPIC_API_KEY/], ['COPILOT_ACCESS_CODE name', /COPILOT_ACCESS_CODE/]]) {
    if (re.test(s)) problems.push(`${name} in ${f}`);
  }
}

for (const f of walk('src')) {
  const s = readFileSync(f, 'utf8');
  if (/import\.meta\.env\.(?!MODE|DEV|PROD|BASE_URL|SSR)/.test(s)) problems.push(`browser code reads a custom env variable: ${f}`);
}

if (existsSync('.env')) {
  const vars = Object.fromEntries(readFileSync('.env', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
  const tracked = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean).filter((f) => existsSync(f));
  for (const name of ['ANTHROPIC_API_KEY', 'COPILOT_ACCESS_CODE']) {
    const v = vars[name];
    if (!v || v.length < 8) continue;
    for (const f of [...distFiles, ...tracked]) if (readFileSync(f, 'utf8').includes(v)) problems.push(`the value of ${name} appears in ${f}`);
  }
  if (tracked.includes('.env')) problems.push('.env is tracked by git');
}

console.log(problems.length ? `SECRETS CHECK FAILED:\n- ${problems.join('\n- ')}` : `Secrets check passed (${distFiles.length} build files, no source maps).`);
process.exit(problems.length ? 1 : 0);
