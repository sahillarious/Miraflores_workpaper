import { useEffect, useState } from 'react';
import { useApp } from '../ui/context';
import { Person, Refs, Section, fmtDate } from '../ui/components';
import type { CaseDef } from '../domain/cases';
import type { CopilotRecord } from '../domain/workflow';
import { REPORT_STATUS_LABEL, type CopilotStatus, type InvestigationRun } from '../copilot/types';

// AI investigation copilot for one case. The model's report is a suggestion:
// it is shown with its deterministic validation result, and nothing changes
// the case until a reviewer accepts, edits or rejects it (recorded as an event)
// or sends a drafted question themselves.

const cacheKey = (runId: string) => `mf-copilot-run:${runId}`;
function loadRun(runId: string): InvestigationRun | null {
  try { const s = localStorage.getItem(cacheKey(runId)); return s ? JSON.parse(s) : null; } catch { return null; }
}
function saveRun(run: InvestigationRun) {
  try { localStorage.setItem(cacheKey(run.runId), JSON.stringify(run)); } catch { /* storage full or blocked */ }
}

export function CopilotPanel({ def }: { def: CaseDef }) {
  const { state, run: dispatch, actor } = useApp();
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

  const record = current ? cs.copilot.find((r) => r.runId === current.runId) : undefined;
  const isStaff = ['preparer', 'reviewer', 'partner'].includes(actor.role);

  return (
    <Section title={<>Investigation copilot <span className="tag tag-ai">AI · suggestions only</span></>} right={status?.configured ? <span className="small muted">{status.model} · max {status.maxToolCalls} tool calls</span> : null}>
      {statusErr && <p className="small neg">{statusErr}</p>}
      {status && !status.configured && <p className="small banner warn">LLM not configured: {status.reason} The rest of the workpaper works without it.</p>}
      <p className="small muted">The copilot reads this case's evidence with read-only tools and drafts an analysis. Every cited id and amount is checked against the packet. It cannot change the case, approve anything or contact the client.</p>
      <div className="row-wrap">
        <button className="btn primary" disabled={!status?.configured || busy || !isStaff} onClick={investigate} title={isStaff ? '' : 'Staff roles only'}>
          {busy ? `Investigating… ${elapsed}s` : current ? 'Investigate again' : 'Investigate with copilot'}
        </button>
        {busy && <span className="small muted">Retrieving records and checking citations; this usually takes 20-90 seconds.</span>}
      </div>
      {err && <p className="small neg" role="alert">Copilot: {err}</p>}
      {current && <RunView def={def} runResult={current} record={record} />}
      {cs.copilot.length > 1 && (
        <details className="small"><summary>Earlier runs ({cs.copilot.length - 1})</summary>
          <ul className="plain">{cs.copilot.slice(0, -1).reverse().map((r) => <li key={r.runId}>{fmtDate(r.at)} · {r.outcome} · {r.status ?? '—'} · {r.review ? `${r.review.decision} by ` : 'not reviewed'}{r.review && <Person id={r.review.by} />}</li>)}</ul>
        </details>
      )}
    </Section>
  );
}

function RunView({ def, runResult, record }: { def: CaseDef; runResult: InvestigationRun; record?: CopilotRecord }) {
  const { run: dispatch } = useApp();
  const rep = runResult.report;
  const v = runResult.validation;
  const [mode, setMode] = useState<'none' | 'edit' | 'reject'>('none');
  const [edited, setEdited] = useState(rep?.recommended_next_steps[0]?.action ?? '');
  const [note, setNote] = useState('');
  const [question, setQuestion] = useState(rep?.client_question_draft ?? '');
  useEffect(() => { setQuestion(rep?.client_question_draft ?? ''); setEdited(rep?.recommended_next_steps[0]?.action ?? ''); setMode('none'); }, [runResult.runId]);

  const review = (decision: 'accepted' | 'edited' | 'rejected') => {
    if (dispatch({ type: 'copilot.review', payload: { caseId: def.id, runId: runResult.runId, decision, note: decision === 'accepted' ? 'Accepted as a working next step' : note, editedText: decision === 'edited' ? edited : undefined } }, `Suggestion ${decision}`)) setMode('none');
  };
  const sendQuestion = () => {
    dispatch({ type: 'case.question', payload: { caseId: def.id, qid: `q-${Date.now().toString(36)}`, to: 'client', toWho: 'cu-01', text: question, expected: 'Answer and supporting document', source: `copilot:${runResult.runId}` } }, 'Question sent to client (reviewed by you)');
  };

  const badge = runResult.outcome === 'validated' ? 'pos' : runResult.outcome === 'unverified' ? 'neg' : 'muted';
  return (
    <div className="copilot-run">
      <div className={`banner ${runResult.outcome === 'validated' ? 'ai' : 'warn'}`}>
        <strong>AI suggestion — not a verified finding.</strong>{' '}
        {runResult.outcome === 'validated' && 'Citations and amounts passed the deterministic checks; the reasoning still needs your judgment.'}
        {runResult.outcome === 'unverified' && 'Some citations or amounts failed verification (listed below). Do not rely on this report.'}
        {(runResult.outcome === 'error' || runResult.outcome === 'incomplete') && `No usable report: ${runResult.error?.message ?? 'investigation did not finish'}.`}
      </div>
      {v && (
        <div className="small row-wrap">
          <span className={badge}>Validation: {v.passed ? 'passed' : `${v.issues.length} issue(s)`}</span>
          <span>citations {v.existingCited}/{v.citedIds.length} exist · {v.retrievedCited}/{v.citedIds.length} retrieved</span>
          <span>amounts {v.quantitiesVerified}/{v.quantitiesChecked} match records · {v.textNumbersFound}/{v.textNumbersChecked} prose numbers found</span>
        </div>
      )}
      {v && v.issues.length > 0 && <ul className="blockers small">{v.issues.map((i, k) => <li key={k}>[{i.kind}{i.where ? ` · ${i.where}` : ''}] {i.message}</li>)}</ul>}

      {rep && (
        <>
          <p><strong>{REPORT_STATUS_LABEL[rep.status]}.</strong> {rep.summary}</p>
          {rep.facts.length > 0 && <><h4>What the records show</h4><ul className="facts">{rep.facts.map((f, i) => <li key={i}>{f.statement} <Refs refs={f.evidence_ids} compact max={5} /></li>)}</ul></>}
          {rep.hypotheses.length > 0 && <><h4>Possible explanations (not established)</h4><ul className="facts">{rep.hypotheses.map((h, i) => <li key={i}><em>{h.confidence} confidence:</em> {h.statement} <span className="muted">Test: {h.how_to_test}</span> <Refs refs={h.evidence_ids} compact max={4} /></li>)}</ul></>}
          {rep.missing_information.length > 0 && <><h4>Missing information</h4><ul className="facts">{rep.missing_information.map((m, i) => <li key={i}><strong>{m.item}</strong> — {m.why_needed} <span className="muted">(source: {m.possible_source})</span></li>)}</ul></>}
          <h4>Suggested next steps</h4>
          <ol className="facts">{rep.recommended_next_steps.map((s, i) => <li key={i}>{s.action} <span className="muted">— {s.rationale}</span></li>)}</ol>
          <p className="small"><strong>To close:</strong> {rep.resolution_criteria}</p>

          {rep.client_question_draft && (
            <div className="q-form">
              <h4>Draft client question (not sent)</h4>
              <textarea rows={3} value={question} onChange={(e) => setQuestion(e.target.value)} aria-label="Draft client question" />
              <button className="btn" disabled={question.trim().length < 10} onClick={sendQuestion}>Send to client as my question</button>
            </div>
          )}

          <div className="review-box">
            {record?.review ? (
              <p className="small"><strong>Reviewed:</strong> {record.review.decision} by <Person id={record.review.by} />, {fmtDate(record.review.at)}{record.review.note ? ` — ${record.review.note}` : ''}{record.review.editedText ? ` · edited next step: "${record.review.editedText}"` : ''}</p>
            ) : record ? (
              <>
                <div className="row-wrap">
                  <span className="small">Your decision on this suggestion:</span>
                  <button className="btn small" disabled={!v?.passed} onClick={() => review('accepted')} title={v?.passed ? '' : 'Unverified reports cannot be accepted'}>Accept</button>
                  <button className="btn small ghost" disabled={!v?.passed} onClick={() => setMode('edit')}>Edit & accept</button>
                  <button className="btn small ghost" onClick={() => setMode('reject')}>Reject</button>
                </div>
                {mode === 'edit' && <div className="inline-form"><textarea rows={2} value={edited} onChange={(e) => setEdited(e.target.value)} aria-label="Edited next step" /><button className="btn small" onClick={() => review('edited')}>Save edited</button></div>}
                {mode === 'reject' && <div className="inline-form"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why is it wrong or unhelpful?" aria-label="Rejection reason" /><button className="btn small" onClick={() => review('rejected')}>Reject</button></div>}
                <p className="small muted">Accepting records the suggestion as a working next step. It does not change status, propose adjustments or resolve the case.</p>
              </>
            ) : <p className="small muted">This run is not in the activity log.</p>}
          </div>
        </>
      )}

      <details className="small">
        <summary>Investigation trace: {runResult.modelTurns} model turn(s), {runResult.toolCalls} tool call(s), {(runResult.latencyMs / 1000).toFixed(1)} s, {(runResult.usage.inputTokens + runResult.usage.cacheReadTokens + runResult.usage.cacheWriteTokens).toLocaleString()} input tokens ({runResult.usage.cacheReadTokens.toLocaleString()} cache reads) / {runResult.usage.outputTokens.toLocaleString()} output{runResult.schemaFailures ? `, ${runResult.schemaFailures} schema rejection(s)` : ''}</summary>
        <ol className="history">
          {runResult.trace.map((t) => (
            <li key={t.index} className={t.ok ? '' : 'neg'}>
              <span className="mono">{t.kind === 'tool' ? t.name : 'model'}</span>{t.input !== undefined && <span className="mono muted"> {JSON.stringify(t.input).slice(0, 140)}</span>} — {t.summary} <span className="muted">({t.ms} ms)</span>
            </li>
          ))}
        </ol>
        <p className="muted">Run {runResult.runId} · {runResult.model} · started {fmtDate(runResult.startedAt)}</p>
      </details>
    </div>
  );
}
