import { useMemo, useState } from 'react';
import { useApp } from '../ui/context';
import { useRoute, go } from '../ui/router';
import { DocPage } from '../ui/DocPage';
import { Person, Prio, Section, fmtDate, fmtDay } from '../ui/components';
import { fmtValue } from '../domain/refs';
import { relatedReturnOf } from '../ui/relatedReturns';
import { unreadPages, type PacketIndex } from '../domain/packetIndex';
import { DISPOSITION_LABEL, type Disposition } from '../domain/workflow';
import type { ExtractedValue } from '../domain/types';

/** Where a document's values landed in a version, or why they did not. */
export function landing(ix: PacketIndex, docId: string, version = ix.current.version) {
  const v = ix.versionById.get(version)!;
  const evs = ix.evsByDoc.get(docId) ?? [];
  const r2l = ix.refToLines.get(version)!;
  const used = evs.map((e) => ({ ev: e, lines: r2l.get(e.id) ?? [] }));
  const direct = r2l.get(docId) ?? [];
  const landed = used.filter((u) => u.lines.length);
  let reason = '';
  if (v.documents_superseded.includes(docId)) reason = `Superseded in ${version}: replaced by a corrected document.`;
  else if (!v.documents_used.includes(docId)) reason = `Not used by the engine in ${version}.`;
  else if (!landed.length && !direct.length) {
    const doc = ix.docs.get(docId)!;
    reason = doc.extraction.status === 'not_extracted' ? `Not extracted: ${doc.extraction.reason ?? ''}` : 'Used by the engine but no return line cites its values (informational or matched to another document).';
  }
  return { used, landed, direct, reason };
}

export function Documents() {
  const { ix, state, run, toast, wp, actor } = useApp();
  const route = useRoute();
  const [q, setQ] = useState(route.query.get('q') ?? '');
  const [disp, setDisp] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [lastBatch, setLastBatch] = useState<string | null>(null);
  const caseRefs = useCaseDocMap();

  const rows = useMemo(() => ix.packet.documents.filter((d) => {
    if (disp && state.docs[d.id].disposition !== disp) return false;
    if (q && !`${d.id} ${d.title} ${d.document_type} ${d.issuer} ${d.file_name}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [ix, state, q, disp]);

  const bulk = (value: Disposition) => {
    const cmds = [...sel].map((docId) => ({ type: 'doc.disposition' as const, payload: { docId, disposition: value, note: 'Bulk review' } }));
    const r = wp.dispatch(actor, cmds);
    if (!r.ok) { toast(r.error, 'err'); return; }
    toast(`${cmds.length} document(s) marked ${DISPOSITION_LABEL[value]}`);
    setLastBatch(r.events[0].id);
    setSel(new Set());
  };
  void run;

  const counts = ix.packet.documents.reduce<Record<string, number>>((a, d) => { const k = state.docs[d.id].disposition; a[k] = (a[k] ?? 0) + 1; return a; }, {});

  return (
    <div className="page">
      <div className="page-h">
        <div>
          <h1>Documents and evidence</h1>
          <p className="muted">{ix.packet.documents.length} documents, {ix.packet.extracted_values.length.toLocaleString()} extracted values. Each document shows where its values landed in {ix.current.version}, or why they did not.</p>
        </div>
      </div>
      <div className="chips">
        {(Object.keys(DISPOSITION_LABEL) as Disposition[]).map((k) => (
          <button key={k} className={`chip${disp === k ? ' on' : ''}`} onClick={() => setDisp(disp === k ? '' : k)}>{DISPOSITION_LABEL[k].split(' (')[0]} <b>{counts[k] ?? 0}</b></button>
        ))}
      </div>
      <div className="filters">
        <input type="search" placeholder="Search id, title, type, issuer…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search documents" />
      </div>
      {(sel.size > 0 || lastBatch) && (
        <div className="bulkbar">
          {sel.size > 0 && <><strong>{sel.size} selected</strong>
            <select value="" onChange={(e) => e.target.value && bulk(e.target.value as Disposition)} aria-label="Set disposition">
              <option value="">Set disposition…</option>
              {(Object.keys(DISPOSITION_LABEL) as Disposition[]).filter((k) => k !== 'received').map((k) => <option key={k} value={k}>{DISPOSITION_LABEL[k]}</option>)}
            </select>
            <button className="btn ghost" onClick={() => setSel(new Set())}>Clear</button></>}
          {lastBatch && <button className="btn" onClick={() => { const r = wp.undo(actor, lastBatch); if (!r.ok) toast(r.error, 'err'); else { toast('Undone'); setLastBatch(null); } }}>Undo last bulk change</button>}
        </div>
      )}
      <table className="tbl">
        <thead><tr>
          <th><input type="checkbox" aria-label="Select all" checked={rows.length > 0 && rows.every((r) => sel.has(r.id))} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} /></th>
          <th>Doc</th><th>Title</th><th>Received</th><th>Extraction</th><th>Lands on ({ix.current.version})</th><th>Disposition</th><th>Cases</th>
        </tr></thead>
        <tbody>
          {rows.map((d) => {
            const L = landing(ix, d.id);
            const lines = [...new Set([...L.landed.flatMap((u) => u.lines), ...L.direct])];
            const unread = unreadPages(ix, d.id);
            const lowc = (ix.evsByDoc.get(d.id) ?? []).filter((e) => e.confidence < 0.9).length;
            const cases = caseRefs.get(d.id) ?? [];
            return (
              <tr key={d.id} className={sel.has(d.id) ? 'selected' : ''}>
                <td><input type="checkbox" checked={sel.has(d.id)} onChange={() => setSel((s) => { const n = new Set(s); n.has(d.id) ? n.delete(d.id) : n.add(d.id); return n; })} aria-label={`Select ${d.id}`} /></td>
                <td className="mono"><a href={`#/doc/${d.id}`}>{d.id}</a></td>
                <td><a href={`#/doc/${d.id}`}>{d.title}</a>{d.marked_corrected && <span className="pill st-in_review">CORRECTED</span>}<div className="small muted">{d.document_type} · {d.issuer} · {d.belongs_to}</div></td>
                <td className="small">{fmtDay(d.received_at)}{d.received_at > ix.current.computed_at && <div className="pill st-awaiting_client">after {ix.current.version}</div>}</td>
                <td className="small">{d.extraction.status} · {d.extraction.values}{unread.length > 0 && <div className="neg">pages not read: {unread.join(', ')}</div>}{lowc > 0 && <div className="neg">{lowc} low-confidence</div>}</td>
                <td className="small">{lines.length ? <>{lines.slice(0, 3).map((k) => <a key={k} href={`#/line/${encodeURIComponent(k)}`} className="mono">{k} </a>)}{lines.length > 3 && <span className="muted">+{lines.length - 3}</span>}</> : <span className="muted">{L.reason}</span>}</td>
                <td className="small">{DISPOSITION_LABEL[state.docs[d.id].disposition].split(' (')[0]}</td>
                <td className="small">{cases.map((c) => <a key={c} href={`#/case/${c}`} className="mono">{c} </a>)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function useCaseDocMap() {
  const { defs, ix } = useApp();
  return useMemo(() => {
    const m = new Map<string, string[]>();
    for (const d of defs) {
      const docIds = new Set<string>();
      for (const r of d.refs) {
        if (/^D\d\d$/.test(r)) docIds.add(r);
        else if (r.startsWith('ev-')) { const e = ix.evs.get(r); if (e) docIds.add(e.document_id); }
        else if (r.startsWith('doc:')) docIds.add(r.slice(4, 7));
      }
      for (const id of docIds) m.set(id, [...(m.get(id) ?? []), d.id]);
    }
    return m;
  }, [defs, ix]);
}

export function DocumentView({ id }: { id: string }) {
  const { ix, state, run, defs, defsById, mask } = useApp();
  const route = useRoute();
  const doc = ix.docs.get(id);
  const focusEv = route.query.get('ev') ?? undefined;
  const ev0 = focusEv ? ix.evs.get(focusEv) : undefined;
  const [disp, setDisp] = useState<Disposition>('reviewed');
  const [note, setNote] = useState('');
  const caseMap = useCaseDocMap();
  if (!doc) return <div className="page"><h1>Document not found</h1></div>;
  const curPage = ev0?.page ?? Number(route.query.get('page') ?? 1);
  const L = landing(ix, id);
  const rr = relatedReturnOf(ix, defs, id);
  const ds = state.docs[id];
  const pageEvs = (ix.evsByDoc.get(id) ?? []);
  const unread = unreadPages(ix, id);
  const pick = (e: ExtractedValue) => go(`#/doc/${id}?ev=${e.id}`);
  const cases = caseMap.get(id) ?? [];
  const showEvs = pageEvs.length > 60 ? pageEvs.filter((e) => e.page === curPage) : pageEvs;

  return (
    <div className="page">
      <div className="crumbs"><a href="#/docs">Documents</a> / <span className="mono">{id}</span></div>
      <div className="page-h">
        <div>
          <h1>{doc.title}</h1>
          <p className="muted">{doc.document_type} · issuer {doc.issuer} · belongs to {doc.belongs_to} · tax year {doc.tax_year} · received {fmtDate(doc.received_at)} (uploaded by {doc.uploaded_by}) · {doc.file_name}</p>
          {rr && <p className="small">Part of a related return: <a href={`#/related?focus=${rr.key}`}>{rr.who}</a>, prepared by {rr.preparedBy}.</p>}
        </div>
      </div>
      <div className="doc-layout">
        <div>
          <div className="pager">
            {doc.pages.map((p) => (
              <button key={p.page} className={`pg${p.page === curPage ? ' on' : ''}${unread.includes(p.page) ? ' unread' : ''}`} onClick={() => go(`#/doc/${id}?page=${p.page}`)} title={unread.includes(p.page) ? 'Has amounts but was not extracted' : ''}>{p.page}</button>
            ))}
          </div>
          <DocPage doc={doc} page={curPage} focusEv={focusEv} onPick={pick} />
          {unread.includes(curPage) && <div className="banner warn">This page prints amounts but the pipeline extracted nothing from it (extraction: {doc.extraction.status}{doc.extraction.reason ? ` — ${doc.extraction.reason}` : ''}).</div>}
        </div>
        <div className="stack">
          <Section title="Disposition">
            <p><strong>{DISPOSITION_LABEL[ds.disposition]}</strong>{ds.by && <span className="small muted"> — <Person id={ds.by} />, {fmtDate(ds.at)}{ds.note ? `: ${ds.note}` : ''}</span>}</p>
            <div className="inline-form">
              <select value={disp} onChange={(e) => setDisp(e.target.value as Disposition)} aria-label="Disposition">
                {(Object.keys(DISPOSITION_LABEL) as Disposition[]).filter((k) => k !== 'received').map((k) => <option key={k} value={k}>{DISPOSITION_LABEL[k]}</option>)}
              </select>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (e.g. duplicate of D09)" aria-label="Disposition note" />
              <button className="btn" onClick={() => { if (run({ type: 'doc.disposition', payload: { docId: id, disposition: disp, note } }, 'Disposition recorded')) setNote(''); }}>Save</button>
            </div>
            {ds.history.length > 0 && <ul className="plain small">{ds.history.map((e) => <li key={e.id}>{fmtDate(e.at)} <Person id={e.actor} /> → {DISPOSITION_LABEL[e.payload.disposition as Disposition].split(' (')[0]} {e.payload.note}</li>)}</ul>}
          </Section>
          <Section title={`Where it landed (${ix.current.version})`}>
            {L.reason && <p className="muted">{L.reason}</p>}
            {L.direct.length > 0 && <p className="small">Cited as a whole by: {L.direct.map((k) => <a key={k} href={`#/line/${encodeURIComponent(k)}`} className="mono">{k} </a>)}</p>}
            <table className="tbl small">
              <thead><tr><th>Value</th><th>Read</th><th>Conf.</th><th>Return lines</th></tr></thead>
              <tbody>
                {showEvs.map(({ id: evId }) => {
                  const u = L.used.find((x) => x.ev.id === evId)!;
                  return (
                    <tr key={evId} className={evId === focusEv ? 'selected' : ''}>
                      <td><a href={`#/doc/${id}?ev=${evId}`} className="mono">{evId}</a> <span className="muted">p{u.ev.page}</span> {u.ev.label}</td>
                      <td className="mono">{mask(fmtValue(u.ev.value))}</td>
                      <td className={u.ev.confidence < 0.9 ? 'neg' : ''}>{u.ev.confidence}</td>
                      <td>{u.lines.length ? u.lines.map((k) => <a key={k} href={`#/line/${encodeURIComponent(k)}`} className="mono">{k} </a>) : <span className="muted">not used</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {pageEvs.length > 60 && <p className="small muted">Showing values on page {curPage} ({showEvs.length} of {pageEvs.length}).</p>}
          </Section>
          <Section title="Version history">
            <ul className="plain small">
              {ix.versions.map((v) => <li key={v.version}><strong>{v.version}</strong>: {v.documents_superseded.includes(id) ? 'superseded' : v.documents_used.includes(id) ? 'used' : 'not used'}</li>)}
            </ul>
          </Section>
          {cases.length > 0 && (
            <Section title="Review cases citing this document">
              <ul className="plain">{cases.map((c) => <li key={c}><Prio d={defsById.get(c)!} /> <a href={`#/case/${c}`}>{defsById.get(c)!.title}</a></li>)}</ul>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
