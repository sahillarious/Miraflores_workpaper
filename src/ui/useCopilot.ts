import { useEffect, useState, useSyncExternalStore } from 'react';
import { useApp } from './context';
import type { CaseDef } from '../domain/cases';
import type { CopilotStatus, InvestigateResponse, InvestigationRun } from '../copilot/types';
import { cachedFor, isVerified, lookup, remember, type Freshness, type KV } from '../copilot/clientCache';

// The copilot's client side, shared by every component that shows it (step 1
// summary, help panel, full details): one state per case, one request at a
// time per case, reports reused from the browser cache. Every run is still
// recorded as a copilot.run event (a suggestion only; it changes nothing).

export interface Shown { run: InvestigationRun; freshness: Freshness; madeAt: string }
interface Entry { busy: boolean; startedAt: number; shown: Shown | null; latest: InvestigationRun | null; err: string | null }

const CODE_KEY = 'mf-copilot-code';
const runKey = (runId: string) => `mf-copilot-run:${runId}`;
const kv: KV = {
  getItem: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  setItem: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage full or blocked */ } },
};

let status: CopilotStatus | null = null;
let statusErr: string | null = null;
let statusLoading: Promise<void> | null = null;
const entries = new Map<string, Entry>();
/** Cache keys auto-investigated in this browser session: a failure is not retried automatically. */
const attempted = new Set<string>();
let version = 0;
const listeners = new Set<() => void>();
const emit = () => { version++; listeners.forEach((f) => f()); };
const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
const entry = (caseId: string) => { let e = entries.get(caseId); if (!e) { e = { busy: false, startedAt: 0, shown: null, latest: null, err: null }; entries.set(caseId, e); } return e; };

/** The access code lives in sessionStorage only (gone when the browser session ends). */
export const getCode = () => { try { return sessionStorage.getItem(CODE_KEY); } catch { return null; } };
export const setCode = (code: string) => { try { sessionStorage.setItem(CODE_KEY, code.trim()); } catch { /* blocked: code not kept */ } emit(); };
export const clearCode = () => { try { sessionStorage.removeItem(CODE_KEY); } catch { /* ignore */ } emit(); };

/** A run with a report, kept by run id so the run recorded in the log can be shown again. Failed runs are not kept. */
export function loadRun(runId: string): InvestigationRun | null {
  try { const s = localStorage.getItem(runKey(runId)); return s ? JSON.parse(s) : null; } catch { return null; }
}
const saveRun = (run: InvestigationRun) => { if (run.report) kv.setItem(runKey(run.runId), JSON.stringify(run)); };

function ensureStatus() {
  statusLoading ??= fetch('./api/copilot/status')
    .then(async (r) => { if (!r.ok) throw new Error(String(r.status)); status = await r.json(); })
    .catch(() => { statusErr = 'Copilot server not reachable. A static host has no copilot server; the rest of the workpaper works without it.'; })
    .finally(emit);
}

async function investigate(def: CaseDef, record: (run: InvestigationRun) => void, replace: boolean) {
  const e = entry(def.id);
  if (e.busy) return; // one request per case at a time
  const code = getCode();
  if (!code) { e.err = 'Enter the access code to use the AI copilot.'; emit(); return; }
  e.busy = true; e.startedAt = Date.now(); e.err = null; emit();
  try {
    const r = await fetch('./api/copilot/investigate', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-access-code': code }, body: JSON.stringify({ caseId: def.id }) });
    const body = await r.json().catch(() => ({}));
    if (r.status === 401) { clearCode(); throw new Error('That access code was not accepted. Enter it again to use the AI copilot.'); }
    if (!r.ok) throw new Error(body.error ?? `The AI copilot is unavailable right now (HTTP ${r.status}).`);
    const run = body as InvestigateResponse;
    record(run);
    saveRun(run);
    e.latest = run;
    if (isVerified(run)) {
      const stored = remember(kv, run, run.cacheKey, { replace });
      const c = stored ? null : cachedFor(kv, run.cacheKey);
      e.shown = c ? { run: c.run, freshness: 'cached', madeAt: c.madeAt } : { run, freshness: 'fresh', madeAt: run.startedAt };
    } else {
      e.err = run.outcome === 'unverified'
        ? 'The AI report did not pass verification, so no summary is shown. Open the full analysis to review or reject it.'
        : run.error?.message ?? 'The investigation did not finish.';
    }
  } catch (err) {
    e.err = (err as Error).message;
  } finally {
    e.busy = false; emit();
  }
}

export function useCopilot(def: CaseDef) {
  const { state, run: dispatch, actor } = useApp();
  useSyncExternalStore(subscribe, () => version);
  useEffect(() => { ensureStatus(); }, []);
  const cs = state.cases[def.id];
  const e = entry(def.id);
  const key = status?.cacheKeys?.[def.id];
  const enabled = !!status?.configured;
  const isStaff = ['preparer', 'reviewer', 'partner'].includes(actor.role);
  const code = getCode();

  // Before any run in this session: the cached report for the current key, or one made under an older key.
  let shown = e.shown;
  if (!shown && enabled) { const hit = lookup(kv, def.id, key); if (hit) shown = { run: hit.report.run, freshness: hit.freshness, madeAt: hit.report.madeAt }; }
  const lastRecorded = cs.copilot.at(-1);
  const latest = e.latest ?? (lastRecorded ? loadRun(lastRecorded.runId) : null) ?? shown?.run ?? null;

  const [, tick] = useState(0);
  useEffect(() => { if (!e.busy) return; const i = setInterval(() => tick((n) => n + 1), 500); return () => clearInterval(i); }, [e.busy]);

  const record = (run: InvestigationRun) => {
    const rep = run.report;
    dispatch({
      type: 'copilot.run',
      payload: {
        caseId: def.id, runId: run.runId, outcome: run.outcome, model: run.model,
        validationPassed: !!run.validation?.passed, issues: run.validation?.issues.length ?? 0,
        status: rep?.status ?? null, summary: rep?.summary ?? run.error?.message ?? null,
        citedIds: run.validation?.citedIds ?? [], nextStep: rep?.recommended_next_steps[0]?.action ?? null,
        usage: { inputTokens: run.usage.inputTokens, outputTokens: run.usage.outputTokens, latencyMs: run.latencyMs, toolCalls: run.toolCalls },
      },
    });
  };

  return {
    status, statusErr, enabled, isStaff, code, cacheKey: key,
    busy: e.busy, elapsed: e.busy ? Math.round((Date.now() - e.startedAt) / 1000) : 0,
    shown, latest, err: e.err,
    /** Run (or run again, replacing the cached report for this key). */
    investigate: () => investigate(def, record, !!shown),
    /** Auto-investigate on opening a case: staff only, copilot on, code present, nothing cached for this key, once per session. */
    autoInvestigate: () => {
      if (!isStaff || !enabled || !code || !key || e.busy || attempted.has(key)) return;
      if (shown && shown.freshness !== 'changed') return;
      attempted.add(key);
      void investigate(def, record, false);
    },
  };
}
