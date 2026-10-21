import { useApp } from '../ui/context';
import { useRoute } from '../ui/router';
import { Section, money } from '../ui/components';
import { resolvePointer } from '../domain/packetIndex';

/** Prior-year records and agency records, browsable by JSON pointer (the packet's py:/ and agency:/ references). */
export function PriorRecords() {
  const { ix } = useApp();
  const route = useRoute();
  const ptr = route.query.get('ptr');
  const agency = route.query.get('agency');
  const focusVal = ptr ? resolvePointer(ix.packet.prior_years, ptr) : agency ? resolvePointer(ix.packet.tax_agency_records, agency) : undefined;
  const pw = ix.packet.prior_years.prior_preparer_workpaper;
  const r24 = ix.packet.prior_years.return_2024;
  return (
    <div className="page">
      <div className="page-h"><div><h1>Prior year and agency records</h1><p className="muted">Prior preparer: {r24.prepared_by}, filed {r24.filed}.</p></div></div>
      {(ptr || agency) && (
        <Section title={<>Referenced record <span className="mono">{ptr ? `py:${ptr}` : `agency:${agency}`}</span></>}>
          <pre className="json">{JSON.stringify(focusVal, null, 2) ?? 'not found'}</pre>
        </Section>
      )}
      <div className="grid-2">
        <Section title="Prior preparer's workpaper (D07)">
          <p>{pw.summary_memo}</p>
          <h4>Notes</h4><ul>{pw.notes.map((n: string, i: number) => <li key={i}>{n}</li>)}</ul>
          <h4>Open items left</h4><ul>{pw.open_items_left_by_prior_preparer.map((n: string, i: number) => <li key={i}>{n}</li>)}</ul>
          <p><a href="#/case/WP-PRIOR-OPEN-ITEMS">Disposition of these items →</a></p>
        </Section>
        <div className="stack">
          <Section title="Carryovers into 2025">
            <pre className="json">{JSON.stringify(ix.packet.prior_years.carryovers_into_2025, null, 2)}</pre>
          </Section>
          <Section title="Basis records (gaps are real gaps)">
            <pre className="json">{JSON.stringify(ix.packet.prior_years.basis_records, null, 2)}</pre>
          </Section>
        </div>
      </div>
      <div className="grid-2">
        <Section title="IRS account transcript snapshots">
          {ix.packet.tax_agency_records.irs_account_transcript_2025.map((s: any, i: number) => (
            <div key={i}><strong>As of {s.as_of}</strong>
              <table className="tbl small"><tbody>{s.transactions.map((t: any, j: number) => <tr key={j}><td>{t.date}</td><td className="mono">{t.code}</td><td>{t.description}</td><td className="num">{typeof t.amount === 'number' ? money(t.amount) : t.amount}</td></tr>)}</tbody></table>
            </div>
          ))}
        </Section>
        <Section title="FTB account, notices, e-file">
          <pre className="json">{JSON.stringify({ ftb_account: ix.packet.tax_agency_records.ftb_account, notices: ix.packet.tax_agency_records.notices, efile: ix.packet.tax_agency_records.efile }, null, 2)}</pre>
        </Section>
      </div>
    </div>
  );
}

/** Depreciation by asset: federal vs California vs AMT, with disposals. */
export function Assets() {
  const { ix } = useApp();
  const route = useRoute();
  const focus = route.query.get('focus');
  const assets = ix.current.assets;
  const co = ix.current.carryovers_out.california?.depreciation_basis_differences ?? {};
  return (
    <div className="page">
      <div className="page-h"><div><h1>Depreciation by asset ({ix.current.version})</h1><p className="muted">Federal, California and AMT from the engine's asset schedule. California differences carry forward.</p></div></div>
      <table className="tbl">
        <thead><tr><th>Asset</th><th>Activity</th><th>In service</th><th>Method / life</th><th className="num">Cost</th><th className="num">Federal 2025</th><th className="num">Fed. accumulated</th><th className="num">California 2025</th><th className="num">AMT diff.</th><th>Disposed</th><th className="num">CA basis diff. c/f</th></tr></thead>
        <tbody>
          {assets.map((a: any) => (
            <tr key={a.asset_id} className={focus === a.asset_id ? 'selected' : ''}>
              <td><span className="mono">{a.asset_id}</span><div className="small">{a.description}</div></td>
              <td className="small">{a.activity}</td>
              <td>{a.placed_in_service}</td>
              <td className="small">{a.method} / {a.life_years}</td>
              <td className="num">{money(a.cost)}{a.land_value_not_depreciated ? <div className="small muted">land {money(a.land_value_not_depreciated)}</div> : null}</td>
              <td className="num">{money(a.federal?.depreciation_2025, { cents: true })}</td>
              <td className="num">{money(a.federal?.accumulated_end, { cents: true })}</td>
              <td className="num">{money(a.california?.depreciation_2025, { cents: true })}</td>
              <td className="num">{money(a.amt?.difference_from_regular, { cents: true })}</td>
              <td className="small">{a.disposed ? (typeof a.disposed === 'string' ? a.disposed : JSON.stringify(a.disposed)) : a.disposition ? JSON.stringify(a.disposition) : '—'}</td>
              <td className="num">{co[a.asset_id] !== undefined ? money(co[a.asset_id], { cents: true }) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
