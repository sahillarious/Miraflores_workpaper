import { useApp } from '../ui/context';
import { Person, Refs, Section, fmtDate, money } from '../ui/components';
import { READINESS_LABEL, type ReadinessLevel, type Step } from '../domain/workflow';

export function Readiness({ ready }: { ready: { level: ReadinessLevel; steps: Step[]; blockers: string[] } }) {
  const { state, run, defs } = useApp();
  const pre = ready.steps.filter((s) => !['reviewer', 'partner', 'client'].includes(s.id)).every((s) => s.done);
  const outOfScope = defs.filter((d) => d.classification === 'out_of_scope');
  return (
    <div className="page">
      <div className="page-h"><div><h1>Readiness</h1><p className="muted">Computed from case states, document dispositions and sign-offs. The firm's required steps come from the packet's starter standards.</p></div></div>
      <div className={`ready-banner big r-${ready.level}`}><strong>{READINESS_LABEL[ready.level]}</strong>{ready.blockers.length > 0 && <span> — {ready.blockers.join(' · ')}</span>}</div>
      <div className="grid-2">
        <Section title="Required steps">
          <ol className="steps">
            {ready.steps.map((s) => (
              <li key={s.id} className={s.done ? 'done' : 'todo'}>
                <span className="tick" aria-hidden>{s.done ? '✓' : '○'}</span>
                <div><strong>{s.route ? <a href={s.route}>{s.label}</a> : s.label}</strong><div className="small muted">{s.detail}</div></div>
              </li>
            ))}
          </ol>
        </Section>
        <div className="stack">
          <Section title="Engagement sign-off">
            {state.engagementSignoffs.length > 0 && <ul className="plain small">{state.engagementSignoffs.map((s, i) => <li key={i}>{s.level}: <Person id={s.by} />, {fmtDate(s.at)}</li>)}</ul>}
            <p className="small">{pre ? 'All preceding steps are complete.' : 'Engagement sign-off is available once every preceding step is complete.'}</p>
            <div className="row-wrap">
              <button className="btn" disabled={!pre} onClick={() => run({ type: 'engagement.signoff', payload: { level: 'reviewer', fingerprint: String(state.events.length) } }, 'Reviewer sign-off recorded')}>Reviewer sign-off</button>
              <button className="btn" disabled={!pre || !state.engagementSignoffs.some((s) => s.level === 'reviewer')} onClick={() => run({ type: 'engagement.signoff', payload: { level: 'partner', fingerprint: String(state.events.length) } }, 'Partner sign-off recorded')}>Partner sign-off</button>
            </div>
            <p className="small muted">This app never marks the return filed. Client approval and e-file happen outside it.</p>
          </Section>
          <Section title="Outside-the-return matters (must be acknowledged or referred)">
            <ul className="plain">{outOfScope.map((d) => <li key={d.id}><a href={`#/case/${d.id}`}>{d.title}</a> — <span className="small">{state.cases[d.id].status === 'resolved' ? 'done' : 'open'}</span></li>)}</ul>
          </Section>
        </div>
      </div>
    </div>
  );
}

export function Checks() {
  const { checks } = useApp();
  const fails = checks.filter((c) => !c.pass);
  return (
    <div className="page">
      <div className="page-h"><div><h1>Independent checks</h1><p className="muted">Recomputed from source records without trusting the engine. {fails.length} of {checks.length} disagree with the return.</p></div></div>
      <table className="tbl">
        <thead><tr><th></th><th>Check</th><th>Method</th><th className="num">A</th><th className="num">B</th><th>Case</th></tr></thead>
        <tbody>
          {checks.map((c) => (
            <tr key={c.id} className={c.pass ? '' : 'fail'}>
              <td>{c.pass ? <span className="pos">✓ agrees</span> : <span className="neg">✗ differs</span>}</td>
              <td><strong>{c.title}</strong></td>
              <td className="small">{c.method}</td>
              <td className="num"><div>{typeof c.a.value === 'number' ? money(c.a.value, { cents: !Number.isInteger(c.a.value) }) : c.a.value}</div><div className="small muted">{c.a.label}</div><Refs refs={c.a.refs.filter(Boolean)} compact max={3} /></td>
              <td className="num"><div>{typeof c.b.value === 'number' ? money(c.b.value, { cents: !Number.isInteger(c.b.value) }) : c.b.value}</div><div className="small muted">{c.b.label}</div><Refs refs={c.b.refs.filter(Boolean)} compact max={3} /></td>
              <td>{c.caseId && <a href={`#/case/${c.caseId}`} className="mono">{c.caseId}</a>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
