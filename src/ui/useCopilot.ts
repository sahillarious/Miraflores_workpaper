import { useEffect, useState } from 'react';
import { useApp } from './context';
import type { CaseDef } from '../domain/cases';
import type { CopilotStatus, InvestigationRun } from '../copilot/types';

// The copilot's client-side flow, shared by the full-details panel and the
// help panel: read the server status, run an investigation, cache the full
// report in this browser and record a copilot.run event (a suggestion only).

const cacheKey = (runId: string) => `mf-copilot-run:${runId}`;
export function loadRun(runId: string): InvestigationRun | null {
  try { const s = localStorage.getItem(cacheKey(runId)); return s ? JSON.parse(s) : null; } catch { return null; }
}
function saveRun(run: InvestigationRun) {
  try { localStorage.setItem(cacheKey(run.runId), JSON.stringify(run)); } catch { /* storage full or blocked */ }
}

export function useCopilot(def: CaseDef) {
  const { state, run: dispatch } = useApp();
  const cs = state.cases[def.id];
  const [status, setStatus] = useState<CopilotStatus | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [current, setCurrent] = useState<InvestigationRun | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch('./api/copilot/status').then(async (r) => {
      if (!r.ok) throw new Error(`status ${r.status}`);
      setStatus(await r.json());
    }).catch(() => setStatusErr('Copilot server not reachable. Run the app with "npm run dev" or "npm start" (a static host has no copilot server).'));
  }, []);

  // Show the latest run for this case (full report cached in this browser).
  useEffect(() => {
    const last = cs.copilot.at(-1);
    setCurrent(last ? loadRun(last.runId) : null);
    setErr(null);
  }, [def.id, cs.copilot.length]);

  useEffect(() => {
    if (!busy) return;
    const t0 = Date.now();
    const i = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(i);
  }, [busy]);

  const investigate = async () => {
    setBusy(true); setErr(null); setElapsed(0);
    try {
      const r = await fetch('./api/copilot/investigate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ caseId: def.id }) });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
      const runResult = body as InvestigationRun;
      saveRun(runResult);
      setCurrent(runResult);
      const rep = runResult.report;
      dispatch({
        type: 'copilot.run',
        payload: {
          caseId: def.id, runId: runResult.runId, outcome: runResult.outcome, model: runResult.model,
          validationPassed: !!runResult.validation?.passed, issues: runResult.validation?.issues.length ?? 0,
          status: rep?.status ?? null, summary: rep?.summary ?? runResult.error?.message ?? null,
          citedIds: runResult.validation?.citedIds ?? [], nextStep: rep?.recommended_next_steps[0]?.action ?? null,
          usage: { inputTokens: runResult.usage.inputTokens, outputTokens: runResult.usage.outputTokens, latencyMs: runResult.latencyMs, toolCalls: runResult.toolCalls },
        },
      });
      if (runResult.outcome === 'error' || runResult.outcome === 'incomplete') setErr(runResult.error?.message ?? 'The investigation did not finish.');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return { status, statusErr, busy, elapsed, current, err, investigate };
}
