import { useEffect, useMemo, useRef } from 'react';
import type { ExtractedValue, PacketDocument } from '../domain/types';
import { fmtValue } from '../domain/refs';
import { useApp } from './context';

// Source renderer. Today it renders a *simulated* page from the packet's
// printed_content and highlights each extracted value where its text appears.
// The contract is (document, page, extracted values, focused value id): a real
// PDF renderer would take the same inputs and draw ev.position boxes instead.

export interface SourceRendererProps { doc: PacketDocument; page: number; focusEv?: string; onPick?: (ev: ExtractedValue) => void; compact?: boolean }

interface Span { start: number; end: number; ev: ExtractedValue }

function locate(text: string, evs: ExtractedValue[]): Span[] {
  const spans: Span[] = [];
  const taken = (s: number, e: number) => spans.some((x) => s < x.end && e > x.start);
  const ordered = [...evs].sort((a, b) => a.position.y0 - b.position.y0 || a.position.x0 - b.position.x0);
  let cursor = 0;
  for (const ev of ordered) {
    const cands = new Set<string>();
    if (ev.text_as_read) cands.add(ev.text_as_read);
    if (typeof ev.value === 'number') {
      cands.add(ev.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
      cands.add(ev.value.toLocaleString('en-US'));
      if (ev.value_type === 'percent') cands.add(`${Math.round(ev.value * 100)}%`);
    }
    if (ev.value_type === 'date' && typeof ev.value === 'string') {
      const [y, m, d] = ev.value.split('-');
      cands.add(ev.value); cands.add(`${m}/${d}/${y}`);
    }
    let placed = false;
    for (const c of [...cands].filter(Boolean).sort((a, b) => b.length - a.length)) {
      for (const from of [cursor, 0]) {
        let i = text.indexOf(c, from);
        while (i >= 0 && taken(i, i + c.length)) i = text.indexOf(c, i + 1);
        if (i >= 0) { spans.push({ start: i, end: i + c.length, ev }); cursor = i + c.length; placed = true; break; }
      }
      if (placed) break;
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

export function DocPage({ doc, page, focusEv, onPick, compact }: SourceRendererProps) {
  const { ix } = useApp();
  const p = doc.pages.find((x) => x.page === page);
  const evs = useMemo(() => (ix.evsByDoc.get(doc.id) ?? []).filter((e) => e.page === page), [ix, doc.id, page]);
  const spans = useMemo(() => (p ? locate(p.printed_content, evs) : []), [p, evs]);
  const unplaced = evs.filter((e) => !spans.some((s) => s.ev.id === e.id));
  const focusRef = useRef<HTMLElement | null>(null);
  useEffect(() => { focusRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, [focusEv, page]);
  if (!p) return <div className="empty">Page {page} not in document.</div>;

  const parts: JSX.Element[] = [];
  let at = 0;
  spans.forEach((s, i) => {
    if (s.start > at) parts.push(<span key={`t${i}`}>{p.printed_content.slice(at, s.start)}</span>);
    const focus = s.ev.id === focusEv;
    const low = s.ev.confidence < 0.9;
    parts.push(
      <mark key={s.ev.id} ref={focus ? (el) => { focusRef.current = el; } : undefined}
        className={`hl${focus ? ' focus' : ''}${low ? ' low' : ''}`}
        title={`${s.ev.id} · ${s.ev.label} = ${fmtValue(s.ev.value)} (confidence ${s.ev.confidence})`}
        onClick={() => onPick?.(s.ev)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onPick?.(s.ev); }}>
        {p.printed_content.slice(s.start, s.end)}
      </mark>,
    );
    at = s.end;
  });
  if (at < p.printed_content.length) parts.push(<span key="tail">{p.printed_content.slice(at)}</span>);

  const focused = evs.find((e) => e.id === focusEv);
  return (
    <div className={`paper${compact ? ' compact' : ''}`}>
      <div className="paper-h">
        <span><strong>{doc.id}</strong> · {doc.file_name}</span>
        <span className="muted">page {page} of {doc.page_count} · simulated from printed_content</span>
      </div>
      <div className="paper-body">{parts}</div>
      {focused && (
        <div className="paper-loc small">
          Field <strong>{focused.field}</strong> ({focused.label}) · read “{focused.text_as_read || '(nothing printed)'}” → <strong>{fmtValue(focused.value)}</strong> · confidence {focused.confidence} ·
          position (synthetic) x {focused.position.x0.toFixed(2)}–{focused.position.x1.toFixed(2)}, y {focused.position.y0.toFixed(2)}–{focused.position.y1.toFixed(2)}
          {!spans.some((s) => s.ev.id === focused.id) && <span className="neg"> · not found in printed text</span>}
        </div>
      )}
      {!compact && unplaced.length > 0 && (
        <div className="paper-loc small neg">Not located on this page: {unplaced.map((e) => `${e.id} (${e.label} = ${fmtValue(e.value)})`).join('; ')}</div>
      )}
    </div>
  );
}
