import { useApp } from '../ui/context';
import { useCopilot, type Shown } from '../ui/useCopilot';
import { AccessCodeForm } from '../ui/AccessCode';
import { summarizeReport } from '../copilot/summary';
import { FreshnessTag, RunView } from './CopilotPanel';
import type { CaseDef } from '../domain/cases';

/** Three plain lines from a verified report; record ids and rule codes stay behind "Show full analysis". */
export function AiLines({ def, shown, fullHref }: { def: CaseDef; shown: Shown; fullHref?: string }) {
  const { mask, state } = useApp();
  const lines = summarizeReport(shown.run.report!).map(mask);
  const masked = JSON.parse(mask(JSON.stringify(shown.run)));
  return (
    <div className="ai-summary">
      <div className="ai-summary-h"><span className="tag tag-ai">AI suggestion · not a verified finding</span> <FreshnessTag shown={shown} /></div>
      <ul className="ai-lines">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
      {fullHref ? <a className="small" href={fullHref}>Show full analysis</a> : (
        <details className="small ai-full">
          <summary>Show full analysis</summary>
          <RunView def={def} runResult={masked} record={state.cases[def.id].copilot.find((r) => r.runId === shown.run.runId)} />
        </details>
      )}
    </div>
  );
}

/** Step 1: the AI's three-line summary of this case, when the copilot is on and the access code is present. */
export function AiSummary({ def }: { def: CaseDef }) {
  const c = useCopilot(def);
  if (!c.isStaff) return null;
  if (!c.enabled) return c.status ? <p className="small muted ai-off">AI summary is off: {c.status.reason}</p> : null;
  if (!c.code) return <div className="ai-summary"><AccessCodeForm compact error={c.err} /></div>;
  return (
    <div className="ai-block">
      {c.busy && (
        <div className="ai-summary">
          <div className="ai-summary-h"><span className="tag tag-ai">AI suggestion</span> <span className="small muted">Reading the records… {c.elapsed}s</span></div>
          <div className="skeleton-block" aria-busy="true" aria-label="AI summary loading"><div className="skeleton" /><div className="skeleton" /><div className="skeleton short" /></div>
        </div>
      )}
      {!c.busy && c.shown && <AiLines def={def} shown={c.shown} />}
      {c.err && <p className="small neg" role="alert">{c.err}</p>}
      {!c.busy && <button className="btn small ghost" onClick={c.investigate}>{c.shown ? 'Run again' : 'Get an AI summary'}</button>}
    </div>
  );
}
