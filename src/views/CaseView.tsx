import { useMemo, useState } from 'react';
import { useApp } from '../ui/context';
import { DocPage } from '../ui/DocPage';
import { EffectView, Origin, Person, Prio, Ref, Refs, Section, SevPill, StatusPill, fmtDate, money } from '../ui/components';
import { refKind, refKindLabel, resolveRef } from '../domain/refs';
import { lineValue, num } from '../domain/packetIndex';
import {
  allowedTransitions, caseFacts, closeBlockers, DISPOSITION_LABEL, OUTCOME_LABEL, PARTNER_THRESHOLD, RECON_LABEL, STATUS_LABEL,
  type ReconStatus,
} from '../domain/workflow';
import type { CaseDef, Outcome, Reconciliation } from '../domain/cases';
import { estimateEffect, type RateCategory } from '../domain/effects';
import { CopilotPanel } from './CopilotPanel';

export function CaseView({ id }: { id: string }) {
  const { defsById, defs } = useApp();
  const def = defsById.get(id);
  if (!def) return <div className="page"><h1>Case not found</h1><a href="#/queue">Back to queue</a></div>;
  const idx = defs.findIndex((d) => d.id === id);
  const prev = defs[idx - 1], next = defs[idx + 1];
  return (
    <div className="page case-page">
      <div className="crumbs">
        <a href="#/queue">Review queue</a> / <span className="mono">{def.id}</span>
        <span className="crumb-nav">
          {prev && <a href={`#/case/${prev.id}`} title={prev.title}>← previous</a>}
          {next && <a href={`#/case/${next.id}`} title={next.title}>next →</a>}
        </span>
      </div>
      <CaseHeader def={def} />
      <div className="panes">
        <EvidencePane def={def} />
        <InvestigationPane def={def} />
        <WorkflowPane def={def} />
      </div>
    </div>
  );
}

function CaseHeader({ def }: { def: CaseDef }) {
  const { state, ix } = useApp();
  const cs = state.cases[def.id];
  const f = caseFacts(ix, def, state);
  return (
    <div className="case-h">
      <div className="case-h-l">
        <div className="case-tags"><Prio d={def} /> <SevPill s={def.severity} /> <StatusPill s={cs.status} /> <Origin d={def} /> <span className="tag">{def.area}</span> <span className="tag">{def.jurisdiction}</span></div>
        <h1>{def.title}</h1>
        {f.staleSignoff && <div className="banner warn">Sign-off is stale: evidence, dispositions or answers changed after this case was approved. Reopen and reconsider.</div>}
      </div>
      <div className="case-h-r">
        <div className="small muted">Owner</div><Person id={cs.owner} />
        <div className="small muted">Estimated effect</div><EffectView e={def.effect} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Pane A

function EvidencePane({ def }: { def: CaseDef }) {
  const { ix, state, run, toast } = useApp();
  const cs = state.cases[def.id];
  const allRefs = useMemo(() => {
    const seen = new Set<string>();
    const add = (r: string) => { if (!seen.has(r)) seen.add(r); };
    def.refs.forEach(add);
    def.reconciliations.forEach((r) => { r.a.refs.forEach(add); r.b.refs.forEach(add); });
    def.facts.forEach((f) => f.refs.forEach(add));
    def.conflicts.forEach((f) => f.refs.forEach(add));
    cs.links.forEach((l) => add(l.ref));
    return [...seen].filter((r) => refKind(r) !== 'line' && refKind(r) !== 'case');
  }, [def, cs.links]);
  const firstEv = allRefs.find((r) => refKind(r) === 'ev' || refKind(r) === 'docpage' || refKind(r) === 'doc');
  const [focus, setFocus] = useState<string | undefined>(firstEv);
  const [linkRef, setLinkRef] = useState('');
  const [why, setWhy] = useState('');

  const groups = new Map<string, string[]>();
  for (const r of allRefs) {
    const k = refKindLabel(refKind(r));
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const focusR = focus ? resolveRef(ix, focus) : undefined;
  let viewer: JSX.Element | null = null;
  if (focus && focusR) {
    const kind = refKind(focus);
    if (kind === 'ev') {
      const e = ix.evs.get(focus)!;
      viewer = <DocPage doc={ix.docs.get(e.document_id)!} page={e.page} focusEv={e.id} compact />;
    } else if (kind === 'docpage' || kind === 'doc') {
      const docId = kind === 'doc' ? focus : focus.slice(4, 7);
      const page = kind === 'doc' ? 1 : Number(focus.split('#page')[1]);
      viewer = <DocPage doc={ix.docs.get(docId)!} page={page} compact />;
    } else {
      viewer = <div className="paper compact"><div className="paper-h"><strong>{focusR.label}</strong></div><div className="paper-body">{focusR.value ?? '—'}</div></div>;
    }
  }

  const linked = new Set(cs.links.map((l) => l.ref));
  const tryLink = () => {
    const r = resolveRef(ix, linkRef.trim());
    if (r.kind === 'unknown' || /not found|unknown/.test(r.label)) { toast(`Unrecognised reference "${linkRef.trim()}"`, 'err'); return; }
    if (run({ type: 'case.link', payload: { caseId: def.id, ref: linkRef.trim(), why } }, `Linked ${linkRef.trim()}`)) { setLinkRef(''); setWhy(''); }
  };

  return (
    <div className="pane pane-a">
      <h2>Source evidence</h2>
      {viewer}
      {[...groups.entries()].map(([k, refs]) => (
        <div key={k} className="ev-group">
          <div className="ev-group-h">{k} <span className="muted">({refs.length})</span></div>
          <ul className="ev-list">
            {refs.map((r) => {
              const x = resolveRef(ix, r);
              const docId = x.kind === 'ev' ? ix.evs.get(r)?.document_id : x.kind === 'doc' ? r : x.kind === 'docpage' ? r.slice(4, 7) : undefined;
              const disp = docId ? state.docs[docId]?.disposition : undefined;
              return (
                <li key={r} className={focus === r ? 'on' : ''}>
                  <button className="ev-item" onClick={() => setFocus(r)}>
                    <span className="mono small">{r}</span>
                    <span className="ev-label">{x.label.replace(`${r} · `, '')}</span>
                    {x.value !== undefined && <span className="ev-val">{String(x.value).slice(0, 140)}</span>}
                    <span className="ev-meta">
                      {x.confidence !== undefined && <span className={x.confidence < 0.9 ? 'neg' : 'muted'}>conf {x.confidence}</span>}
                      {disp && <span className="muted"> · {DISPOSITION_LABEL[disp].split(' (')[0]}</span>}
                      {x.documentary ? <span className="muted"> · documentary</span> : <span className="muted"> · statement/derived</span>}
                      {linked.has(r) && <span className="pos"> · linked to decision</span>}
                    </span>
                  </button>
                  {x.route && <a className="small" href={x.route}>open</a>}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <div className="linkbox">
        <div className="small"><strong>Link evidence to the decision</strong> (any ev-####, D##, doc:D##, qa-, msg-, call-, py:/, agency:/)</div>
        <input value={linkRef} onChange={(e) => setLinkRef(e.target.value)} placeholder="e.g. D11 or ev-0066" aria-label="Reference to link" />
        <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Why it supports the conclusion" aria-label="Why" />
        <button className="btn" disabled={!linkRef.trim()} onClick={tryLink}>Link</button>
        {linkRef.trim() && <div className="small muted">{(() => { const r = resolveRef(ix, linkRef.trim()); return r.kind === 'unknown' ? 'Unrecognised reference' : `${refKindLabel(r.kind)}: ${r.label}`; })()}</div>}
        {cs.links.length > 0 && (
          <ul className="plain small">
            {cs.links.map((l) => (
              <li key={l.ref}><Ref r={l.ref} compact /> {l.why} <span className="muted">— <Person id={l.by} />, {fmtDate(l.at)}</span> <button className="link small" onClick={() => run({ type: 'case.unlink', payload: { caseId: def.id, ref: l.ref } }, 'Unlinked')}>unlink</button></li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Pane B

function InvestigationPane({ def }: { def: CaseDef }) {
  const { ix, state } = useApp();
  const cs = state.cases[def.id];
  const [outcome, setOutcome] = useState<Outcome | ''>('');
  const blockers = closeBlockers(ix, def, state, outcome || def.allowedOutcomes[0], 'x'.repeat(20));
  return (
    <div className="pane pane-b">
      <h2>Investigation</h2>
      <CopilotPanel def={def} />
      <Section title="Why it was flagged"><p>{def.why}</p>{def.diagnosticMessage && <p className="muted small">Engine message: “{def.diagnosticMessage}” {def.versionsSeen && `(versions ${def.versionsSeen.join(', ')})`}</p>}</Section>
      {def.matters && <Section title="Why it matters"><p>{def.matters}</p></Section>}
      {def.reconciliations.map((r) => <ReconInspector key={r.id} def={def} r={r} />)}
      {def.facts.length > 0 && (
        <Section title="Supporting facts">
          <ul className="facts">{def.facts.map((f, i) => <li key={i}>{f.text} <Refs refs={f.refs} compact max={4} /></li>)}</ul>
        </Section>
      )}
      {def.conflicts.length > 0 && (
        <Section title="Conflicting facts">
          <ul className="facts conflict">{def.conflicts.map((f, i) => <li key={i}>{f.text} <Refs refs={f.refs} compact /></li>)}</ul>
        </Section>
      )}
      {def.openQuestions.length > 0 && (
        <Section title="Unanswered questions">
          <ul className="facts">{def.openQuestions.map((q, i) => {
            const asked = cs.questions.find((x) => x.text === q);
            return <li key={i}>{q} {asked ? <span className="muted small">(asked {fmtDate(asked.at)}{asked.answer ? ', answered' : ''})</span> : <AskButton def={def} text={q} />}</li>;
          })}</ul>
        </Section>
      )}
      <Section title="To close this case">
        <ul className="checklist">
          {def.requirements.map((r) => <li key={r}>{r}</li>)}
        </ul>
        <div className="small">
          Outcome check:{' '}
          <select value={outcome} onChange={(e) => setOutcome(e.target.value as Outcome)} aria-label="Outcome to check">
            {def.allowedOutcomes.map((o) => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}
          </select>
          {blockers.length === 0 ? <span className="pos"> ✓ nothing blocking (rationale still required)</span> : <ul className="blockers">{blockers.filter((b) => !/rationale/.test(b)).map((b) => <li key={b}>{b}</li>)}</ul>}
        </div>
        <p className="next"><strong>Next action:</strong> {def.nextAction}</p>
      </Section>
      {def.lines.length > 0 && <AffectedLines def={def} />}
      <p className="muted small">Case {def.id} · rule {def.ruleId} · priority score {def.priorityScore} ({def.priorityBasis})</p>
    </div>
  );
}

function AskButton({ def, text }: { def: CaseDef; text: string }) {
  const { run } = useApp();
  return <button className="link small" onClick={() => run({ type: 'case.question', payload: { caseId: def.id, qid: `q-${Date.now().toString(36)}`, to: 'client', toWho: 'cu-01', text, expected: 'Answer and supporting document if available' } }, 'Question sent to client')}>ask client</button>;
}

function ReconInspector({ def, r }: { def: CaseDef; r: Reconciliation }) {
  const { state, run } = useApp();
  const cs = state.cases[def.id];
  const cur = cs.recon[r.id];
  const [status, setStatus] = useState<ReconStatus>(cur?.status ?? 'unchecked');
  const [note, setNote] = useState('');
  const numeric = r.comparable && typeof r.a.value === 'number' && typeof r.b.value === 'number';
  const diff = numeric ? (r.a.value as number) - (r.b.value as number) : null;
  const unit = (v: number | string | null) => (typeof v === 'number' ? (r.unit === 'USD' ? money(v, { cents: !Number.isInteger(v) }) : `${v.toLocaleString()} ${r.unit}`) : v ?? '—');
  return (
    <Section title={<>Reconciliation · {r.title}</>} right={<span className={`pill rc-${cur?.status ?? 'unchecked'}`}>{RECON_LABEL[cur?.status ?? 'unchecked']}</span>}>
      <div className="recon">
        <div className="side"><div className="side-l">A · {r.a.label}</div><div className="side-v">{unit(r.a.value)}</div>{r.a.note && <div className="small muted">{r.a.note}</div>}<Refs refs={r.a.refs} compact max={3} /></div>
        <div className="vs">{numeric ? <><div className="small muted">A − B</div><div className={`side-v ${diff ? 'neg' : 'pos'}`}>{diff === 0 ? '0' : unit(diff)}</div></> : <div className="small muted">{r.comparable ? 'compare' : 'not numerically comparable'}</div>}</div>
        <div className="side"><div className="side-l">B · {r.b.label}</div><div className="side-v">{unit(r.b.value)}</div>{r.b.note && <div className="small muted">{r.b.note}</div>}<Refs refs={r.b.refs} compact max={3} /></div>
      </div>
      <p className="small"><strong>Expected:</strong> {r.expectation}</p>
      {r.finding && <p className="small"><strong>What the evidence shows:</strong> {r.finding}</p>}
      {cur && <p className="small">Conclusion: <strong>{RECON_LABEL[cur.status]}</strong> — {cur.note} <span className="muted">(<Person id={cur.by} />, {fmtDate(cur.at)})</span></p>}
      <div className="inline-form">
        <select value={status} onChange={(e) => setStatus(e.target.value as ReconStatus)} aria-label="Reconciliation status">
          {(Object.keys(RECON_LABEL) as ReconStatus[]).map((s) => <option key={s} value={s}>{RECON_LABEL[s]}</option>)}
        </select>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="How was this concluded?" aria-label="Reconciliation note" />
        <button className="btn" onClick={() => { if (run({ type: 'case.recon', payload: { caseId: def.id, recId: r.id, status, note } }, 'Reconciliation recorded')) setNote(''); }}>Record</button>
      </div>
    </Section>
  );
}

function AffectedLines({ def }: { def: CaseDef }) {
  const { ix } = useApp();
  return (
    <Section title="Return lines affected">
      <table className="tbl small">
        <thead><tr><th>Line</th>{ix.versions.map((v) => <th key={v.version} className="num">{v.version}</th>)}</tr></thead>
        <tbody>
          {def.lines.slice(0, 30).map((k) => (
            <tr key={k}>
              <td><a href={`#/line/${encodeURIComponent(k)}`} className="mono">{k}</a> <span className="muted">{ix.lines.get(ix.current.version)!.get(k)?.label?.slice(0, 60)}</span></td>
              {ix.versions.map((v) => <td key={v.version} className="num">{fmtCell(lineValue(ix, k, v.version))}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {def.lines.length > 30 && <p className="small muted">+{def.lines.length - 30} more lines</p>}
    </Section>
  );
}
const fmtCell = (v: unknown) => (typeof v === 'number' ? money(v, { cents: !Number.isInteger(v) }) : v === undefined ? '—' : String(v));

// ---------------------------------------------------------------- Pane C

function WorkflowPane({ def }: { def: CaseDef }) {
  const { ix, state, run, actor, actors, wp, toast } = useApp();
  const cs = state.cases[def.id];
  const f = caseFacts(ix, def, state);
  const staff = actors.filter((a) => ['preparer', 'reviewer', 'partner'].includes(a.role));
  const [note, setNote] = useState('');
  const [blocking, setBlocking] = useState(false);
  const [qText, setQText] = useState('');
  const [qTo, setQTo] = useState<'client' | string>('client');
  const [qExp, setQExp] = useState('');
  const [answer, setAnswer] = useState<Record<string, string>>({});
  const [clearText, setClearText] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState<Outcome>(def.allowedOutcomes[0]);
  const [rationale, setRationale] = useState('');
  const [returnReason, setReturnReason] = useState('');
  const [reopenReason, setReopenReason] = useState('');
  const [blockNote, setBlockNote] = useState('');
  const sug = def.suggested;
  const [adjLine, setAdjLine] = useState(sug?.lineKey ?? def.lines[0] ?? '');
  const [adjTo, setAdjTo] = useState(sug ? String(sug.to) : '');
  const [adjReason, setAdjReason] = useState(sug?.reason ?? '');
  const [adjCat, setAdjCat] = useState<RateCategory | 'payment_federal' | 'payment_california' | 'none'>('none');
  const [adjDir, setAdjDir] = useState<'auto' | 'adds' | 'reduces'>('auto');
  const curVal = num(lineValue(ix, adjLine));
  const isSuggested = sug && adjLine === sug.lineKey && Number(adjTo) === sug.to;
  // Expense lines (Schedule C/E expenses) reduce the category they feed, so a change moves it the other way.
  const reduces = adjDir === 'reduces' || (adjDir === 'auto' && isExpenseLine(adjLine));
  const delta = Number(adjTo) - curVal;
  const adjEffect = isSuggested ? sug!.effect : adjCat === 'none' || !isFinite(Number(adjTo)) || isNaN(curVal) ? undefined
    : estimateEffect(ix, [{ category: adjCat, amount: adjCat.startsWith('payment') ? delta : reduces ? -delta : delta, label: '' }]);

  const transitions = allowedTransitions(cs.status).filter((t) => t !== 'blocked');
  const isResolved = cs.status === 'resolved';

  return (
    <div className="pane pane-c">
      <h2>Decision & workflow</h2>

      <Section title="Status">
        <div className="row-wrap">
          <StatusPill s={cs.status} />
          {transitions.map((t) => <button key={t} className="btn ghost small" onClick={() => run({ type: 'case.status', payload: { caseId: def.id, to: t } }, `Moved to ${STATUS_LABEL[t]}`)}>{STATUS_LABEL[t]}</button>)}
        </div>
        {allowedTransitions(cs.status).includes('blocked') && (
          <div className="inline-form"><input value={blockNote} onChange={(e) => setBlockNote(e.target.value)} placeholder="Blocked on…" aria-label="Blocked on" /><button className="btn ghost small" onClick={() => { if (run({ type: 'case.status', payload: { caseId: def.id, to: 'blocked', note: blockNote } }, 'Marked blocked')) setBlockNote(''); }}>Mark blocked</button></div>
        )}
        <div className="inline-form">
          <label className="small">Owner</label>
          <select value={cs.owner} onChange={(e) => run({ type: 'case.assign', payload: { caseId: def.id, to: e.target.value } }, 'Reassigned')} aria-label="Owner">
            {staff.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.role})</option>)}
          </select>
        </div>
      </Section>

      {(sug || def.lines.length > 0) && (
        <Section title="Adjustments" right={<span className="small muted">original values are never overwritten</span>}>
          {cs.adjustments.map((a) => (
            <div key={a.id} className="adj">
              <div><a href={`#/line/${a.lineKey}`} className="mono">{a.lineKey}</a> {money(a.from, { cents: !Number.isInteger(a.from) })} → <strong>{money(a.to, { cents: !Number.isInteger(a.to) })}</strong> · Fed {money(a.federal, { sign: true })} / CA {money(a.california, { sign: true })}</div>
              <div className="small">{a.reason} — <Person id={a.by} />, {fmtDate(a.at)}</div>
              {a.decision ? <div className={`small ${a.decision.status === 'approved' ? 'pos' : 'neg'}`}>{a.decision.status} by <Person id={a.decision.by} />: {a.decision.note}</div> : (
                <div className="row-wrap small">
                  <span className="muted">Awaiting {Math.max(Math.abs(a.federal), Math.abs(a.california)) > PARTNER_THRESHOLD ? 'partner' : 'reviewer'} approval</span>
                  <button className="btn small" onClick={() => run({ type: 'case.adjust.decide', payload: { caseId: def.id, adjId: a.id, decision: 'approved', note: 'Agreed to cited evidence' } }, 'Adjustment approved')}>Approve</button>
                  <button className="btn ghost small" onClick={() => run({ type: 'case.adjust.decide', payload: { caseId: def.id, adjId: a.id, decision: 'rejected', note: 'Not supported' } }, 'Adjustment rejected')}>Reject</button>
                </div>
              )}
            </div>
          ))}
          {!isResolved && (
            <div className="adj-form">
              {sug && <div className="small muted">Suggested by the check: {sug.lineKey} {money(sug.from)} → {money(sug.to)} ({sug.reason})</div>}
              <div className="inline-form">
                <select value={adjLine} onChange={(e) => { setAdjLine(e.target.value); }} aria-label="Line">
                  {[...new Set([sug?.lineKey, ...def.lines].filter(Boolean) as string[])].map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
                <span className="small mono">{isNaN(curVal) ? '' : money(curVal)} →</span>
                <input value={adjTo} onChange={(e) => setAdjTo(e.target.value)} placeholder="New value" aria-label="New value" className="num-in" />
              </div>
              {!isSuggested && (
                <div className="inline-form">
                  <label className="small">Effect category</label>
                  <select value={adjCat} onChange={(e) => setAdjCat(e.target.value as any)} aria-label="Effect category">
                    <option value="none">choose…</option>
                    {Object.keys(ix.current.tax_effect_rates).map((k) => <option key={k} value={k}>{k}</option>)}
                    <option value="payment_federal">federal payment</option><option value="payment_california">California payment</option>
                  </select>
                  <select value={adjDir} onChange={(e) => setAdjDir(e.target.value as any)} aria-label="Line direction">
                    <option value="auto">auto ({isExpenseLine(adjLine) ? 'expense line' : 'adds to category'})</option>
                    <option value="adds">line adds to category</option>
                    <option value="reduces">line is an expense (reduces it)</option>
                  </select>
                </div>
              )}
              <input value={adjReason} onChange={(e) => setAdjReason(e.target.value)} placeholder="Reason" aria-label="Adjustment reason" />
              <div className="small">Tax effect: {adjEffect ? <EffectView e={adjEffect} /> : <span className="muted">choose a category to estimate</span>}</div>
              <button className="btn" disabled={!adjEffect} onClick={() => run({ type: 'case.adjust', payload: { caseId: def.id, adjId: `adj-${Date.now().toString(36)}`, lineKey: adjLine, from: curVal, to: Number(adjTo), reason: adjReason, federal: adjEffect!.federal, california: adjEffect!.california } }, 'Adjustment proposed')}>Propose adjustment</button>
            </div>
          )}
        </Section>
      )}

      <Section title={`Questions (${cs.questions.length})`}>
        {cs.questions.map((q) => (
          <div key={q.id} className="q">
            <div><strong>To {q.to === 'client' ? 'client' : <Person id={q.toWho} />}:</strong> {q.text}</div>
            <div className="small muted">Asked by <Person id={q.by} />, {fmtDate(q.at)} · expected: {q.expected || '—'}</div>
            {q.answer ? <div className="answer">{q.answer.text} <span className="small muted">— <Person id={q.answer.by} />, {fmtDate(q.answer.at)} (recorded as evidence)</span></div>
              : q.to === 'client' ? <div className="small muted">Awaiting client answer (switch role to the client to answer).</div>
              : <div className="inline-form"><input value={answer[q.id] ?? ''} onChange={(e) => setAnswer({ ...answer, [q.id]: e.target.value })} placeholder="Answer" aria-label="Answer" /><button className="btn small" onClick={() => run({ type: 'case.answer', payload: { caseId: def.id, qid: q.id, text: answer[q.id] } }, 'Answer recorded')}>Record</button></div>}
          </div>
        ))}
        {!isResolved && (
          <div className="q-form">
            <div className="inline-form">
              <select value={qTo} onChange={(e) => setQTo(e.target.value)} aria-label="Ask whom">
                <option value="client">Client (Ngozi / Erik)</option>
                {staff.filter((a) => a.id !== actor.id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <textarea value={qText} onChange={(e) => setQText(e.target.value)} placeholder="Question" rows={2} aria-label="Question" />
            <input value={qExp} onChange={(e) => setQExp(e.target.value)} placeholder="Expected response / document" aria-label="Expected response" />
            <button className="btn" onClick={() => { if (run({ type: 'case.question', payload: { caseId: def.id, qid: `q-${Date.now().toString(36)}`, to: qTo === 'client' ? 'client' : 'staff', toWho: qTo === 'client' ? 'cu-01' : qTo, text: qText, expected: qExp } }, 'Question sent')) { setQText(''); setQExp(''); } }}>Send question</button>
          </div>
        )}
      </Section>

      <Section title={`Notes (${cs.notes.length})`}>
        {cs.notes.map((n) => (
          <div key={n.id} className={`note-item${n.blocking && !n.cleared ? ' blocking' : ''}`}>
            <div>{n.blocking && <span className="pill st-blocked">review note{n.cleared ? ' (cleared)' : ' · blocks filing'}</span>} {n.text}</div>
            <div className="small muted"><Person id={n.by} />, {fmtDate(n.at)}</div>
            {n.cleared && <div className="small pos">Cleared by <Person id={n.cleared.by} />: {n.cleared.text}</div>}
            {n.blocking && !n.cleared && (
              <div className="inline-form"><input value={clearText[n.id] ?? ''} onChange={(e) => setClearText({ ...clearText, [n.id]: e.target.value })} placeholder="How it was addressed" aria-label="Clear note" /><button className="btn small" onClick={() => run({ type: 'case.note.clear', payload: { caseId: def.id, noteId: n.id, text: clearText[n.id] } }, 'Review note cleared')}>Clear</button></div>
            )}
          </div>
        ))}
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note" rows={2} aria-label="Note" />
        <div className="row-wrap">
          <label className="small"><input type="checkbox" checked={blocking} onChange={(e) => setBlocking(e.target.checked)} /> Review note (blocks filing; reviewer/partner)</label>
          <button className="btn" onClick={() => { if (run({ type: 'case.note', payload: { caseId: def.id, noteId: `n-${Date.now().toString(36)}`, text: note, blocking } }, blocking ? 'Review note raised' : 'Note added')) { setNote(''); setBlocking(false); } }}>Add</button>
        </div>
      </Section>

      <Section title="Decision">
        {cs.resolution && (
          <div className="decision">
            <div><strong>{OUTCOME_LABEL[cs.resolution.outcome]}</strong>: {cs.resolution.rationale}</div>
            <div className="small muted">Prepared by <Person id={cs.resolution.by} /> {fmtDate(cs.resolution.at)} · approved by <Person id={cs.resolution.approvedBy} /> {fmtDate(cs.resolution.approvedAt)}</div>
          </div>
        )}
        {cs.status === 'ready_for_approval' && cs.proposal && (
          <div className="decision pending">
            <div><strong>Proposed: {OUTCOME_LABEL[cs.proposal.outcome]}</strong> — {cs.proposal.rationale}</div>
            <div className="small muted">by <Person id={cs.proposal.by} />, {fmtDate(cs.proposal.at)}{f.needsPartner && cs.proposal.outcome === 'corrected' ? ` · needs partner (effect over ${PARTNER_THRESHOLD.toLocaleString()})` : ''}</div>
            <div className="row-wrap">
              <button className="btn primary" onClick={() => run({ type: 'case.resolve', payload: { caseId: def.id } }, 'Approved and resolved')}>Approve & sign off</button>
              <input value={returnReason} onChange={(e) => setReturnReason(e.target.value)} placeholder="Reason to return" aria-label="Return reason" />
              <button className="btn ghost" onClick={() => run({ type: 'case.return', payload: { caseId: def.id, reason: returnReason } }, 'Returned to preparer')}>Return</button>
            </div>
          </div>
        )}
        {!isResolved && cs.status !== 'ready_for_approval' && (
          <div className="decision-form">
            <select value={outcome} onChange={(e) => setOutcome(e.target.value as Outcome)} aria-label="Outcome">
              {def.allowedOutcomes.map((o) => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}
            </select>
            <textarea value={rationale} onChange={(e) => setRationale(e.target.value)} rows={3} placeholder="Rationale and authority relied on (who, why, what evidence)" aria-label="Rationale" />
            {(() => { const b = closeBlockers(ix, def, state, outcome, rationale); return b.length ? <ul className="blockers small">{b.map((x) => <li key={x}>{x}</li>)}</ul> : <div className="small pos">Ready to submit for approval.</div>; })()}
            <button className="btn primary" onClick={() => { if (run({ type: 'case.propose', payload: { caseId: def.id, outcome, rationale } }, 'Decision submitted for approval')) setRationale(''); }}>Submit for approval</button>
          </div>
        )}
        {isResolved && (
          <div className="inline-form">
            <input value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} placeholder="Why reopen?" aria-label="Reopen reason" />
            <button className="btn ghost" onClick={() => { if (run({ type: 'case.reopen', payload: { caseId: def.id, reason: reopenReason } }, 'Case reopened')) setReopenReason(''); }}>Reopen</button>
          </div>
        )}
        <div className="small muted">Sign-offs: {cs.signoffs.length ? cs.signoffs.map((s, i) => <span key={i}>{s.level} <Person id={s.by} /> {fmtDate(s.at)}{s.level !== 'preparer' && s.fingerprint !== f.currentFingerprint ? ' (stale)' : ''}; </span>) : 'none'}</div>
      </Section>

      <Section title={`History (${cs.history.length})`}>
        {cs.history.length === 0 ? <p className="muted small">No changes yet. The case was derived from the packet ({def.origin === 'engine' ? `engine diagnostic ${def.ruleId}` : `workpaper rule ${def.ruleId}`}).</p> : (
          <ol className="history">
            {[...cs.history].reverse().map((e) => (
              <li key={e.id}>
                <span className="small muted">{fmtDate(e.at)}</span> <Person id={e.actor} /> <span className="mono small">{e.type}</span> {describe(e.payload)}
                {e.actor === actor.id && <button className="link small" onClick={() => { const r = wp.undo(actor, e.id); if (!r.ok) toast(r.error, 'err'); else toast('Undone'); }}>undo</button>}
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}

function isExpenseLine(k: string) {
  return /^SchC\.(8|9|1[0-9]|2[0-8]|30)(\.|[ab]|$)|^SchE\.(9|1[0-9])[A-Z]?$/.test(k);
}

function describe(p: any): string {
  if (p.runId && p.decision) return `copilot suggestion ${p.decision}${p.note ? `: ${p.note}` : ''}`;
  if (p.runId) return `copilot run: ${p.outcome}${p.status ? ` (${p.status})` : ''}${p.validationPassed === false ? ' — failed verification' : ''}`;
  if (p.source) return `${String(p.text).slice(0, 100)} (drafted by ${p.source})`;
  if (p.to && p.caseId && !p.lineKey) return `→ ${STATUS_LABEL[p.to as keyof typeof STATUS_LABEL] ?? p.to}${p.note ? ` (${p.note})` : ''}`;
  if (p.lineKey) return `${p.lineKey} ${p.from} → ${p.to}`;
  if (p.outcome) return `${OUTCOME_LABEL[p.outcome as Outcome]}: ${String(p.rationale).slice(0, 80)}`;
  if (p.decision) return `${p.decision}: ${p.note ?? ''}`;
  if (p.ref) return `${p.ref}${p.why ? ` — ${p.why}` : ''}`;
  if (p.text) return String(p.text).slice(0, 100);
  if (p.reason) return p.reason;
  if (p.status) return `${p.recId}: ${RECON_LABEL[p.status as ReconStatus]}`;
  return '';
}
