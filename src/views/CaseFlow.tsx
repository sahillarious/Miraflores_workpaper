import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useApp } from '../ui/context';
import { go, useRoute } from '../ui/router';
import { DocPage } from '../ui/DocPage';
import { ActionButton, EffectView, Origin, Person, Prio, Ref, Section, StatusPill, fmtDate, money } from '../ui/components';
import { approverFor, existingAdjustment, explainSuggestion, flowState, noEstimateSentence, type FlowState } from '../ui/flowState';
import { Checklist } from '../ui/Checklist';
import { HelpPanel } from './HelpPanel';
import { refKind } from '../domain/refs';
import { plainSummary } from '../domain/plain';
import { closeBlockers, OUTCOME_LABEL, type Command } from '../domain/workflow';
import type { CaseDef, Outcome, Reconciliation } from '../domain/cases';

// Guided four-step view of a case. It is only a presentation layer: every
// action dispatches the same commands as the full view, through the same
// authorize() checks, and every status shown is derived from the event log.

const STEPS = ['What’s wrong', 'Check the proof', 'Fix it', 'Send'] as const;

export function CaseFlow({ id }: { id: string }) {
  const { defsById } = useApp();
  const def = defsById.get(id);
  if (!def) return <div className="page"><h1>Case not found</h1><a href="#/queue">Back to all cases</a></div>;
  return <CaseFlowInner def={def} />;
}

function CaseFlowInner({ def }: { def: CaseDef }) {
  const { ix, defs, state, actor } = useApp();
  const route = useRoute();
  const id = def.id;
  const cs = state.cases[def.id];
  const [helpOpen, setHelpOpen] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);
  const openHelp = (e: { currentTarget: HTMLElement }) => { trigger.current = e.currentTarget; setHelpOpen(true); };
  const closeHelp = () => { setHelpOpen(false); trigger.current?.focus(); };
  const fs = flowState(ix, def, state);
  const step = (Number(route.query.get('step')) || fs.defaultStep) as 1 | 2 | 3 | 4;
  const reviewing = ['reviewer', 'partner'].includes(actor.role) && cs.status === 'ready_for_approval';
  const names = STEPS.map((s, i) => (i === 3 && reviewing ? 'Review and approve' : s));
  const setStep = (n: number) => go(`#/case/${def.id}?step=${n}`);
  // Direction-aware step transition; on a step change, focus the step heading and bring it into view.
  const prevStep = useRef(step);
  const dir = step >= prevStep.current ? 'fwd' : 'back';
  const stepRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (prevStep.current === step) return;
    prevStep.current = step;
    const el = stepRef.current;
    if (!el) return;
    const h = el.querySelector<HTMLElement>('h3');
    if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
    if (el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [step]);
  const idx = defs.findIndex((d) => d.id === id);
  const next = defs[idx + 1];

  return (
    <div className="page flow">
      <div className="crumbs">
        <a href="#/queue">All cases</a> / <span className="mono">{def.id}</span>
        <span className="crumb-nav">
          <a href={`#/case/${def.id}?view=full&from=${step}`}>Show full details</a>
          {next && <a href={`#/case/${next.id}`} title={next.title}>Next case →</a>}
        </span>
      </div>
      <div className="flow-head">
        <div className="case-tags"><Prio d={def} /> <StatusPill s={cs.status} /> <Origin d={def} /> <span className="tag">{def.area}</span></div>
        <h1>{def.title}</h1>
        <button className="link need-help" onClick={openHelp}>Need help?</button>
      </div>
      {(fs.staleSignoff || fs.staleProposal) && (
        <div className="banner warn" role="alert">
          {fs.staleSignoff ? 'This case was signed off, but the evidence it covers changed afterwards. The sign-off no longer counts; reopen and reconsider.' : 'The evidence changed after this decision was submitted. It cannot be approved as is; a reviewer must return it to the preparer.'}
        </div>
      )}

      <ol className="progress" aria-label={`Step ${step} of 4`}>
        {names.map((n, i) => (
          <li key={n} className={i + 1 === step ? 'on' : i + 1 < step ? 'past' : ''}>
            <button onClick={() => setStep(i + 1)} aria-current={i + 1 === step ? 'step' : undefined}><span className="progress-n">{i + 1}</span> {n}</button>
          </li>
        ))}
      </ol>
      <div className="progress-track" aria-hidden><div className="progress-fill" style={{ width: `${step * 25}%` }} /></div>
      <p className="small muted progress-label">Step {step} of 4</p>

      <div className="flow-body">
        <div className="flow-main">
          <div key={step} ref={stepRef} className={`step-anim ${dir}`}>
          {step === 1 && <StepWhat def={def} onNext={() => setStep(2)} onHelp={openHelp} />}
          {step === 2 && <StepProof def={def} onNext={() => setStep(3)} onBack={() => setStep(1)} />}
          {step === 3 && <StepFix def={def} fs={fs} onNext={() => setStep(4)} onBack={() => setStep(2)} />}
          {step === 4 && (reviewing ? <StepReview def={def} fs={fs} /> : <StepSend def={def} fs={fs} onBack={() => setStep(3)} />)}
          </div>
        </div>
        <aside className="flow-side">
          <Checklist items={fs.items} />
          <div className="small muted">Owner <Person id={cs.owner} /> · <a href={`#/case/${def.id}?view=full&from=${step}`}>Show full details</a></div>
        </aside>
      </div>
      <HelpPanel def={def} open={helpOpen} step={step} onClose={closeHelp} />
    </div>
  );
}

/** The record to show first: the source side of the first comparison, else the first document value. */
function keySource(def: CaseDef): string | undefined {
  const fromRecon = def.reconciliations.flatMap((r) => r.b.refs).find((r) => ['ev', 'docpage'].includes(refKind(r)));
  return fromRecon ?? def.refs.find((r) => ['ev', 'docpage', 'doc'].includes(refKind(r)));
}

function SourcePreview({ r }: { r?: string }) {
  const { ix } = useApp();
  if (!r) return <p className="small muted">This case has no single source page to show.</p>;
  const k = refKind(r);
  if (k === 'ev') { const e = ix.evs.get(r)!; return <DocPage doc={ix.docs.get(e.document_id)!} page={e.page} focusEv={e.id} compact focusOnly />; }
  const docId = k === 'doc' ? r : r.slice(4, 7);
  return <DocPage doc={ix.docs.get(docId)!} page={k === 'doc' ? 1 : Number(r.split('#page')[1])} compact focusOnly />;
}

function StepWhat({ def, onNext, onHelp }: { def: CaseDef; onNext: () => void; onHelp: (e: { currentTarget: HTMLElement }) => void }) {
  return (
    <Section title="What’s wrong">
      <p className="lead">{plainSummary(def)}</p>
      {def.effect ? (
        <div className="flow-effect">
          <span className="small muted">Estimated tax effect if corrected</span>
          <EffectView e={def.effect} />
          <span className="small muted">Federal / California. An estimate from the return’s tax-effect rates, not a recomputed return.</span>
        </div>
      ) : <p className="flow-effect no-estimate">{noEstimateSentence(def)}</p>}
      <h4>Where it comes from</h4>
      <SourcePreview r={keySource(def)} />
      <details className="small show-details">
        <summary>Show details</summary>
        <p><strong>Why it was flagged:</strong> {def.why}</p>
        {def.matters && <p><strong>Why it matters:</strong> {def.matters}</p>}
        <p className="muted">Case <span className="mono">{def.id}</span> · rule <span className="mono">{def.ruleId}</span> · {def.refs.length} records</p>
      </details>
      <p className="small muted">“Yes, that’s right” only moves you on. It records nothing and changes no status.</p>
      <ActionBar extra={<button className="btn ghost" onClick={onHelp}>I need help</button>}>
        <button className="btn primary" onClick={onNext}>Yes, that’s right</button>
      </ActionBar>
    </Section>
  );
}

function Compare({ r }: { r: Reconciliation }) {
  const numeric = r.comparable && typeof r.a.value === 'number' && typeof r.b.value === 'number';
  const fmt = (v: number | string | null) => (typeof v === 'number' ? (r.unit === 'USD' ? money(v, { cents: !Number.isInteger(v) }) : `${v.toLocaleString()} ${r.unit}`) : v ?? '—');
  const diff = numeric ? (r.a.value as number) - (r.b.value as number) : null;
  return (
    <div className="compare">
      <div className="compare-t">{r.title}</div>
      <div className="recon">
        <div className="side"><div className="side-l">On the return · {r.a.label}</div><div className="side-v">{fmt(r.a.value)}</div><div className="refs">{r.a.refs.slice(0, 3).map((x) => <Ref key={x} r={x} compact />)}</div></div>
        <div className="vs">{numeric ? <><div className="small muted">Difference</div><div className={`side-v ${diff ? 'neg' : 'pos'}`}>{diff === 0 ? '0' : fmt(diff)}</div></> : <div className="small muted">{r.comparable ? 'compare' : 'not directly comparable'}</div>}</div>
        <div className="side"><div className="side-l">In the source · {r.b.label}</div><div className="side-v">{fmt(r.b.value)}</div><div className="refs">{r.b.refs.slice(0, 3).map((x) => <Ref key={x} r={x} compact />)}</div></div>
      </div>
      {r.finding && <p className="small">{r.finding}</p>}
    </div>
  );
}

function StepProof({ def, onNext, onBack }: { def: CaseDef; onNext: () => void; onBack: () => void }) {
  const { state } = useApp();
  const cs = state.cases[def.id];
  const docs = useMemo(() => [...new Set(def.refs.filter((r) => ['doc', 'docpage'].includes(refKind(r))))], [def]);
  return (
    <Section title="Check the proof">
      {def.reconciliations.length ? def.reconciliations.map((r) => <Compare key={r.id} r={r} />) : <p className="muted">This case has no numeric comparison. The supporting facts are below.</p>}
      {def.reconciliations.length === 0 && def.facts.length > 0 && <ul className="facts">{def.facts.map((f, i) => <li key={i}>{f.text}</li>)}</ul>}
      {docs.length > 0 && <><h4>Documents this case relies on</h4><div className="refs">{docs.map((r) => <Ref key={r} r={r} />)}</div></>}
      <h4>Evidence linked to the decision</h4>
      {cs.links.length ? (
        <ul className="plain small">{cs.links.map((l) => <li key={l.ref}><Ref r={l.ref} compact /> {l.why} <span className="muted">— <Person id={l.by} /></span></li>)}</ul>
      ) : <p className="small muted">None yet. To link a record by hand, use <a href={`#/case/${def.id}?view=full&from=2`}>Show full details</a>.</p>}
      <ActionBar onBack={onBack}><button className="btn primary" onClick={onNext}>The proof checks out</button></ActionBar>
    </Section>
  );
}

function StepFix({ def, fs, onNext, onBack }: { def: CaseDef; fs: FlowState; onNext: () => void; onBack: () => void }) {
  const { state, run, actor } = useApp();
  const cs = state.cases[def.id];
  const [rejectNote, setRejectNote] = useState('');
  const staff = ['preparer', 'reviewer', 'partner'].includes(actor.role);
  const cmd = (i: number): Command => {
    const s = def.suggestions[i];
    return { type: 'case.adjust', payload: { caseId: def.id, adjId: `adj-${Date.now().toString(36)}-${i}`, lineKey: s.lineKey, from: s.from, to: s.to, reason: s.reason, federal: s.effect.federal, california: s.effect.california } };
  };
  const open = def.suggestions.map((s, i) => ({ s, i, existing: existingAdjustment(state, def, s) }));
  const proposable = open.filter((x) => !x.existing);
  const canDecide = (a: { by: string; federal: number; california: number }) => a.by !== actor.id && (approverFor(a) === 'partner' ? actor.role === 'partner' : ['reviewer', 'partner'].includes(actor.role));

  return (
    <Section title="Fix it">
      {def.suggestions.length === 0 ? (
        <p>Our checks do not suggest a specific change to the return for this case. The decision in the next step records how it was resolved.</p>
      ) : (
        <>
          <p>Proposed changes, computed from the evidence. The original return values are never overwritten; each change is an adjustment someone else must approve.</p>
          <div className="tbl-wrap">
            <table className="tbl fix-tbl">
              <thead><tr><th>Line</th><th className="num">Now</th><th className="num">Proposed</th><th>What this means</th><th className="num">Est. effect</th><th>Status</th></tr></thead>
              <tbody>
                {open.map(({ s, i, existing }) => {
                  const approver = approverFor(s.effect);
                  return (
                    <tr key={s.lineKey + i}>
                      <td data-label="Line"><span className="mono">{s.lineKey}</span></td>
                      <td className="num" data-label="Now">{money(s.from, { cents: !Number.isInteger(s.from) })}</td>
                      <td className="num" data-label="Proposed"><strong>{money(s.to, { cents: !Number.isInteger(s.to) })}</strong></td>
                      <td className="small fix-why">{explainSuggestion(def, s)}</td>
                      <td className="num" data-label="Est. effect"><EffectView e={s.effect} compact /><div className="small muted">needs {approver}</div></td>
                      <td className="small" data-label="Status">
                        {existing ? (existing.decision ? <span className="pos">Approved by <Person id={existing.decision.by} /></span> : <span className="muted">Proposed, waiting for {approverFor(existing)}</span>)
                          : <ActionButton className="btn small" disabled={!staff || cs.status === 'resolved'} onRun={() => run(cmd(i), `Proposed ${s.lineKey}`)}>Propose</ActionButton>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flow-actions">
            {proposable.length > 0 && (
              <ActionButton className="btn primary" disabled={!staff || cs.status === 'resolved'} onRun={() => run(proposable.map((x) => cmd(x.i)), `Proposed ${proposable.length} adjustment(s)`)}>
                {proposable.length === def.suggestions.length ? 'Propose all' : `Propose remaining (${proposable.length})`}
              </ActionButton>
            )}
            {!proposable.length && <span className="small muted">Every suggested change is already proposed or approved. An identical adjustment cannot be proposed twice.</span>}
          </div>
          <p className="small muted">Effects are estimates: the change times the return’s tax-effect rates. Lots sold while living in California use the California-source rate.</p>
        </>
      )}

      {cs.adjustments.some((a) => a.decision?.status === 'rejected') && (
        <p className="small">Rejected: {cs.adjustments.filter((a) => a.decision?.status === 'rejected').map((a) => <span key={a.id}><span className="mono">{a.lineKey}</span> → {money(a.to)} ({a.decision!.note}) </span>)}</p>
      )}

      {fs.pending.length > 0 && (
        <div className="waiting" role="status">
          <strong>Waiting for {fs.pendingApprover} approval</strong> of {fs.pending.length} adjustment{fs.pending.length > 1 ? 's' : ''}. The decision cannot be submitted until they are approved or rejected.
          {fs.pending.some(canDecide) ? (
            <div className="approve-box">
              {fs.pending.filter(canDecide).map((a) => (
                <div key={a.id} className="row-wrap small"><span className="mono">{a.lineKey}</span> {money(a.from)} → <strong>{money(a.to)}</strong> <EffectView e={{ federal: a.federal, california: a.california, parts: [], basis: 'Estimate recorded with the adjustment' }} compact /> · proposed by <Person id={a.by} /></div>
              ))}
              <div className="row-wrap">
                <ActionButton className="btn primary" onRun={() => run(fs.pending.filter(canDecide).map((a) => ({ type: 'case.adjust.decide' as const, payload: { caseId: def.id, adjId: a.id, decision: 'approved', note: 'Agreed to cited evidence' } })), 'Adjustments approved')}>Approve {fs.pending.filter(canDecide).length > 1 ? 'all' : ''}</ActionButton>
                <input value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} placeholder="Reason to reject" aria-label="Reason to reject" />
                <ActionButton className="btn ghost" disabled={rejectNote.trim().length < 5} onRun={() => { if (run(fs.pending.filter(canDecide).map((a) => ({ type: 'case.adjust.decide' as const, payload: { caseId: def.id, adjId: a.id, decision: 'rejected', note: rejectNote } })), 'Adjustments rejected')) setRejectNote(''); }}>Reject</ActionButton>
              </div>
            </div>
          ) : <div className="small muted">{actor.role === 'preparer' ? `Switch the demo role to a ${fs.pendingApprover} to approve.` : `Your role cannot approve these (${fs.pendingApprover} needed, and nobody approves their own work).`}</div>}
        </div>
      )}

      <ActionBar onBack={onBack}><button className="btn primary" onClick={onNext}>Next: send</button></ActionBar>
    </Section>
  );
}

function StepSend({ def, fs, onBack }: { def: CaseDef; fs: FlowState; onBack: () => void }) {
  const { ix, state, run, actor } = useApp();
  const cs = state.cases[def.id];
  const initial: Outcome = def.suggestions.length && def.allowedOutcomes.includes('corrected') ? 'corrected' : def.allowedOutcomes[0];
  const [outcome, setOutcome] = useState<Outcome>(initial);
  const [rationale, setRationale] = useState('');
  const blockers = closeBlockers(ix, def, state, outcome, rationale);
  const unasked = def.openQuestions.filter((q) => !cs.questions.some((x) => x.text === q));
  const clientQs = cs.questions.filter((q) => q.to === 'client');
  const staff = ['preparer', 'reviewer', 'partner'].includes(actor.role);

  if (cs.status === 'resolved') {
    return (
      <Section title="Done">
        {cs.resolution && <div className="decision"><strong>{OUTCOME_LABEL[cs.resolution.outcome]}</strong>: {cs.resolution.rationale}<div className="small muted">Prepared by <Person id={cs.resolution.by} /> · approved by <Person id={cs.resolution.approvedBy} /> {fmtDate(cs.resolution.approvedAt)}</div></div>}
        {fs.staleSignoff && <p className="neg">The sign-off is stale. Reopen the case in <a href={`#/case/${def.id}?view=full&from=4`}>full details</a>.</p>}
      </Section>
    );
  }
  if (cs.status === 'ready_for_approval') {
    return (
      <Section title="Submitted">
        {cs.proposal && <div className="decision pending"><strong>{OUTCOME_LABEL[cs.proposal.outcome]}</strong>: {cs.proposal.rationale}<div className="small muted">Submitted by <Person id={cs.proposal.by} />, {fmtDate(cs.proposal.at)}</div></div>}
        <p className="small">{fs.items.find((i) => i.id === 'decision')!.detail}. Switch the demo role to a reviewer or partner to approve.</p>
      </Section>
    );
  }

  return (
    <Section title="Send">
      <h4>Questions for the client</h4>
      {clientQs.length > 0 && <ul className="plain small">{clientQs.map((q) => <li key={q.id}>{q.text} — {q.answer ? <span className="pos">answered: {q.answer.text}</span> : <span className="muted">waiting for the client</span>}</li>)}</ul>}
      {unasked.length ? (
        <ul className="plain">{unasked.map((q) => (
          <li key={q} className="row-wrap"><span>{q}</span>
            <ActionButton className="btn small" disabled={!staff} onRun={() => run({ type: 'case.question', payload: { caseId: def.id, qid: `q-${Date.now().toString(36)}`, to: 'client', toWho: 'cu-01', text: q, expected: 'Answer and supporting document if available' } }, 'Question sent to client')}>Ask the client</ActionButton>
          </li>))}
        </ul>
      ) : clientQs.length === 0 && <p className="small muted">No client question is needed for this case.</p>}

      <h4>Your decision</h4>
      <label className="small" htmlFor="flow-outcome">Outcome</label>
      <select id="flow-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value as Outcome)} aria-label="Decision outcome">
        {def.allowedOutcomes.map((o) => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}
      </select>
      <label className="small" htmlFor="flow-rationale">Why (at least 20 characters: what you checked and what it shows)</label>
      <textarea id="flow-rationale" rows={4} value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="e.g. D11 gives the basis for all three lots; adjustments approved by the partner." />
      <div className="small muted">{rationale.trim().length} / 20 characters</div>

      <h4>Still missing</h4>
      {blockers.length ? <ul className="blockers small">{blockers.map((b) => <li key={b}>{b}</li>)}</ul> : <p className="small pos">Nothing is missing. You can submit.</p>}
      {fs.pending.length > 0 && <p className="waiting small">Waiting for {fs.pendingApprover} approval of {fs.pending.length} adjustment(s).</p>}

      <ActionBar onBack={onBack}>
        <ActionButton className="btn primary" disabled={!staff || blockers.length > 0} onRun={() => { if (run({ type: 'case.propose', payload: { caseId: def.id, outcome, rationale } }, 'Decision submitted for approval')) setRationale(''); }}>Submit for approval</ActionButton>
      </ActionBar>
    </Section>
  );
}

function StepReview({ def, fs }: { def: CaseDef; fs: FlowState }) {
  const { state, run } = useApp();
  const cs = state.cases[def.id];
  const [reason, setReason] = useState('');
  const p = cs.proposal!;
  const adjs = cs.adjustments.filter((a) => a.decision?.status !== 'rejected');
  return (
    <Section title="Review and approve">
      <div className="decision pending"><strong>{OUTCOME_LABEL[p.outcome]}</strong>: {p.rationale}<div className="small muted">Submitted by <Person id={p.by} />, {fmtDate(p.at)}</div></div>
      <h4>What changed</h4>
      {adjs.length ? <ul className="plain small">{adjs.map((a) => <li key={a.id}><span className="mono">{a.lineKey}</span> {money(a.from)} → <strong>{money(a.to)}</strong> · <EffectView e={{ federal: a.federal, california: a.california, parts: [], basis: 'Estimate recorded with the adjustment' }} compact /> · {a.decision ? <>approved by <Person id={a.decision.by} /></> : 'pending'}</li>)}</ul> : <p className="small muted">No change to the return.</p>}
      <h4>Evidence</h4>
      {cs.links.length ? <div className="refs">{cs.links.map((l) => <Ref key={l.ref} r={l.ref} compact />)}</div> : <p className="small muted">No records linked.</p>}
      {cs.questions.filter((q) => q.answer).map((q) => <p key={q.id} className="small">Client answer: {q.answer!.text}</p>)}
      {fs.staleProposal && <p className="neg small">The evidence changed after submission, so approval will be refused. Return it with a reason.</p>}
      <label className="small" htmlFor="flow-return">Reason, if you return it to the preparer</label>
      <input id="flow-return" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason to return" aria-label="Reason to return" />
      <ActionBar extra={<ActionButton className="btn ghost" onRun={() => run({ type: 'case.return', payload: { caseId: def.id, reason } }, 'Returned to preparer')}>Return to preparer</ActionButton>}>
        <ActionButton className="btn primary" onRun={() => run({ type: 'case.resolve', payload: { caseId: def.id } }, 'Approved and resolved')}>Approve & sign off</ActionButton>
      </ActionBar>
    </Section>
  );
}

/** The same action row on every step: Back on the left, the primary action always on the right. */
function ActionBar({ onBack, extra, children }: { onBack?: () => void; extra?: ReactNode; children?: ReactNode }) {
  return (
    <div className="action-bar">
      {onBack ? <button className="btn ghost" onClick={onBack}>Back</button> : <span />}
      <div className="action-bar-r">{extra}{children}</div>
    </div>
  );
}
