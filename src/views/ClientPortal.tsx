import { useState } from 'react';
import { useApp } from '../ui/context';

// What a client sees: only questions sent to them and their own answers.
// Deliberately built from plain markup, not the staff components, and it
// renders no rationale, notes, adjustments or evidence. This is a UI
// separation only: the whole event log lives in the same browser storage.

const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export function ClientPortal() {
  const { defs, state, actor, actors, run, mask } = useApp();
  const [text, setText] = useState<Record<string, string>>({});
  const items = defs.flatMap((d) => state.cases[d.id].questions.filter((q) => q.to === 'client').map((q) => ({ caseId: d.id, q })));
  const open = items.filter((x) => !x.q.answer);
  const done = items.filter((x) => x.q.answer);
  const asker = (id: string) => actors.find((a) => a.id === id)?.name ?? 'Your preparer';

  return (
    <div className="portal-shell">
      <h1>Hello {actor.name.split(' ')[0]}</h1>
      <p className="muted">Your preparer has {open.length} question{open.length === 1 ? '' : 's'} for you. Your answers are saved to your tax file exactly as you write them.</p>
      {open.length === 0 && <div className="empty">No questions waiting. Switch back to a staff role to continue the review.</div>}
      {open.map(({ caseId, q }) => (
        <div key={q.id} className="portal-card">
          <h2>{mask(q.text)}</h2>
          <p className="small muted">Asked by {asker(q.by)} on {day(q.at)}{q.expected ? ` · please include: ${q.expected}` : ''}</p>
          <textarea rows={3} value={text[q.id] ?? ''} onChange={(e) => setText({ ...text, [q.id]: e.target.value })} aria-label="Your answer" />
          <button className="btn primary" disabled={!(text[q.id] ?? '').trim()} onClick={() => run({ type: 'case.answer', payload: { caseId, qid: q.id, text: text[q.id] } }, 'Thank you — answer sent')}>Send answer</button>
        </div>
      ))}
      {done.length > 0 && (
        <>
          <h2 className="portal-h">Answered</h2>
          {done.map(({ q }) => (
            <div key={q.id} className="portal-card portal-done">
              <strong>{mask(q.text)}</strong>
              <p>{mask(q.answer!.text)}</p>
              <div className="small muted">Sent {day(q.answer!.at)}</div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
