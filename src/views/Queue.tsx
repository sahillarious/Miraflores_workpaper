import { useMemo, useState } from 'react';
import { useApp } from '../ui/context';
import { useRoute } from '../ui/router';
import { EffectView, Origin, Person, Prio, StatusPill } from '../ui/components';
import { plural, priorityLevel } from '../ui/labels';
import { allowedTransitions, caseFacts, STATUS_LABEL, type CaseStatus } from '../domain/workflow';
import { absEffect } from '../domain/effects';
import type { CaseDef } from '../domain/cases';

type Sort = 'priority' | 'effect' | 'recent' | 'status';

export function Queue() {
  const { ix, defs, state, actors, actor, toast, wp, lastSeen } = useApp();
  const route = useRoute();
  const q0 = route.query;
  const [q, setQ] = useState(q0.get('q') ?? '');
  const [status, setStatus] = useState(q0.get('status') ?? 'unresolved');
  const [area, setArea] = useState(q0.get('area') ?? '');
  const [origin, setOrigin] = useState(q0.get('origin') ?? '');
  const [owner, setOwner] = useState('');
  const [juris, setJuris] = useState('');
  const [prio, setPrio] = useState('');
  const [sort, setSort] = useState<Sort>('priority');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [lastBatch, setLastBatch] = useState<string | null>(null);

  const areas = [...new Set(defs.map((d) => d.area))].sort();
  const staff = actors.filter((a) => ['preparer', 'reviewer', 'partner'].includes(a.role));

  const text = (d: CaseDef) => [d.id, d.title, d.ruleId, d.why, d.nextAction, ...d.refs, ...d.lines].join(' ').toLowerCase();
  const rows = useMemo(() => {
    let r = defs.filter((d) => {
      const s = state.cases[d.id].status;
      if (status === 'unresolved' && s === 'resolved') return false;
      if (status === 'active' && !['open', 'in_review', 'reopened'].includes(s)) return false;
      if (!['unresolved', 'active', 'all', ''].includes(status) && s !== status) return false;
      if (area && d.area !== area) return false;
      if (origin && d.origin !== origin) return false;
      if (owner && state.cases[d.id].owner !== owner) return false;
      if (juris && d.jurisdiction !== juris && d.jurisdiction !== 'both') return false;
      if (prio && priorityLevel(d) !== prio) return false;
      if (q && !q.toLowerCase().split(/\s+/).every((t) => text(d).includes(t))) return false;
      return true;
    });
    const order: CaseStatus[] = ['blocked', 'reopened', 'open', 'in_review', 'awaiting_client', 'ready_for_approval', 'resolved'];
    r = [...r].sort((a, b) => {
      if (sort === 'effect') return absEffect(b.effect) - absEffect(a.effect);
      if (sort === 'recent') return (state.cases[b.id].lastChange ?? '').localeCompare(state.cases[a.id].lastChange ?? '');
      if (sort === 'status') return order.indexOf(state.cases[a.id].status) - order.indexOf(state.cases[b.id].status);
      return b.priorityScore - a.priorityScore;
    });
    return r;
  }, [defs, state, status, area, origin, owner, juris, prio, q, sort]);

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSel = rows.length > 0 && rows.every((r) => sel.has(r.id));

  const bulk = (kind: 'assign' | 'status', value: string) => {
    if (!value || !sel.size) return;
    const cmds = [...sel].map((caseId) => kind === 'assign'
      ? { type: 'case.assign' as const, payload: { caseId, to: value } }
      : { type: 'case.status' as const, payload: { caseId, to: value, note: 'Bulk update' } });
    const r = wp.dispatch(actor, cmds);
    if (!r.ok) { toast(r.error, 'err'); return; }
    toast(`${cmds.length} case(s) updated`);
    setLastBatch(r.events[0].id);
    setSel(new Set());
  };

  const commonTransitions = useMemo(() => {
    const ss = [...sel].map((id) => allowedTransitions(state.cases[id]?.status ?? 'open'));
    if (!ss.length) return [];
    return ss.reduce((a, b) => a.filter((x) => b.includes(x)));
  }, [sel, state]);

  return (
    <div className="page">
      <div className="page-h">
        <div>
          <h1>Review queue</h1>
          <p className="muted">{rows.length} of {defs.length} cases. Default order is priority (severity, estimated tax effect, contradiction or missing evidence); hover a priority for its basis.</p>
        </div>
      </div>

      <div className="filters">
        <input type="search" placeholder="Search title, code, D##, ev-####, line…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search cases" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="unresolved">All unresolved</option>
          <option value="active">Open / in review</option>
          {(Object.keys(STATUS_LABEL) as CaseStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          <option value="all">All</option>
        </select>
        <select value={prio} onChange={(e) => setPrio(e.target.value)} aria-label="Priority"><option value="">Any priority</option><option>Blocker</option><option>High</option><option>Medium</option><option>Low</option></select>
        <select value={area} onChange={(e) => setArea(e.target.value)} aria-label="Area"><option value="">All areas</option>{areas.map((a) => <option key={a}>{a}</option>)}</select>
        <select value={origin} onChange={(e) => setOrigin(e.target.value)} aria-label="Origin"><option value="">Any source</option><option value="engine">Raised by the tax software</option><option value="workpaper">Found by our checks</option></select>
        <select value={juris} onChange={(e) => setJuris(e.target.value)} aria-label="Jurisdiction"><option value="">Any jurisdiction</option><option value="federal">Federal</option><option value="california">California</option><option value="none">Outside return</option></select>
        <select value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Owner"><option value="">Any owner</option>{staff.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort"><option value="priority">Sort: priority</option><option value="effect">Sort: tax effect</option><option value="recent">Sort: recently changed</option><option value="status">Sort: status</option></select>
      </div>

      {(sel.size > 0 || lastBatch) && (
        <div className="bulkbar">
          {sel.size > 0 && <>
            <strong>{sel.size} selected</strong>
            <select value="" onChange={(e) => bulk('assign', e.target.value)} aria-label="Assign selected"><option value="">Assign to…</option>{staff.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
            <select value="" onChange={(e) => bulk('status', e.target.value)} aria-label="Move selected" disabled={!commonTransitions.length}>
              <option value="">{commonTransitions.length ? 'Move to…' : 'No common transition'}</option>
              {commonTransitions.filter((t) => t !== 'blocked').map((t) => <option key={t} value={t}>{STATUS_LABEL[t]}</option>)}
            </select>
            <button className="btn ghost" onClick={() => setSel(new Set())}>Clear</button>
          </>}
          {lastBatch && <button className="btn" onClick={() => { const r = wp.undo(actor, lastBatch); if (!r.ok) toast(r.error, 'err'); else { toast('Bulk change undone'); setLastBatch(null); } }}>Undo last bulk change</button>}
        </div>
      )}

      <table className="tbl queue">
        <thead>
          <tr>
            <th><input type="checkbox" checked={allSel} onChange={() => setSel(allSel ? new Set() : new Set(rows.map((r) => r.id)))} aria-label="Select all" /></th>
            <th>Priority</th><th>Issue · why it matters · next action</th><th>Records</th><th>Status</th><th>Owner</th><th className="num">Est. tax effect</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => {
            const cs = state.cases[d.id];
            const f = caseFacts(ix, d, state);
            const changed = lastSeen && cs.lastChange && cs.lastChange > lastSeen && cs.history.at(-1)?.actor !== actor.id;
            return (
              <tr key={d.id} className={sel.has(d.id) ? 'selected' : ''}>
                <td><input type="checkbox" checked={sel.has(d.id)} onChange={() => toggle(d.id)} aria-label={`Select ${d.id}`} /></td>
                <td><Prio d={d} /></td>
                <td className="issue">
                  <a href={`#/case/${d.id}`} className="issue-title">{changed && <span className="dot" title="Changed since you last looked" />}{d.title}</a>
                  <div className="small">{d.matters || d.why}</div>
                  <div className="small next">Next: {d.nextAction}</div>
                  <div className="small muted"><Origin d={d} /> · {d.area} · {d.classification.replace(/_/g, ' ')}</div>
                </td>
                <td className="small" title={d.refs.join(', ')}>{plural(d.refs.length, 'record')}{d.reconciliations.length > 0 && <div>{plural(d.reconciliations.length, 'evidence check')}</div>}</td>
                <td>
                  <StatusPill s={cs.status} />
                  {f.staleSignoff && <div><span className="pill st-blocked">sign-off stale</span></div>}
                  {f.blockingNotes.length > 0 && <div className="small neg">{f.blockingNotes.length} review note(s)</div>}
                  {f.openQuestions.length > 0 && <div className="small">{f.openQuestions.length} open question(s)</div>}
                  {f.pendingAdjustments.length > 0 && <div className="small">adjustment pending</div>}
                </td>
                <td className="small"><Person id={cs.owner} /></td>
                <td className="num"><EffectView e={d.effect} compact /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && <div className="empty">No cases match these filters.</div>}
    </div>
  );
}
