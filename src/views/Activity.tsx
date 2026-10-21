import { useRef, useState } from 'react';
import { useApp } from '../ui/context';
import { Person, Refs, Section, fmtDate } from '../ui/components';

export function Activity() {
  const { state, ix, actor, wp, toast, lastSeen, markSeen, mask } = useApp();
  const [who, setWho] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const events = [...state.events].reverse().filter((e) => !who || e.actor === who);
  const newCount = lastSeen ? state.events.filter((e) => e.at > lastSeen && e.actor !== actor.id).length : 0;
  const undoneCount = state.undone.size;

  const download = () => {
    const blob = new Blob([wp.exportLog()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `workpaper-${ix.packet.packet.client_id}-events.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="page">
      <div className="page-h">
        <div><h1>Activity</h1><p className="muted">Every workpaper change is an append-only event (actor, time, before/after). Undo adds an event; nothing is deleted. {undoneCount > 0 && `${undoneCount} event(s) undone.`}</p></div>
        <div className="row-wrap">
          <button className="btn" onClick={download}>Export log</button>
          <button className="btn ghost" onClick={() => fileRef.current?.click()}>Import log</button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={async (e) => {
            const f = e.target.files?.[0]; if (!f) return;
            try { wp.importLog(await f.text()); toast('Log imported'); } catch (err: any) { toast(err.message, 'err'); }
            e.target.value = '';
          }} />
          <button className="btn ghost" onClick={() => { if (confirm('Clear all workpaper work in this browser? Export first if you need it.')) { wp.reset(); toast('Workpaper reset to packet state'); } }}>Reset demo</button>
        </div>
      </div>

      <div className="grid-2">
        <Section title={`Workpaper events (${state.events.length})`} right={
          <span className="row-wrap">
            {newCount > 0 && <span className="pill st-awaiting_client">{newCount} new since you last looked</span>}
            <button className="btn ghost small" onClick={markSeen}>Mark all seen</button>
            <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Filter by person"><option value="">Everyone</option>{[...new Set(state.events.map((e) => e.actor))].map((a) => <option key={a} value={a}>{a}</option>)}</select>
          </span>}>
          {events.length === 0 ? <p className="muted">No workpaper activity yet. Open a case from the queue to begin.</p> : (
            <table className="tbl small">
              <thead><tr><th>When</th><th>Who</th><th>What</th><th>Item</th><th>Detail</th><th></th></tr></thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} className={lastSeen && e.at > lastSeen && e.actor !== actor.id ? 'fresh' : ''}>
                    <td>{fmtDate(e.at)}</td>
                    <td><Person id={e.actor} /> <span className="muted">({e.role})</span></td>
                    <td className="mono">{e.type}{e.batch && <span className="muted"> · batch</span>}</td>
                    <td>{e.payload.caseId && <a href={`#/case/${e.payload.caseId}`} className="mono">{e.payload.caseId}</a>}{e.payload.docId && <a href={`#/doc/${e.payload.docId}`} className="mono">{e.payload.docId}</a>}{e.type === 'sensitive.view' && <span className="mono">{e.payload.what}</span>}</td>
                    <td>{mask(detail(e.payload))}</td>
                    <td>{e.type !== 'undo' && e.type !== 'sensitive.view' && (e.actor === actor.id || actor.role === 'partner') && <button className="link small" onClick={() => { const r = wp.undo(actor, e.id); toast(r.ok ? 'Undone' : r.error, r.ok ? 'ok' : 'err'); }}>undo</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <div className="stack">
          <Section title={`Sensitive-data view log (${state.views.length})`}>
            {state.views.length === 0 ? <p className="muted small">No unmasked views. Staff without clearance cannot unmask.</p> : (
              <ul className="plain small">{state.views.map((v) => <li key={v.id}>{fmtDate(v.at)} <Person id={v.actor} /> viewed <span className="mono">{v.payload.what}</span></li>)}</ul>
            )}
          </Section>
          <Section title="Season timeline from the packet (scripted replay, not actions taken here)">
            <ol className="timeline">
              {ix.packet.timeline.map((t) => (
                <li key={t.id} id={t.id} className={t.at > ix.current.computed_at ? 'future' : ''}>
                  <span className="mono small">{t.at.slice(0, 10)}</span> <strong>{t.event.replace(/_/g, ' ')}</strong> {t.actor && <Person id={t.actor} />}
                  {t.detail && <div className="small">{mask(t.detail)}</div>}
                  {t.refs.length > 0 && <div><Refs refs={t.refs.map((r) => (r === 'qa-01' ? 'qa-01' : r))} compact /></div>}
                </li>
              ))}
            </ol>
            <p className="small muted">Events after {ix.current.version} ({ix.current.computed_at.slice(0, 10)}) are dimmed. They describe a filing that this workpaper has not performed.</p>
          </Section>
        </div>
      </div>
    </div>
  );
}

function detail(p: any): string {
  if (p.runId && p.decision) return `AI suggestion ${p.decision}${p.note ? ` — ${p.note}` : ''}`;
  if (p.runId) return `AI investigation ${p.outcome}${p.status ? ` (${p.status})` : ''}; ${p.citedIds?.length ?? 0} cited ids; validation ${p.validationPassed ? 'passed' : 'failed'}`;
  if (p.summary) return `undid ${p.summary}`;
  if (p.disposition) return `${p.disposition}${p.note ? ` — ${p.note}` : ''}`;
  if (p.lineKey) return `${p.lineKey}: ${p.from} → ${p.to} (${p.reason})`;
  if (p.outcome) return `${p.outcome}: ${String(p.rationale).slice(0, 80)}`;
  if (p.decision) return `${p.decision}${p.note ? `: ${p.note}` : ''}`;
  if (p.to && !p.text) return `→ ${p.to}${p.note ? ` (${p.note})` : ''}`;
  if (p.ref) return `${p.ref} — ${p.why ?? ''}`;
  if (p.text) return String(p.text).slice(0, 90);
  if (p.reason) return p.reason;
  if (p.status) return `${p.recId}: ${p.status} — ${p.note ?? ''}`;
  if (p.level) return `${p.level} sign-off`;
  return '';
}
