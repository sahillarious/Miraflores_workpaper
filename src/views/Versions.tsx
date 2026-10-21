import { useMemo, useState } from 'react';
import { useApp } from '../ui/context';
import { useRoute } from '../ui/router';
import { Section, fmtDate, money } from '../ui/components';
import type { ReturnLine } from '../domain/types';

const FED: [string, string][] = [['agi', 'AGI'], ['taxable_income', 'Taxable income'], ['total_tax', 'Total tax'], ['payments', 'Payments'], ['balance_due', 'Balance due'], ['penalty', 'Penalty']];
const CA: [string, string][] = [['total_agi', 'Total AGI'], ['ca_agi', 'California AGI'], ['total_tax', 'Total tax'], ['payments', 'Payments'], ['balance_due', 'Balance (negative = refund)'], ['penalty', 'Penalty']];
const PY_KEYS: Record<string, string> = { agi: 'F1040.11', taxable_income: 'F1040.15', total_tax: 'F1040.24', payments: 'F1040.33' };

export function Versions() {
  const { ix, defs } = useApp();
  const route = useRoute();
  const vs = ix.versions;
  const [pair, setPair] = useState(route.query.get('v') && route.query.get('v') !== 'v1' ? route.query.get('v')! : vs[vs.length - 1].version);
  const target = ix.versionById.get(pair)!;
  const prevIdx = vs.indexOf(target) - 1;
  const prev = prevIdx >= 0 ? vs[prevIdx] : undefined;
  const [q, setQ] = useState('');
  const py = ix.packet.prior_years.return_2024.lines;

  const changes = target.changes_from_previous.filter((c) => !q || `${c.key} ${ix.lines.get(pair)!.get(c.key)?.label ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  const byForm = new Map<string, typeof changes>();
  for (const c of changes) { const f = c.key.split('.')[0]; byForm.set(f, [...(byForm.get(f) ?? []), c]); }

  const diagCodes = (v?: typeof target) => new Set(v?.diagnostics.map((d) => d.code) ?? []);
  const appeared = [...diagCodes(target)].filter((c) => !diagCodes(prev).has(c));
  const cleared = [...diagCodes(prev)].filter((c) => !diagCodes(target).has(c));
  const docsAdded = target.documents_used.filter((d) => !prev?.documents_used.includes(d));
  const docsRemoved = (prev?.documents_used ?? []).filter((d) => !target.documents_used.includes(d));
  const ext = ix.packet.what_if.extension;

  return (
    <div className="page">
      <div className="page-h"><div><h1>Return and versions</h1><p className="muted">Three engine snapshots, kept as delivered. A change between snapshots shows what the engine did with new documents. It does not prove the new value is right.</p></div></div>

      <div className="vcards">
        {vs.map((v, i) => (
          <button key={v.version} className={`vcard${v.version === pair ? ' on' : ''}`} onClick={() => setPair(v.version)}>
            <div className="vcard-h"><strong>{v.version}</strong> <span className="muted small">{fmtDate(v.computed_at)}</span>{i === vs.length - 1 && <span className="pill st-in_review">current</span>}</div>
            <div className="small">{v.trigger}</div>
            <div className="small muted">{v.documents_used.length} documents used · {v.diagnostics.length} diagnostics · {v.changes_from_previous.length} line changes</div>
          </button>
        ))}
      </div>

      <div className="grid-2">
        <Section title="Federal summary">
          <table className="tbl figures">
            <thead><tr><th></th><th className="num">2024 filed</th>{vs.map((v) => <th key={v.version} className="num">{v.version}</th>)}<th className="num">v1→v3</th></tr></thead>
            <tbody>{FED.map(([k, l]) => (
              <tr key={k}><td>{l}</td><td className="num muted">{PY_KEYS[k] ? money(py[PY_KEYS[k]]) : '—'}</td>{vs.map((v) => <td key={v.version} className="num">{money((v.summary.federal as any)[k])}</td>)}<td className="num">{money((vs.at(-1)!.summary.federal as any)[k] - (vs[0].summary.federal as any)[k], { sign: true })}</td></tr>
            ))}</tbody>
          </table>
        </Section>
        <Section title="California summary (540NR)">
          <table className="tbl figures">
            <thead><tr><th></th>{vs.map((v) => <th key={v.version} className="num">{v.version}</th>)}<th className="num">v1→v3</th></tr></thead>
            <tbody>{CA.map(([k, l]) => (
              <tr key={k}><td>{l}</td>{vs.map((v) => <td key={v.version} className="num">{money((v.summary.california as any)[k])}</td>)}<td className="num">{money((vs.at(-1)!.summary.california as any)[k] - (vs[0].summary.california as any)[k], { sign: true })}</td></tr>
            ))}</tbody>
          </table>
          <p className="small muted">California balance: negative values in the packet are overpayments (refunds); shown here as supplied.</p>
        </Section>
      </div>

      {prev && (
        <div className="grid-2">
          <Section title={`What changed ${prev.version} → ${target.version}`}>
            <p><strong>Trigger:</strong> {target.trigger}</p>
            <p className="small"><strong>Documents newly used:</strong> {docsAdded.length ? docsAdded.map((d) => <a key={d} href={`#/doc/${d}`} className="mono">{d} </a>) : 'none'}{docsRemoved.length > 0 && <> · <strong>dropped:</strong> {docsRemoved.map((d) => <a key={d} href={`#/doc/${d}`} className="mono">{d} </a>)}</>}</p>
            <p className="small"><strong>Superseded:</strong> {target.documents_superseded.map((d) => <a key={d} href={`#/doc/${d}`} className="mono">{d} </a>)}{!target.documents_superseded.length && 'none'}</p>
            <p className="small"><strong>Diagnostics raised:</strong> {appeared.length ? appeared.join(', ') : 'none'} · <strong>cleared:</strong> {cleared.length ? cleared.map((c) => <a key={c} href={`#/case/ENG-${c}`} className="mono">{c} </a>) : 'none'}</p>
            {cleared.length > 0 && <p className="small note">A diagnostic the engine stopped raising still needs a reviewer to confirm the new inputs. These stay open as cases.</p>}
            {target.version === 'v3' && (
              <p className="small"><strong>Extension:</strong> on {fmtDate('2026-04-14T15:00:00Z')} Form 4868 was filed with {money(ext.federal.paid_with_form_4868)}, estimated from {ext.based_on_version} (rule: {ext.federal.rule}). v3 payments include it (Sch3.10).</p>
            )}
          </Section>
          <Section title={`Line changes (${target.changes_from_previous.length})`} right={<input type="search" placeholder="Filter lines" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter changes" />}>
            <div className="scroll">
              {[...byForm.entries()].map(([form, cs]) => (
                <details key={form} open={cs.length < 12}>
                  <summary><strong>{form}</strong> <span className="muted">({cs.length})</span></summary>
                  <table className="tbl small">
                    <tbody>{cs.map((c) => (
                      <tr key={c.key}>
                        <td><a href={`#/line/${encodeURIComponent(c.key)}`} className="mono">{c.key}</a> <span className="muted">{ix.lines.get(pair)!.get(c.key)?.label?.slice(0, 50)}</span></td>
                        <td className="num muted">{c.change === 'added' ? 'added' : fmtV(c.old)}</td><td>→</td><td className="num">{c.change === 'removed' ? 'removed' : fmtV(c.new)}</td>
                        <td className="num">{typeof c.new === 'number' && typeof c.old === 'number' ? money(c.new - c.old, { sign: true }) : ''}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </details>
              ))}
            </div>
          </Section>
        </div>
      )}

      <Section title="Engine what-ifs (computed by the engine; not applied)">
        <table className="tbl small">
          <thead><tr><th>Alternative</th><th>Base</th><th className="num">Federal tax Δ</th><th className="num">California tax Δ</th><th>Related case</th></tr></thead>
          <tbody>
            {ix.packet.what_if.alternatives.map((a: any) => (
              <tr key={a.id}><td>{a.description}</td><td>{a.base_version}</td><td className="num">{money(a.federal.total_tax_change, { sign: true })}</td><td className="num">{money(a.california.total_tax_change, { sign: true })}</td>
                <td>{a.id === 'hvac_improvement' && defs.some((d) => d.id === 'WP-HVAC') ? <a href="#/case/WP-HVAC">WP-HVAC</a> : ''}</td></tr>
            ))}
          </tbody>
        </table>
      </Section>

      <LineExplorer version={pair} />
    </div>
  );
}

const fmtV = (v: unknown) => (typeof v === 'number' ? money(v, { cents: !Number.isInteger(v) }) : String(v ?? '—'));

function LineExplorer({ version }: { version: string }) {
  const { ix } = useApp();
  const [q, setQ] = useState('');
  const lines = ix.versionById.get(version)!.lines;
  const groups = useMemo(() => {
    const m = new Map<string, ReturnLine[]>();
    for (const l of lines) {
      if (q && !`${l.key} ${l.label}`.toLowerCase().includes(q.toLowerCase())) continue;
      m.set(l.form, [...(m.get(l.form) ?? []), l]);
    }
    return m;
  }, [lines, q]);
  return (
    <Section title={`All ${lines.length} lines in ${version}`} right={<input type="search" placeholder="Find a line (e.g. 1099-K, F1040.11)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a line" />}>
      <div className="forms">
        {[...groups.entries()].map(([form, ls]) => <FormGroup key={form} form={form} lines={ls} open={!!q && ls.length < 40} />)}
      </div>
    </Section>
  );
}

function FormGroup({ form, lines, open }: { form: string; lines: ReturnLine[]; open: boolean }) {
  // Large detail (Form 8949 lots) is summarised by box with the lots collapsed.
  const lots = form === 'F8949' ? lines.filter((l) => !l.key.endsWith('.total')) : [];
  const byBox = new Map<string, ReturnLine[]>();
  for (const l of lots) { const b = l.key.split('.')[1]; byBox.set(b, [...(byBox.get(b) ?? []), l]); }
  return (
    <details open={open}>
      <summary><strong>{form}</strong> <span className="muted">({lines.length} lines{form === 'F8949' ? `, ${lots.length} lots in ${byBox.size} boxes` : ''})</span></summary>
      {form === 'F8949' ? (
        <div>
          {[...byBox.entries()].map(([box, ls]) => {
            const total = ls.reduce((a, l) => a + (typeof l.value === 'number' ? l.value : 0), 0);
            const biggest = [...ls].sort((a, b) => Math.abs(Number(b.value)) - Math.abs(Number(a.value))).slice(0, 5);
            return (
              <details key={box} className="sub">
                <summary>Box {box}: {ls.length} lots · net {money(total, { cents: true })} · largest: {biggest.map((l) => <a key={l.key} href={`#/line/${encodeURIComponent(l.key)}`} className="mono">{l.key.split('.')[2]} </a>)}</summary>
                <LineTable lines={ls} />
              </details>
            );
          })}
          <LineTable lines={lines.filter((l) => l.key.endsWith('.total'))} />
        </div>
      ) : <LineTable lines={lines} />}
    </details>
  );
}

function LineTable({ lines }: { lines: ReturnLine[] }) {
  return (
    <table className="tbl small">
      <tbody>
        {lines.map((l) => (
          <tr key={l.key}>
            <td className="mono"><a href={`#/line/${encodeURIComponent(l.key)}`}>{l.key}</a></td>
            <td>{l.label}</td>
            <td className="num">{fmtV(l.value)}</td>
            <td className="small muted">{l.rule}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
