import { useApp } from '../ui/context';
import { EffectView, Person, Prio, Section, StatusPill, fmtDate, money } from '../ui/components';
import { READINESS_LABEL, caseFacts, type ReadinessLevel, type Step } from '../domain/workflow';

export function Overview({ ready }: { ready: { level: ReadinessLevel; steps: Step[]; blockers: string[] } }) {
  const { ix, defs, state, actor, checks } = useApp();
  const v = ix.current;
  const prev = ix.versions[ix.versions.length - 2];
  const counts = { open: 0, blocked: 0, awaiting: 0, approval: 0, resolved: 0 };
  for (const d of defs) {
    const s = state.cases[d.id].status;
    if (s === 'resolved') counts.resolved++;
    else if (s === 'blocked') counts.blocked++;
    else if (s === 'awaiting_client') counts.awaiting++;
    else if (s === 'ready_for_approval') counts.approval++;
    else counts.open++;
  }
  const unresolved = defs.filter((d) => state.cases[d.id].status !== 'resolved');
  const top = unresolved.filter((d) => d.priority === 'P1').slice(0, 8);
  const mine = unresolved.filter((d) => state.cases[d.id].owner === actor.id);
  const failing = checks.filter((c) => !c.pass);
  const recent = [...state.events].reverse().filter((e) => e.type !== 'sensitive.view').slice(0, 6);
  const nextStep = ready.steps.find((s) => !s.done && s.blocking);
  const fed = v.summary.federal, ca = v.summary.california;
  const deadlines = ix.packet.firm.deadlines as { what: string; date: string }[];
  const wpOpen = unresolved.filter((d) => d.origin === 'workpaper');
  const estFed = wpOpen.reduce((a, d) => a + (d.effect && d.classification === 'confirmed_discrepancy' ? d.effect.federal : 0), 0);

  return (
    <div className="page">
      <div className="page-h">
        <div>
          <h1>{ix.packet.packet.name}</h1>
          <p className="muted">Married filing jointly · moved California → Texas {ix.packet.household.residency[1].from} · prior preparer {ix.packet.prior_years.return_2024.prepared_by}</p>
        </div>
        <div className="next-action">
          <div className="small muted">Next recommended action</div>
          {top[0] ? <a href={`#/case/${top[0].id}`}><strong>{top[0].nextAction}</strong></a> : nextStep ? <a href={nextStep.route}><strong>{nextStep.label}</strong></a> : <strong>No open actions</strong>}
        </div>
      </div>

      <div className="grid-2">
        <Section title={<>Return snapshot <span className="muted">· {v.version} computed {fmtDate(v.computed_at)}</span></>} right={<a href="#/versions">Compare versions →</a>}>
          <table className="tbl figures">
            <thead><tr><th>Federal</th><th className="num">{v.version}</th><th className="num">Δ vs {prev.version}</th></tr></thead>
            <tbody>
              <Row label="Adjusted gross income" k="F1040.11" a={fed.agi} b={prev.summary.federal.agi} />
              <Row label="Taxable income" k="F1040.15" a={fed.taxable_income} b={prev.summary.federal.taxable_income} />
              <Row label="Total tax" k="F1040.24" a={fed.total_tax} b={prev.summary.federal.total_tax} />
              <Row label="Payments" k="F1040.33" a={fed.payments} b={prev.summary.federal.payments} />
              <Row label="Estimated-tax penalty" k="F1040.38" a={fed.penalty} b={prev.summary.federal.penalty} />
              <tr className="total"><td>{fed.balance_due >= 0 ? 'Balance due' : 'Refund'}</td><td className="num">{money(Math.abs(fed.balance_due))}</td><td className="num muted">{money(fed.balance_due - prev.summary.federal.balance_due, { sign: true })}</td></tr>
            </tbody>
          </table>
          <table className="tbl figures">
            <thead><tr><th>California (540NR)</th><th className="num">{v.version}</th><th className="num">Δ vs {prev.version}</th></tr></thead>
            <tbody>
              <Row label="Total AGI (all sources)" k="F540NR.17" a={ca.total_agi} b={prev.summary.california.total_agi} />
              <Row label="California AGI" k="F540NR.32" a={ca.ca_agi} b={prev.summary.california.ca_agi} />
              <Row label="Total tax" k="F540NR.64" a={ca.total_tax} b={prev.summary.california.total_tax} />
              <Row label="Payments" k="F540NR.78" a={ca.payments} b={prev.summary.california.payments} />
              <tr className="total">
                <td>{ca.balance_due < 0 ? 'Overpayment (refund)' : 'Balance due'} <span className="muted small">packet value {money(ca.balance_due, { sign: true })}</span></td>
                <td className="num">{money(Math.abs(ca.balance_due))}</td><td className="num muted">{money(ca.balance_due - prev.summary.california.balance_due, { sign: true })}</td>
              </tr>
            </tbody>
          </table>
          <p className="note">These are the engine's snapshot figures, not independently verified. Open confirmed discrepancies would move federal tax by about <strong>{money(estFed, { sign: true })}</strong> (estimate from tax-effect rates).</p>
        </Section>

        <div className="stack">
          <Section title="Review status" right={<a href="#/readiness">Readiness →</a>}>
            <div className={`ready-banner r-${ready.level}`}>
              <strong>{READINESS_LABEL[ready.level]}</strong>
              {ready.blockers.length > 0 && <span> — {ready.blockers.join(' · ')}</span>}
            </div>
            <div className="kpis">
              <a href="#/queue?status=active" className="kpi"><b>{counts.open}</b><span>open / in review</span></a>
              <a href="#/queue?status=blocked" className="kpi"><b>{counts.blocked}</b><span>blocked</span></a>
              <a href="#/queue?status=awaiting_client" className="kpi"><b>{counts.awaiting}</b><span>awaiting client</span></a>
              <a href="#/queue?status=ready_for_approval" className="kpi"><b>{counts.approval}</b><span>awaiting approval</span></a>
              <a href="#/queue?status=resolved" className="kpi"><b>{counts.resolved}</b><span>resolved</span></a>
              <a href="#/checks" className="kpi"><b className={failing.length ? 'neg' : ''}>{failing.length}/{checks.length}</b><span>checks failing</span></a>
            </div>
          </Section>
          <Section title="Deadlines">
            <ul className="plain">
              {deadlines.map((d) => <li key={d.what}><span className="mono">{d.date}</span> {d.what}</li>)}
            </ul>
          </Section>
        </div>
      </div>

      <div className="grid-2">
        <Section title={`P1 issues (${top.length})`} right={<a href="#/queue">Full queue →</a>}>
          <table className="tbl">
            <tbody>
              {top.map((d) => {
                const f = caseFacts(ix, d, state);
                return (
                  <tr key={d.id} className="clickable" onClick={() => (window.location.hash = `/case/${d.id}`)}>
                    <td><Prio d={d} /></td>
                    <td><a href={`#/case/${d.id}`}>{d.title}</a><div className="muted small">{d.nextAction}</div></td>
                    <td><StatusPill s={state.cases[d.id].status} />{f.staleSignoff && <span className="pill st-blocked">stale</span>}</td>
                    <td className="num"><EffectView e={d.effect} compact /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>
        <div className="stack">
          <Section title={`Assigned to ${actor.name} (${mine.length})`}>
            {mine.length === 0 ? <p className="muted">Nothing assigned to you.</p> : (
              <ul className="plain">{mine.slice(0, 8).map((d) => <li key={d.id}><Prio d={d} /> <a href={`#/case/${d.id}`}>{d.title}</a></li>)}</ul>
            )}
          </Section>
          <Section title="Latest activity" right={<a href="#/activity">All →</a>}>
            {recent.length === 0 ? <p className="muted">No review activity recorded yet. The packet's own season history is under Activity.</p> : (
              <ul className="plain">{recent.map((e) => <li key={e.id}><span className="muted small">{fmtDate(e.at)}</span> <Person id={e.actor} /> {e.type.replace('case.', '').replace('.', ' ')} {e.payload.caseId && <a href={`#/case/${e.payload.caseId}`}>{e.payload.caseId}</a>}{e.payload.docId && <a href={`#/doc/${e.payload.docId}`}>{e.payload.docId}</a>}</li>)}</ul>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

function Row({ label, k, a, b }: { label: string; k: string; a: number; b: number }) {
  return (
    <tr>
      <td><a href={`#/line/${k}`} title={`Trace ${k}`}>{label}</a> <span className="muted small mono">{k}</span></td>
      <td className="num">{money(a)}</td>
      <td className="num muted">{a === b ? '—' : money(a - b, { sign: true })}</td>
    </tr>
  );
}
