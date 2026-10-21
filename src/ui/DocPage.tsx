import { useEffect, useMemo, useRef, useState } from 'react';
import type { ExtractedValue, PacketDocument } from '../domain/types';
import { fmtValue } from '../domain/refs';
import { useApp } from './context';

// Source renderer. Today it renders a *simulated* page from the packet's
// printed_content and highlights each extracted value where its text appears.
// The contract is (document, page, extracted values, focused value id): a real
// PDF renderer would take the same inputs and draw ev.position boxes instead.

export interface SourceRendererProps { doc: PacketDocument; page: number; focusEv?: string; onPick?: (ev: ExtractedValue) => void; compact?: boolean;
  /** Guided flow: highlight only the focused value and scroll inside the page box, never the window. */
  focusOnly?: boolean }

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

export function DocPage({ doc, page, focusEv, onPick, compact, focusOnly }: SourceRendererProps) {
  const { ix, mask, actor, run } = useApp();
  const p = doc.pages.find((x) => x.page === page);
  // Identifiers on the page are masked until someone with clearance reveals them (logged as sensitive.view).
  const [revealed, setRevealed] = useState(false);
  useEffect(() => { setRevealed(false); }, [doc.id, page]);
  const show = (s: string) => (revealed ? s : mask(s));
  const evs = useMemo(() => (ix.evsByDoc.get(doc.id) ?? []).filter((e) => e.page === page), [ix, doc.id, page]);
  const spans = useMemo(() => (p ? locate(p.printed_content, evs) : []), [p, evs]);
  const unplaced = evs.filter((e) => !spans.some((s) => s.ev.id === e.id));
  const focusRef = useRef<HTMLElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = focusRef.current, body = bodyRef.current;
    if (!el) return;
    if (focusOnly && body) { body.scrollTop = Math.max(0, el.offsetTop - body.clientHeight / 2); return; }
    el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [focusEv, page, focusOnly]);
  if (!p) return <div className="empty">Page {page} not in document.</div>;

  const parts: JSX.Element[] = [];
  let at = 0;
  spans.forEach((s, i) => {
    if (s.start > at) parts.push(<span key={`t${i}`}>{show(p.printed_content.slice(at, s.start))}</span>);
    const focus = s.ev.id === focusEv;
    const low = s.ev.confidence < 0.9;
    parts.push(
      <mark key={s.ev.id} ref={focus ? (el) => { focusRef.current = el; } : undefined}
        className={`hl${focus ? ' focus' : ''}${low ? ' low' : ''}`}
        title={`${s.ev.id} · ${s.ev.label} = ${show(fmtValue(s.ev.value))} (confidence ${s.ev.confidence})`}
        onClick={() => onPick?.(s.ev)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onPick?.(s.ev); }}>
        {show(p.printed_content.slice(s.start, s.end))}
      </mark>,
    );
    at = s.end;
  });
  if (at < p.printed_content.length) parts.push(<span key="tail">{show(p.printed_content.slice(at))}</span>);
  const hasIdentifiers = mask(p.printed_content) !== p.printed_content;
  const reveal = () => { if (run({ type: 'sensitive.view', payload: { what: `doc:${doc.id}#page${page}` } }, 'Identifiers shown (logged)')) setRevealed(true); };

  const focused = evs.find((e) => e.id === focusEv);
  return (
    <div className={`paper${compact ? ' compact' : ''}${focusOnly ? ' focus-only' : ''}`}>
      <div className="paper-h">
        <span><strong>{doc.id}</strong> · {doc.file_name}</span>
        <span className="muted">page {page} of {doc.page_count} · simulated from printed_content</span>
        {hasIdentifiers && actor.role !== 'client' && (
          revealed
            ? <button className="link small" onClick={() => setRevealed(false)}>Hide identifiers</button>
            : <button className="link small" disabled={!actor.clearance} onClick={reveal} title={actor.clearance ? 'Reveal SSNs and account numbers on this page (logged)' : `${actor.name} has no sensitive-data clearance`}>
                {actor.clearance ? 'Show identifiers (logged)' : 'Identifiers masked'}
              </button>
        )}
      </div>
      <div className="paper-body" ref={bodyRef}>{parts}</div>
      {focused && (
        <div className="paper-loc small">
          Field <strong>{focused.field}</strong> ({focused.label}) · read “{focused.text_as_read ? show(focused.text_as_read) : '(nothing printed)'}” → <strong>{show(fmtValue(focused.value))}</strong> · confidence {focused.confidence} ·
          position (synthetic) x {focused.position.x0.toFixed(2)}–{focused.position.x1.toFixed(2)}, y {focused.position.y0.toFixed(2)}–{focused.position.y1.toFixed(2)}
          {!spans.some((s) => s.ev.id === focused.id) && <span className="neg"> · not found in printed text</span>}
        </div>
      )}
      {!compact && unplaced.length > 0 && (
        <div className="paper-loc small neg">Not located on this page: {unplaced.map((e) => `${e.id} (${e.label} = ${show(fmtValue(e.value))})`).join('; ')}</div>
      )}
    </div>
  );
}
