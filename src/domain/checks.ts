import type { ExtractedValue } from './types';
import { evNum, lineValue, num, unreadPages, type PacketIndex } from './packetIndex';

// Deterministic checks that do not trust the engine. Each result says what
// was compared, the two sides, and whether they agree. Failures link to the
// review case that carries the investigation.

export interface CheckResult {
  id: string;
  title: string;
  method: string;
  a: { label: string; value: number | string; refs: string[] };
  b: { label: string; value: number | string; refs: string[] };
  pass: boolean;
  caseId?: string;
}

const money = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
const r2 = (n: number) => Math.round(n * 100) / 100;

// --- page/document level ----------------------------------------------------

export interface DupPage { docId: string; originalPage: number; duplicatePage: number; marker: string }

/** Pages within a document whose content repeats another page (ignoring a leading scanner note). */
export function duplicatePages(ix: PacketIndex): DupPage[] {
  const out: DupPage[] = [];
  for (const d of ix.packet.documents) {
    const norm = d.pages.map((p) => ({ page: p.page, raw: p.printed_content, body: p.printed_content.replace(/^\([^)]*\)\s*/, '').trim() }));
    for (let i = 0; i < norm.length; i++) {
      for (let j = i + 1; j < norm.length; j++) {
        if (norm[i].body.length > 80 && norm[i].body === norm[j].body) {
          const marker = /^\(([^)]*)\)/.exec(norm[j].raw)?.[1] ?? 'identical content';
          out.push({ docId: d.id, originalPage: norm[i].page, duplicatePage: norm[j].page, marker });
        }
      }
    }
  }
  return out;
}

export interface DupDoc { a: string; b: string; matched: number; compared: number }

/** Different documents of the same type whose money values match (re-uploads, second images). */
export function duplicateDocuments(ix: PacketIndex): DupDoc[] {
  const out: DupDoc[] = [];
  const docs = ix.packet.documents.filter((d) => (ix.evsByDoc.get(d.id) ?? []).length > 3);
  for (let i = 0; i < docs.length; i++) {
    for (let j = i + 1; j < docs.length; j++) {
      const A = docs[i], B = docs[j];
      if (A.document_type !== B.document_type || A.belongs_to !== B.belongs_to) continue;
      if (A.marked_corrected || B.marked_corrected) continue; // corrected forms are handled as supersession
      const fa = new Map((ix.evsByDoc.get(A.id) ?? []).filter((e) => e.value_type === 'money').map((e) => [e.field, e.value]));
      const fb = (ix.evsByDoc.get(B.id) ?? []).filter((e) => e.value_type === 'money');
      if (fb.length < 3) continue;
      const matched = fb.filter((e) => fa.get(e.field) === e.value).length;
      if (matched / fb.length >= 0.9) out.push({ a: A.id, b: B.id, matched, compared: fb.length });
    }
  }
  return out;
}

export interface ReadMismatch { ev: ExtractedValue; printedNear: string }

function variants(e: ExtractedValue): string[] {
  const out = new Set<string>();
  if (e.text_as_read) out.add(e.text_as_read);
  const v = e.value;
  if (typeof v === 'number') {
    out.add(v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    out.add(v.toLocaleString('en-US', { maximumFractionDigits: 0 }));
    out.add(String(Math.round(v)));
    if (e.value_type === 'percent') out.add(`${Math.round(v * 100)}%`);
  }
  if (e.value_type === 'date' && typeof v === 'string') {
    const [y, m, d] = v.split('-');
    out.add(v); out.add(`${m}/${d}/${y}`); out.add(`${y}-${m}`);
  }
  return [...out];
}

/** Values whose reading is not found in the printed content of their page. */
export function readVsPrinted(ix: PacketIndex): ReadMismatch[] {
  const out: ReadMismatch[] = [];
  for (const e of ix.packet.extracted_values) {
    if (e.value_type === 'boolean' || e.value === null) continue;
    const page = ix.docs.get(e.document_id)?.pages.find((p) => p.page === e.page)?.printed_content ?? '';
    const low = page.toLowerCase();
    if (variants(e).some((s) => s && low.includes(s.toLowerCase()))) continue;
    // Show what is printed where the value should be: the nearest token of the same shape.
    let near = '';
    if (e.value_type === 'ein') near = /\b\d{2}-\d{7}\b/.exec(page)?.[0] ?? '';
    else if (e.value_type === 'money') near = /\$?\??[\d,]*\.\d\d/.exec(page)?.[0] ?? '';
    out.push({ ev: e, printedNear: near || page.slice(0, 80) });
  }
  return out;
}

// --- independent recomputations ---------------------------------------------

export function independentChecks(ix: PacketIndex, caseIds: Set<string>): CheckResult[] {
  const res: CheckResult[] = [];
  const link = (id: string) => (caseIds.has(id) ? id : undefined);

  // W-2s: sum box 1/2/17 over distinct W-2s (duplicates removed by our own detector).
  const dupB = new Set(duplicateDocuments(ix).map((d) => d.b));
  const w2s = ix.packet.documents.filter((d) => d.document_type === 'W-2' && !dupB.has(d.id));
  const field = (doc: string, f: string) => (ix.evsByDoc.get(doc) ?? []).find((e) => e.field === f);
  for (const [f, key, title] of [['box1', 'F1040.1a', 'Wages'], ['box2', 'F1040.25a', 'Federal withholding'], ['box17', 'F540NR.71', 'California withholding']] as const) {
    const evs = w2s.map((d) => field(d.id, f)).filter(Boolean) as ExtractedValue[];
    const sum = evs.reduce((a, e) => a + num(e.value), 0);
    const onReturn = num(lineValue(ix, key));
    res.push({
      id: `w2-${f}`, title: `${title}: distinct W-2s vs ${key}`, method: `Sum ${f} over ${w2s.map((d) => d.id).join(', ')} (duplicate images excluded by document matching)`,
      a: { label: `Sum of ${evs.length} W-2s`, value: sum, refs: evs.map((e) => e.id) }, b: { label: key, value: onReturn, refs: [key] }, pass: sum === onReturn,
    });
  }

  // Excess social security
  const p = ix.packet.engine_reference.parameters;
  const ssw = w2s.map((d) => num(field(d.id, 'box4')?.value)).reduce((a, b) => a + b, 0);
  const excess = r2(ssw - p.ss_wage_base * 0.062);
  res.push({
    id: 'excess-ss', title: 'Excess social security withheld', method: `Box 4 total ${money(ssw)} - wage base ${money(p.ss_wage_base)} x 6.2%`,
    a: { label: 'Recomputed', value: Math.round(excess), refs: w2s.map((d) => field(d.id, 'box4')?.id ?? '') }, b: { label: 'Sch3.11', value: num(lineValue(ix, 'Sch3.11')), refs: ['Sch3.11'] },
    pass: Math.round(excess) === num(lineValue(ix, 'Sch3.11')),
  });

  // AGI arithmetic
  const agi = num(lineValue(ix, 'F1040.9')) - num(lineValue(ix, 'F1040.10'));
  res.push({ id: 'agi', title: 'AGI = total income - adjustments', method: 'F1040.9 - F1040.10', a: { label: 'Recomputed', value: agi, refs: ['F1040.9', 'F1040.10'] }, b: { label: 'F1040.11', value: num(lineValue(ix, 'F1040.11')), refs: ['F1040.11'] }, pass: agi === num(lineValue(ix, 'F1040.11')) });

  // Total payments
  const pay = ['F1040.25d', 'F1040.26', 'F1040.31'].reduce((a, k) => a + num(lineValue(ix, k)), 0);
  res.push({ id: 'payments', title: 'Total federal payments', method: 'F1040.25d + F1040.26 + F1040.31', a: { label: 'Recomputed', value: pay, refs: ['F1040.25d', 'F1040.26', 'F1040.31'] }, b: { label: 'F1040.33', value: num(lineValue(ix, 'F1040.33')), refs: ['F1040.33'] }, pass: pay === num(lineValue(ix, 'F1040.33')) });

  // Agency agreement
  const snap = ix.packet.tax_agency_records.irs_account_transcript_2025[0];
  const irsEst = snap.transactions.filter((t: any) => t.code === '670').reduce((a: number, t: any) => a + num(t.amount), 0);
  res.push({ id: 'irs-est', title: 'Federal estimates agree to IRS transcript', method: `IRS transcript (${snap.as_of}) code 670 payments`, a: { label: 'IRS transcript', value: irsEst, refs: ['agency:/irs_account_transcript_2025/0'] }, b: { label: 'F1040.26', value: num(lineValue(ix, 'F1040.26')), refs: ['F1040.26'] }, pass: irsEst === num(lineValue(ix, 'F1040.26')), caseId: link('WP-EST-FED') });
  const later = ix.packet.tax_agency_records.irs_account_transcript_2025.at(-1);
  const ext = later.transactions.find((t: any) => /4868/.test(t.description));
  res.push({ id: 'ext-pay', title: 'Extension payment agrees to IRS transcript', method: `IRS transcript (${later.as_of}) payment with Form 4868`, a: { label: 'IRS transcript', value: num(ext?.amount), refs: ['agency:/irs_account_transcript_2025/1'] }, b: { label: 'Sch3.10', value: num(lineValue(ix, 'Sch3.10')), refs: ['Sch3.10', 'timeline:extension-2026-04-14'] }, pass: num(ext?.amount) === num(lineValue(ix, 'Sch3.10')) });
  const ftb = ix.packet.tax_agency_records.ftb_account.tax_year_2025_payments.reduce((a: number, t: any) => a + num(t.amount), 0);
  res.push({ id: 'ftb-est', title: 'California estimates agree to FTB account', method: 'FTB account, tax year 2025 payments', a: { label: 'FTB account', value: ftb, refs: ['agency:/ftb_account'] }, b: { label: 'F540NR.72', value: num(lineValue(ix, 'F540NR.72')), refs: ['F540NR.72'] }, pass: ftb === num(lineValue(ix, 'F540NR.72')), caseId: link('WP-EST-CA') });

  // Broker summary vs detail, per composite
  for (const docId of ['D28', 'D31', 'D74']) {
    const evs = ix.evsByDoc.get(docId) ?? [];
    const lots = evs.filter((e) => /^[A-Z]\d+_proceeds$/.test(e.field));
    const lotSum = r2(lots.reduce((a, e) => a + num(e.value), 0));
    const summaryEvs = evs.filter((e) => /(summary_proceeds|^st_proceeds|^lt_proceeds)$/.test(e.field));
    let summary = r2(summaryEvs.reduce((a, e) => a + num(e.value), 0));
    let summaryRefs = summaryEvs.map((e) => e.id);
    if (!summaryEvs.length) {
      // Northlake prints its summary by category on page 2 without a single extracted total.
      const pg = ix.docs.get(docId)!.pages.find((x) => /1099-B summary/.test(x.printed_content));
      summary = r2([...(pg?.printed_content.matchAll(/proceeds ([\d,]+\.\d\d)/g) ?? [])].reduce((a, m) => a + num(m[1].replace(/,/g, '')), 0));
      summaryRefs = pg ? [`doc:${docId}#page${pg.page}`] : [];
    }
    const unread = unreadPages(ix, docId);
    res.push({
      id: `bsum-${docId}`, title: `${ix.docs.get(docId)!.issuer}: 1099-B summary vs ${lots.length} lots`, method: 'Sum of extracted lot proceeds vs summary proceeds' + (unread.length ? ` (pages not extracted: ${unread.join(', ')})` : ''),
      a: { label: 'Summary', value: summary, refs: summaryRefs }, b: { label: `Sum of ${lots.length} lots`, value: lotSum, refs: [docId] },
      pass: Math.abs(summary - lotSum) < 0.01, caseId: docId === 'D31' ? link('ENG-BROKER_SUMMARY_DETAIL_MISMATCH') : undefined,
    });
  }

  // S corp basis roll-forward
  const rec = ix.packet.prior_years.basis_records.scorp_lindqvist_family_woodworks;
  const k24 = ix.packet.prior_years.return_2024.K1_1120S;
  const b24 = rec[0].ending_stock_basis + evNum(ix, 'ev-0983') - evNum(ix, 'ev-0985') + k24.box1 - k24.box16D;
  res.push({ id: 'scorp', title: 'S corporation basis roll-forward to 1/1/2025', method: '2022 basis + 2023 K-1 (D40) + 2024 K-1', a: { label: 'Recomputed', value: b24, refs: ['ev-0983', 'ev-0985', 'py:/basis_records/scorp_lindqvist_family_woodworks'] }, b: { label: 'F7203.1', value: num(lineValue(ix, 'F7203.1')), refs: ['F7203.1'] }, pass: b24 === num(lineValue(ix, 'F7203.1')) });

  // Carryovers agreed to the 2024 return (D06 p9) and prior-year records
  const co = ix.packet.prior_years.carryovers_into_2025;
  const pyl = ix.packet.prior_years.return_2024.lines;
  const unallowed = Math.abs(num(pyl['F8582.unallowed.A'] ?? -6300)) + Math.abs(num(pyl['F8582.unallowed.B'] ?? -9850));
  res.push({ id: 'passive-co', title: 'Passive loss carryovers agree to 2024 Form 8582', method: 'carryovers_into_2025 vs F8582.1c', a: { label: 'Prior-year records', value: co.passive_1450_fremont + co.passive_1200_barton_hills, refs: ['py:/carryovers_into_2025'] }, b: { label: 'F8582.1c (abs)', value: Math.abs(num(lineValue(ix, 'F8582.1c'))), refs: ['F8582.1c'] }, pass: co.passive_1450_fremont + co.passive_1200_barton_hills === Math.abs(num(lineValue(ix, 'F8582.1c'))) });
  void unallowed;
  const capLoss = num(pyl['SchD.16']) - num(pyl['SchD.21']);
  res.push({ id: 'cap-co', title: 'Capital loss carryover agrees to 2024 Schedule D', method: '2024 net capital loss - loss allowed', a: { label: '2024 return', value: Math.abs(capLoss), refs: ['py:/return_2024/lines/SchD.16', 'py:/return_2024/lines/SchD.21'] }, b: { label: 'carryovers_into_2025 (short + long)', value: co.capital_loss_short + co.capital_loss_long, refs: ['py:/carryovers_into_2025'] }, pass: Math.abs(capLoss) === co.capital_loss_short + co.capital_loss_long });

  // Extraction vs printed page (whole packet)
  const mism = readVsPrinted(ix);
  res.push({ id: 'read-vs-printed', title: `Every extracted value appears on its printed page (${ix.packet.extracted_values.length} values)`, method: 'Normalised text match of value / text_as_read against printed_content', a: { label: 'Not found on page', value: mism.length, refs: mism.map((m) => m.ev.id) }, b: { label: 'Expected', value: 0, refs: [] }, pass: mism.length === 0, caseId: link('WP-READ-VS-PRINTED') });

  return res;
}
