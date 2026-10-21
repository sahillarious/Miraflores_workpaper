import { useState, type ReactNode } from 'react';
import type { CaseDef, Severity } from '../domain/cases';
import type { Effect } from '../domain/effects';
import { fmtValue, refKindLabel, resolveRef } from '../domain/refs';
import { STATUS_LABEL, type CaseStatus } from '../domain/workflow';
import { useApp } from './context';

export const money = (n: number | null | undefined, opts: { sign?: boolean; cents?: boolean } = {}) => {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: opts.cents ? 2 : 0, maximumFractionDigits: opts.cents ? 2 : 0 });
  if (opts.sign) return n > 0 ? `+${s}` : n < 0 ? `−${s}` : '0';
  return n < 0 ? `(${s})` : s;
};

export const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
export const fmtDay = (iso?: string) => (iso ? iso.slice(0, 10) : '—');

export function Ref({ r, compact, version }: { r: string; compact?: boolean; version?: string }) {
  const { ix } = useApp();
  const x = resolveRef(ix, r, version);
  const lowConf = x.confidence !== undefined && x.confidence < 0.9;
  const inner = (
    <>
      <span className="ref-id">{r.length > 28 ? r.slice(0, 27) + '…' : r}</span>
      {!compact && x.value !== undefined && <span className="ref-val">{x.value}</span>}
      {lowConf && <span className="ref-conf" title="Extraction confidence">{Math.round(x.confidence! * 100)}%</span>}
    </>
  );
  const title = `${refKindLabel(x.kind)}: ${x.label}${x.detail ? ` — ${x.detail}` : ''}${x.value !== undefined ? `\n${x.value}` : ''}`;
  return x.route ? <a className={`ref ref-${x.kind}`} href={x.route} title={title}>{inner}</a> : <span className={`ref ref-${x.kind}`} title={title}>{inner}</span>;
}

export function Refs({ refs, compact, max = 99 }: { refs: string[]; compact?: boolean; max?: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? refs : refs.slice(0, max);
  return (
    <span className="refs">
      {shown.map((r) => <Ref key={r} r={r} compact={compact} />)}
      {refs.length > shown.length && <button className="link" onClick={() => setAll(true)}>+{refs.length - shown.length} more</button>}
    </span>
  );
}

export function StatusPill({ s }: { s: CaseStatus }) {
  return <span className={`pill st-${s}`}>{STATUS_LABEL[s]}</span>;
}

export function SevPill({ s }: { s: Severity }) {
  return <span className={`pill sev-${s}`}>{s}</span>;
}

export function Prio({ d }: { d: CaseDef }) {
  return <span className={`prio prio-${d.priority}`} title={`Priority score ${d.priorityScore}: ${d.priorityBasis}`}>{d.priority}</span>;
}

export function Origin({ d }: { d: CaseDef }) {
  return d.origin === 'engine'
    ? <span className="tag tag-engine" title="Raised by the tax engine (packet diagnostic)">engine · {d.ruleId}</span>
    : <span className="tag tag-wp" title="Raised by a workpaper check that does not trust the engine">workpaper · {d.ruleId}</span>;
}

export function EffectView({ e, compact }: { e?: Effect; compact?: boolean }) {
  if (!e) return <span className="muted">no estimate</span>;
  const cls = (n: number) => (n > 0 ? 'neg' : n < 0 ? 'pos' : '');
  return (
    <span className="effect" title={e.basis}>
      <span className={cls(e.federal)}>Fed {money(e.federal, { sign: true })}</span>
      <span className={cls(e.california)}>CA {money(e.california, { sign: true })}</span>
      {!compact && <span className="muted small"> est.</span>}
    </span>
  );
}

export function Person({ id }: { id?: string }) {
  const { actors } = useApp();
  const a = actors.find((x) => x.id === id);
  return <span className="person">{a ? a.name : id ?? '—'}</span>;
}

export function Section({ title, right, children, id }: { title: ReactNode; right?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="section" id={id}>
      <header className="section-h"><h3>{title}</h3>{right && <div className="section-r">{right}</div>}</header>
      <div className="section-b">{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Val({ v }: { v: unknown }) {
  return <span className="mono">{fmtValue(v)}</span>;
}

/** Sensitive values are masked; revealing requires clearance and is logged. */
export function Sensitive({ value, what }: { value: string; what: string }) {
  const { actor, run } = useApp();
  const [shown, setShown] = useState(false);
  const masked = value.replace(/[0-9](?=[0-9-]{4})/g, '•');
  if (shown) return <span className="mono">{value} <button className="link small" onClick={() => setShown(false)}>hide</button></span>;
  return (
    <span className="mono">
      {masked}{' '}
      <button className="link small" disabled={!actor.clearance} title={actor.clearance ? 'Reveal (logged)' : `${actor.name} has no sensitive-data clearance`}
        onClick={() => { if (run({ type: 'sensitive.view', payload: { what } })) setShown(true); }}>
        {actor.clearance ? 'reveal' : 'masked'}
      </button>
    </span>
  );
}
