import type { InvestigationRun } from './types';

// Browser cache for copilot reports (demo: localStorage). Rules:
// - only verified reports are cached; failed, unverified, unauthorized or
//   rate-limited results never are;
// - the first verified report per cache key is kept and reused, so the wording
//   a reviewer saw does not change between visits; "Run again" replaces it on
//   purpose (replace: true);
// - a case remembers its latest cached key, so a report made before the code
//   or packet changed can be shown as such instead of silently reused.

export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void }
export interface CachedReport { cacheKey: string; madeAt: string; run: InvestigationRun }
export type Freshness = 'fresh' | 'cached' | 'changed';

const reportKey = (cacheKey: string) => `mf-copilot-cache:${cacheKey}`;
const latestKey = (caseId: string) => `mf-copilot-latest:${caseId}`;

const read = <T>(kv: KV, k: string): T | null => { try { const s = kv.getItem(k); return s ? JSON.parse(s) as T : null; } catch { return null; } };
const write = (kv: KV, k: string, v: unknown) => { try { kv.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked: nothing cached */ } };

export const isVerified = (run: InvestigationRun | null | undefined): boolean =>
  !!run && run.outcome === 'validated' && !!run.validation?.passed && !!run.report;

/** Store a run if it is verified. Returns true when it is now the cached report for its key. */
export function remember(kv: KV, run: InvestigationRun, cacheKey: string, opts: { replace?: boolean } = {}): boolean {
  if (!isVerified(run) || !cacheKey) return false;
  if (!opts.replace && read<CachedReport>(kv, reportKey(cacheKey))) return false; // first verified report wins
  write(kv, reportKey(cacheKey), { cacheKey, madeAt: run.startedAt, run } satisfies CachedReport);
  write(kv, latestKey(run.caseId), { cacheKey, madeAt: run.startedAt });
  return true;
}

export function cachedFor(kv: KV, cacheKey: string): CachedReport | null {
  const c = read<CachedReport>(kv, reportKey(cacheKey));
  return isVerified(c?.run) ? c : null;
}

/** What to show for a case before any new run: the cached report for the current key, or the last one made under an older key. */
export function lookup(kv: KV, caseId: string, currentKey: string | undefined): { report: CachedReport; freshness: Freshness } | null {
  if (currentKey) { const c = cachedFor(kv, currentKey); if (c) return { report: c, freshness: 'cached' }; }
  const latest = read<{ cacheKey: string }>(kv, latestKey(caseId));
  if (latest && latest.cacheKey !== currentKey) { const old = cachedFor(kv, latest.cacheKey); if (old) return { report: old, freshness: 'changed' }; }
  return null;
}
