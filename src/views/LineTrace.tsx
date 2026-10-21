import { useState } from 'react';
import { useApp } from '../ui/context';
import { useRoute } from '../ui/router';
import { Person, Prio, Ref, Section, StatusPill, fmtDate, money } from '../ui/components';
import { line } from '../domain/packetIndex';
import { resolveRef } from '../domain/refs';

const fmtV = (v: unknown) => (typeof v === 'number' ? money(v, { cents: !Number.isInteger(v) }) : v === undefined ? '—' : String(v));

export function LineTrace({ k }: { k: string }) {
  const { ix, defs, state, mask } = useApp();
  const route = useRoute();
  const version = route.query.get('v') ?? ix.current.version;
  const l = line(ix, k, version);
  if (!l) {
    return (
      <div className="page">
        <div className="crumbs"><a href="#/versions">Return</a> / <span className="mono">{k}</span></div>
        <h1>{k}</h1>
        <p>This line is not in {version}. {ix.versions.filter((v) => line(ix, k, v.version)).map((v) => <a key={v.version} href={`#/line/${encodeURIComponent(k)}?v=${v.version}`}>Open in {v.version} </a>)}</p>
      </div>
    );
  }
  const deps = ix.dependents.get(version)!.get(k) ?? [];
  const cases = defs.filter((d) => d.lines.includes(k) || d.refs.includes(k));
  const adjs = defs.flatMap((d) => state.cases[d.id].adjustments.filter((a) => a.lineKey === k).map((a) => ({ a, d })));
  const py = ix.packet.prior_years.return_2024.lines[k];
  const rule = ix.packet.engine_reference.rules[l.rule];

  return (
    <div className="page">
      <div className="crumbs"><a href="#/versions">Return</a> / {l.form} / <span className="mono">{k}</span></div>
      <div className="page-h">
        <div>
          <h1><span className="mono">{k}</span> · {l.label}</h1>
          <p className="muted">{l.jurisdiction} · form {l.form} line {l.line} · rule <span className="mono">{l.rule}</span></p>
        </div>
        <div className="bigval">{fmtV(l.value)}<div className="small muted">{version}</div></div>
      </div>

      <div className="grid-2">
        <div className="stack">
          <Section title="How it was built">
            {rule && <p><strong>{l.rule}:</strong> {rule}</p>}
            {l.note && <p className="note">{l.note}</p>}
            {l.inputs.length > 0 ? <InputTree k={k} version={version} depth={0} /> : <p className="muted small">No input lines: this value comes straight from its sources.</p>}
          </Section>
          <Section title={`Sources (${l.sources.length})`}>
            {l.sources.length === 0 ? <p className="muted small">No direct sources: computed from inputs.</p> : (
              <table className="tbl small">
                <tbody>{l.sources.map((s) => {
                  const r = resolveRef(ix, s, version);
                  return (
                    <tr key={s}>
                      <td><Ref r={s} compact /></td>
                      <td>{mask(r.label.replace(`${s} · `, ''))}{r.detail && <div className="muted">{mask(r.detail)}</div>}</td>
                      <td className="num mono">{typeof r.value === 'string' ? mask(r.value) : r.value}</td>
                      <td className={r.confidence !== undefined && r.confidence < 0.9 ? 'neg' : 'muted'}>{r.confidence ?? ''}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            )}
          </Section>
        </div>
        <div className="stack">
          <Section title="Across versions and years">
            <table className="tbl small">
              <thead><tr><th>2024 filed</th>{ix.versions.map((v) => <th key={v.version} className="num">{v.version}</th>)}</tr></thead>
              <tbody><tr><td className="num">{py !== undefined ? fmtV(py) : '—'}</td>{ix.versions.map((v) => <td key={v.version} className="num">{fmtV(line(ix, k, v.version)?.value)}</td>)}</tr></tbody>
            </table>
            {ix.versions.map((v) => v.changes_from_previous.find((c) => c.key === k) && <p key={v.version} className="small">Changed in {v.version}: {v.trigger}</p>)}
          </Section>
          {cases.length > 0 && (
            <Section title="Review cases on this line">
              <ul className="plain">{cases.map((d) => <li key={d.id}><Prio d={d} /> <StatusPill s={state.cases[d.id].status} /> <a href={`#/case/${d.id}`}>{d.title}</a></li>)}</ul>
            </Section>
          )}
          {adjs.length > 0 && (
            <Section title="Workpaper adjustments (overlay; the engine value above is unchanged)">
              <ul className="plain small">{adjs.map(({ a, d }) => <li key={a.id}>{money(a.from)} → <strong>{money(a.to)}</strong> · {a.decision?.status ?? 'pending'} · {a.reason} — <Person id={a.by} />, {fmtDate(a.at)} (<a href={`#/case/${d.id}`}>{d.id}</a>)</li>)}</ul>
            </Section>
          )}
          <Section title={`Used by (${deps.length})`}>
            {deps.length ? <ul className="plain">{deps.map((d) => <li key={d}><a href={`#/line/${encodeURIComponent(d)}?v=${version}`} className="mono">{d}</a> {line(ix, d, version)?.label} <span className="mono muted">{fmtV(line(ix, d, version)?.value)}</span></li>)}</ul> : <p className="muted small">Not an input to any other line.</p>}
          </Section>
        </div>
      </div>
    </div>
  );
}

function InputTree({ k, version, depth }: { k: string; version: string; depth: number }) {
  const { ix } = useApp();
  const l = line(ix, k, version);
  if (!l) return null;
  return (
    <ul className="tree">
      {l.inputs.map((i) => <TreeNode key={i} k={i} version={version} depth={depth + 1} />)}
    </ul>
  );
}

function TreeNode({ k, version, depth }: { k: string; version: string; depth: number }) {
  const { ix } = useApp();
  const [open, setOpen] = useState(depth < 2);
  const l = line(ix, k, version);
  if (!l) return <li className="muted">{k} (missing)</li>;
  const has = l.inputs.length > 0;
  return (
    <li>
      <span className="tree-row">
        {has ? <button className="link tw" onClick={() => setOpen(!open)} aria-label={open ? 'Collapse' : 'Expand'}>{open ? '▾' : '▸'}</button> : <span className="tw" />}
        <a href={`#/line/${encodeURIComponent(k)}?v=${version}`} className="mono">{k}</a> <span>{l.label}</span>
        <span className="mono tree-v">{fmtV(l.value)}</span>
        {l.sources.length > 0 && <span className="small muted"> · {l.sources.length} source{l.sources.length > 1 ? 's' : ''}</span>}
      </span>
      {has && open && depth < 8 && <InputTree k={k} version={version} depth={depth} />}
    </li>
  );
}
