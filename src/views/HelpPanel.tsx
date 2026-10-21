import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../ui/context';
import { ActionButton } from '../ui/components';
import { Checklist } from '../ui/Checklist';
import { flowState } from '../ui/flowState';
import { termsFor } from '../ui/glossary';
import { STATUS_PHRASE } from '../ui/labels';
import { loadRun, useCopilot } from '../ui/useCopilot';
import { AccessCodeForm } from '../ui/AccessCode';
import { AiLines } from './AiSummary';
import { plainSummary } from '../domain/plain';
import { authorize, type Command } from '../domain/workflow';
import type { CaseDef } from '../domain/cases';

// "I need help" panel: a drawer over the guided flow (a bottom sheet on
// phones). Every action dispatches an existing command through the same
// authorize() path as the rest of the app; whether a card is offered is also
// decided by authorize(), with a probe command, so no rule is duplicated here.

type Done = (message: string) => void;

export function HelpPanel({ def, open, step, onClose }: { def: CaseDef; open: boolean; step: number; onClose: () => void }) {
  const { ix, state, actor } = useApp();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (open) root.removeAttribute('inert'); else root.setAttribute('inert', '');
    if (open) {
      setDone(null);
      requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus());
    }
  }, [open]);

  // Esc closes; Tab stays inside the panel while it is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      const panel = panelRef.current;
      if (e.key !== 'Tab' || !panel) return;
      const f = [...panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [tabindex="-1"][data-autofocus]')]
        .filter((el) => el.getClientRects().length > 0);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (!panel.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (actor.role === 'client') return null;
  const terms = termsFor(def);

  return (
    <div ref={rootRef} className={`help-root${open ? ' open' : ''}`} aria-hidden={!open}>
      <div className="help-backdrop" onClick={onClose} />
      <aside ref={panelRef} className="help-drawer" role="dialog" aria-modal="true" aria-labelledby="help-title">
        <header className="help-h">
          <h2 id="help-title" tabIndex={-1} data-autofocus>How can we help with this case?</h2>
          <button className="btn ghost small" onClick={onClose} aria-label="Close help">✕</button>
        </header>
        <div className="help-body">
          <p className="help-recap">{plainSummary(def)}</p>
          {done ? (
            <div className="help-done" role="status">
              <p><strong>{done}</strong></p>
              <div className="row-wrap">
                <button className="btn primary" onClick={onClose}>Back to the steps</button>
                <button className="link" onClick={() => setDone(null)}>Do something else</button>
              </div>
              <Checklist items={flowState(ix, def, state).items} compact />
            </div>
          ) : (
            <>
              <AskClientCard def={def} onDone={setDone} />
              <AskColleagueCard def={def} onDone={setDone} />
              <AiCard def={def} step={step} />
              <BlockedCard def={def} onDone={setDone} />
              <a className="help-card help-deep" href={`#/case/${def.id}?view=full&from=${step}`}>
                <span className="help-card-t">Deep dive: see the whole case</span>
                <span className="small muted">Opens the full details: every record, the history and all controls. You can come back to this step.</span>
              </a>
            </>
          )}
          {terms.length > 0 && (
            <details className="help-glossary" onToggle={(e) => {
              // Bring the terms into view once the disclosure has finished expanding (200ms, or at once with reduced motion).
              const d = e.currentTarget;
              if (!d.open) return;
              const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
              setTimeout(() => d.scrollIntoView({ block: 'start', behavior: still ? 'auto' : 'smooth' }), still ? 0 : 220);
            }}>
              <summary>What do these words mean?</summary>
              <dl>{terms.map((t) => <div key={t.id}><dt>{t.term}</dt><dd>{t.definition}</dd></div>)}</dl>
            </details>
          )}
        </div>
      </aside>
    </div>
  );
}

function Unavailable({ title, reason }: { title: string; reason: string }) {
  return <div className="help-card unavailable"><span className="help-card-t">{title}</span><span className="small muted">Not available right now: {reason}</span></div>;
}

/** Run a command through the store; returns the refusal message, or null on success. */
function useDispatch() {
  const { wp, actor } = useApp();
  return (cmd: Command): string | null => { const r = wp.dispatch(actor, cmd); return r.ok ? null : r.error; };
}

function AskClientCard({ def, onDone }: { def: CaseDef; onDone: Done }) {
  const { ix, defsById, state, actor, wp, mask } = useApp();
  const dispatch = useDispatch();
  const cs = state.cases[def.id];
  const draft = useMemo(() => {
    const last = cs.copilot.at(-1);
    const rep = last ? loadRun(last.runId)?.report : null;
    if (rep?.client_question_draft) return { text: mask(rep.client_question_draft), from: 'Prefilled from the AI draft. Check it before sending.', source: `copilot:${last!.runId}` };
    const q = def.openQuestions.find((x) => !cs.questions.some((y) => y.text === x));
    if (q) return { text: q, from: 'Prefilled from this case’s open question.', source: undefined };
    return { text: '', from: '', source: undefined };
  }, [def.id]);
  const [text, setText] = useState(draft.text);
  const [err, setErr] = useState<string | null>(null);
  const cmd = (t: string): Command => ({ type: 'case.question', payload: { caseId: def.id, qid: `q-${Date.now().toString(36)}`, to: 'client', toWho: 'cu-01', text: t, expected: 'Answer and supporting document if available', ...(draft.source && t === draft.text ? { source: draft.source } : {}) } });
  const refused = authorize(ix, defsById, state, actor, cmd('x'.repeat(10)));
  if (refused) return <Unavailable title="Ask the client" reason={refused} />;
  return (
    <div className="help-card">
      <span className="help-card-t">Ask the client</span>
      <span className="small muted">Sends this question to the client portal. The client’s answer is saved to the case as they write it.</span>
      <label className="small" htmlFor="help-client-q">Question</label>
      <textarea id="help-client-q" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write the question in plain words, and say which document would answer it." />
      {draft.from && <span className="small muted">{draft.from}</span>}
      {err && <span className="small neg" role="alert">{err}</span>}
      <ActionButton className="btn primary" onRun={() => {
        const e = dispatch(cmd(text));
        if (e) setErr(e); else onDone(`Sent. The case is now ${STATUS_PHRASE[wp.state.cases[def.id].status]}.`);
      }}>Send to the client</ActionButton>
    </div>
  );
}

function AskColleagueCard({ def, onDone }: { def: CaseDef; onDone: Done }) {
  const { ix, defsById, state, actor, actors, wp } = useApp();
  const dispatch = useDispatch();
  const staff = actors.filter((a) => ['preparer', 'reviewer', 'partner'].includes(a.role) && a.id !== actor.id);
  const [to, setTo] = useState(staff[0]?.id ?? '');
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const cmd = (t: string): Command => ({ type: 'case.question', payload: { caseId: def.id, qid: `q-${Date.now().toString(36)}`, to: 'staff', toWho: to, text: t, expected: '' } });
  const refused = !staff.length ? 'there is no other staff member to ask.' : authorize(ix, defsById, state, actor, cmd('x'.repeat(10)));
  if (refused) return <Unavailable title="Ask a colleague" reason={refused} />;
  const name = staff.find((a) => a.id === to)?.name ?? 'your colleague';
  return (
    <div className="help-card">
      <span className="help-card-t">Ask a colleague</span>
      <span className="small muted">Adds a question for them on this case. It does not change the case status.</span>
      <label className="small" htmlFor="help-colleague">Who</label>
      <select id="help-colleague" value={to} onChange={(e) => setTo(e.target.value)}>
        {staff.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.role})</option>)}
      </select>
      <label className="small" htmlFor="help-colleague-q">Your question</label>
      <textarea id="help-colleague-q" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="What do you need from them?" />
      {err && <span className="small neg" role="alert">{err}</span>}
      <ActionButton className="btn" onRun={() => {
        const e = dispatch(cmd(text));
        if (e) setErr(e); else onDone(`Sent to ${name}. It is in this case’s questions; the case is still ${STATUS_PHRASE[wp.state.cases[def.id].status]}.`);
      }}>Send to {name.split(' ')[0]}</ActionButton>
    </div>
  );
}

function AiCard({ def, step }: { def: CaseDef; step: number }) {
  const { status, statusErr, enabled, isStaff, code, busy, elapsed, shown, err, investigate } = useCopilot(def);
  const reason = statusErr ?? (!status ? 'checking whether the AI service is available…' : !enabled ? (status.reason ?? 'the AI service is not configured.') : !isStaff ? 'staff roles only.' : null);
  return (
    <div className={`help-card${reason ? ' unavailable' : ''}`}>
      <span className="help-card-t">Get an AI second look <span className="tag tag-ai">AI · suggestion only</span></span>
      <span className="small muted">The AI reads this case’s records and drafts an analysis; every id and amount it cites is checked. It cannot change the case. About 20–90 seconds.</span>
      {reason && <span className="small muted">Not available right now: {reason}</span>}
      {!reason && !code && <AccessCodeForm compact />}
      {busy && (
        <div className="skeleton-block" aria-busy="true" aria-label="AI analysis loading">
          <div className="skeleton" /><div className="skeleton" /><div className="skeleton short" />
          <span className="small muted">Reading the records… {elapsed}s</span>
        </div>
      )}
      {!busy && shown && <AiLines def={def} shown={shown} fullHref={`#/case/${def.id}?view=full&from=${step}`} />}
      {err && <span className="small neg" role="alert">{err}</span>}
      <ActionButton className="btn" disabled={!!reason || !code || busy} onRun={investigate}>{busy ? 'Working…' : shown ? 'Run it again' : 'Get an AI second look'}</ActionButton>
    </div>
  );
}

function BlockedCard({ def, onDone }: { def: CaseDef; onDone: Done }) {
  const { ix, defsById, state, actor } = useApp();
  const dispatch = useDispatch();
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const cmd = (note: string): Command => ({ type: 'case.status', payload: { caseId: def.id, to: 'blocked', note } });
  const refused = authorize(ix, defsById, state, actor, cmd('probe'));
  if (refused) return <Unavailable title="I’m stuck: mark as blocked" reason={refused} />;
  return (
    <div className="help-card">
      <span className="help-card-t">I’m stuck: mark as blocked</span>
      <span className="small muted">Sets the case to Blocked with your reason, so the team can see what it is waiting for.</span>
      <label className="small" htmlFor="help-blocked">What is it blocked on? (required)</label>
      <input id="help-blocked" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Waiting for the corrected 1099 from the broker" />
      {err && <span className="small neg" role="alert">{err}</span>}
      <ActionButton className="btn" onRun={() => {
        const e = dispatch(cmd(reason));
        if (e) setErr(e); else onDone(`Marked as blocked: “${reason.trim()}”.`);
      }}>Mark as blocked</ActionButton>
    </div>
  );
}
