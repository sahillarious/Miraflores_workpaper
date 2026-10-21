import { useState } from 'react';
import { useApp } from '../ui/context';
import { EffectView, Origin, Person, Prio, Section, StatusPill, fmtDate, money } from '../ui/components';
import { READINESS_LABEL, type ReadinessLevel, type Step } from '../domain/workflow';
import { workList } from '../ui/flowState';

// Home: the return's headline figures (clearly marked as unverified engine
// snapshots), readiness, and the one case to work on next.

export function Overview({ ready }: { ready: { level: ReadinessLevel; steps: Step[]; blockers: string[] } }) {
  const { ix, defs, state, actor, checks } = useApp();
  const v = ix.current;
  const prev = ix.versions[ix.versions.length - 2];
  const fed = v.summary.federal, ca = v.summary.california;
  const list = workList(ix, defs, state, actor);
  const [i, setI] = useState(0);
  const at = Math.min(i, Math.max(0, list.length - 1));
  const next = list[at];
  const resolved = defs.filter((d) => state.cases[d.id].status === 'resolved').length;
  const failing = checks.filter((c) => !c.pass).length;
  const deadlines = [...(ix.packet.firm.deadlines as { what: string; date: string }[])].sort((a, b) => a.date.localeCompare(b.date));
  const recent = [...state.events].reverse().filter((e) => e.type !== 'sensitive.view').slice(0, 5);
  const awaitingApproval = ['reviewer', 'partner'].includes(actor.role) && next && (state.cases[next.id].status === 'ready_for_approval' || state.cases[next.id].adjustments.some((a) => !a.decision));

  return (
    <div className="page home">
      <div className="page-h">
        <div>
          <h1>{ix.packet.packet.name}</h1>
          <p className="muted">Married filing jointly · moved California → Texas {ix.packet.household.residency[1].from} · signed in as {actor.name} ({actor.role})</p>
        </div>
      </div>

      <section className="next-card" aria-label="Your next case">
        {next ? (
          <>
            <div className="small muted">Your next case: {at + 1} of {list.length}{awaitingApproval ? ' · waiting for your approval' : ''}</div>
            <div className="case-tags"><Prio d={next} /> <StatusPill s={state.cases[next.id].status} /> <Origin d={next} /></div>
            <h2 className="next-title">{next.title}</h2>
            <p>{next.nextAction}</p>
            <div className="row-wrap"><span className="small muted">Estimated effect</span> <EffectView e={next.effect} /></div>
            <div className="flow-actions">
              <a className="btn primary big" href={`#/case/${next.id}`}>Open</a>
              {list.length > 1 && <button className="btn ghost" onClick={() => setI((at + 1) % list.length)}>Skip to the next one</button>}
              <a href="#/queue">See all cases ({list.length} open)</a>
            </div>
          </>
        ) : <p><strong>Every case is resolved.</strong> <a href="#/readiness">Check readiness</a>.</p>}
      </section>

      <div className="home-grid">
        <Section title="Return figures" right={<a href="#/versions">Compare versions →</a>}>
          <p className="banner warn small"><strong>Unverified.</strong> These are the tax software’s {v.version} snapshot figures ({fmtDate(v.computed_at)}), not checked numbers. Open cases may change them.</p>
          <div className="figs">
            <Fig label="Adjusted gross income" value={money(fed.agi)} href="#/line/F1040.11" />
            <Fig label={fed.balance_due >= 0 ? 'Balance due' : 'Refund'} sub="federal" value={money(Math.abs(fed.balance_due))} href="#/line/F1040.37" />
            <Fig label={ca.balance_due < 0 ? 'Overpayment (refund)' : 'Balance due'} sub={`California · packet value ${money(ca.balance_due, { sign: true })}`} value={money(Math.abs(ca.balance_due))} href="#/versions" />
          </div>
          <details className="small"><summary>All return figures</summary>
            <table className="tbl figures">
              <thead><tr><th>Federal</th><th className="num">{v.version}</th><th className="num">Δ vs {prev.version}</th></tr></thead>
              <tbody>
                <Row label="Adjusted gross income" k="F1040.11" a={fed.agi} b={prev.summary.federal.agi} />
                <Row label="Taxable income" k="F1040.15" a={fed.taxable_income} b={prev.summary.federal.taxable_income} />
                <Row label="Total tax" k="F1040.24" a={fed.total_tax} b={prev.summary.federal.total_tax} />
                <Row label="Payments" k="F1040.33" a={fed.payments} b={prev.summary.federal.payments} />
                <Row label="Estimated-tax penalty" k="F1040.38" a={fed.penalty} b={prev.summary.federal.penalty} />
              </tbody>
            </table>
            <table className="tbl figures">
              <thead><tr><th>California (540NR)</th><th className="num">{v.version}</th><th className="num">Δ vs {prev.version}</th></tr></thead>
              <tbody>
                <Row label="Total AGI (all sources)" k="F540NR.17" a={ca.total_agi} b={prev.summary.california.total_agi} />
                <Row label="California AGI" k="F540NR.32" a={ca.ca_agi} b={prev.summary.california.ca_agi} />
                <Row label="Total tax" k="F540NR.64" a={ca.total_tax} b={prev.summary.california.total_tax} />
                <Row label="Payments" k="F540NR.78" a={ca.payments} b={prev.summary.california.payments} />
              </tbody>
            </table>
          </details>
        </Section>

        <Section title="Ready to file?" right={<a href="#/readiness">Details →</a>}>
          <div className={`ready-banner r-${ready.level}`}><strong>{READINESS_LABEL[ready.level]}</strong></div>
          {ready.blockers.length > 0 && <ul className="small blockers-list">{ready.blockers.slice(0, 4).map((b) => <li key={b}>{b}</li>)}</ul>}
          <p className="small muted">{resolved} of {defs.length} cases resolved · {failing} of {checks.length} independent checks disagree with the tax software</p>
        </Section>
      </div>

      <div className="home-grid secondary">
        <Section title="Deadlines">
          <ul className="plain small">{deadlines.map((d) => <li key={d.what}><span className="mono">{d.date}</span> {d.what}</li>)}</ul>
        </Section>
        <Section title="Latest activity" right={<a href="#/activity">All →</a>}>
          {recent.length === 0 ? <p className="small muted">No review activity yet. The packet’s own season history is under Activity.</p> : (
            <ul className="plain small">{recent.map((e) => <li key={e.id}><span className="muted">{fmtDate(e.at)}</span> <Person id={e.actor} /> {e.type.replace('case.', '').replace('.', ' ')} {e.payload.caseId && <a href={`#/case/${e.payload.caseId}`}>{e.payload.caseId}</a>}{e.payload.docId && <a href={`#/doc/${e.payload.docId}`}>{e.payload.docId}</a>}</li>)}</ul>
          )}
        </Section>
      </div>
    </div>
  );
}

function Fig({ label, sub, value, href }: { label: string; sub?: string; value: string; href: string }) {
  return (
    <a className="fig" href={href}>
      <span className="fig-l">{label}</span>
      <b>{value}</b>
      {sub && <span className="small muted">{sub}</span>}
    </a>
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
