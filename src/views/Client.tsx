import { useApp } from '../ui/context';
import { useRoute } from '../ui/router';
import { Section, Sensitive, fmtDate } from '../ui/components';

/** Staff view of everything the client told us, kept verbatim. */
export function ClientRecords() {
  const { ix, defs } = useApp();
  const route = useRoute();
  const focus = route.query.get('focus');
  const hh = ix.packet.household;
  const citedBy = (id: string) => defs.filter((d) => d.refs.includes(id) || d.facts.some((f) => f.refs.includes(id)) || d.conflicts.some((f) => f.refs.includes(id)));
  return (
    <div className="page">
      <div className="page-h"><div><h1>Client records</h1><p className="muted">Questionnaire answers, messages and call notes as received. Later answers are recorded alongside them; the originals are never edited.</p></div></div>
      <Section title="Household (as entered by the client)">
        <table className="tbl small">
          <thead><tr><th>Person</th><th>Role</th><th>SSN</th><th>DOB</th><th>Notes</th></tr></thead>
          <tbody>{hh.people.map((p: any) => (
            <tr key={p.id}><td>{p.name}</td><td>{p.role}{p.relationship ? ` (${p.relationship})` : ''}</td><td><Sensitive value={p.ssn} what={`household:${p.id}.ssn`} /></td><td>{p.dob}</td><td>{p.note ?? p.occupation ?? ''}{p.ip_pin && <> · IP PIN <Sensitive value={p.ip_pin} what={`household:${p.id}.ip_pin`} /></>}</td></tr>
          ))}</tbody>
        </table>
        <p className="small">Residency: {hh.residency.map((r: any) => `${r.state} ${r.from} to ${r.to}`).join('; ')} · Refund account <Sensitive value={hh.bank_account_for_refund_or_payment.account} what="household:bank_account" /> ({hh.bank_account_for_refund_or_payment.bank})</p>
        <p className="small">Related returns: {hh.related_returns.map((r: any) => r.who).join(' · ')}. <a href="#/related">See what each one touches →</a></p>
      </Section>
      <div className="grid-2">
        <Section title={`Questionnaire (${ix.packet.client.questionnaire.length})`}>
          <ul className="qa">{ix.packet.client.questionnaire.map((q) => {
            const cases = citedBy(q.id);
            return (
              <li key={q.id} id={q.id} className={focus === q.id ? 'focus' : ''}>
                <span className="mono small">{q.id}</span> <strong>{q.question}</strong>
                <div>{q.answer}</div>
                <div className="small muted">{q.answered_by}, {q.answered_at.slice(0, 10)}{cases.length > 0 && <> · cited by {cases.map((c) => <a key={c.id} href={`#/case/${c.id}`} className="mono">{c.id} </a>)}</>}</div>
              </li>
            );
          })}</ul>
        </Section>
        <div className="stack">
          <Section title="Messages">
            <ul className="qa">{ix.packet.client.messages.map((m) => (
              <li key={m.id} id={m.id} className={focus === m.id ? 'focus' : ''}><span className="mono small">{m.id}</span> <span className="small muted">{fmtDate(m.sent_at)} · {m.from}</span><div>{m.text}</div>
                {citedBy(m.id).length > 0 && <div className="small muted">cited by {citedBy(m.id).map((c) => <a key={c.id} href={`#/case/${c.id}`} className="mono">{c.id} </a>)}</div>}</li>
            ))}</ul>
          </Section>
          <Section title="Call notes">
            {ix.packet.client.call_notes.map((c) => (
              <div key={c.id} id={c.id} className={focus === c.id ? 'focus' : ''}><span className="mono small">{c.id}</span> <span className="small muted">{fmtDate(c.date)} · {c.participants.join(', ')}</span><ul>{c.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></div>
            ))}
          </Section>
        </div>
      </div>
    </div>
  );
}
