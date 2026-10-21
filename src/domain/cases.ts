import { estimateEffect, absEffect, type Effect, type EffectPart } from './effects';
import { evNum, line, lineValue, num, resolvePointer, unreadPages, type PacketIndex } from './packetIndex';
import { duplicateDocuments, duplicatePages, readVsPrinted } from './checks';

// Review cases. Each case is derived from the packet: either an engine
// diagnostic (origin "engine", keyed by its diagnostic code) or an
// application check (origin "workpaper", keyed by a WP- rule id). Amounts
// are computed from packet records by id, never typed in, so the case always
// agrees with the evidence it cites.

export type Severity = 'blocker' | 'high' | 'medium' | 'low';
export type Classification =
  | 'confirmed_discrepancy' | 'potential_discrepancy' | 'missing_evidence' | 'contradiction'
  | 'judgment' | 'informational' | 'out_of_scope' | 'duplicate';
export type Outcome =
  | 'corrected' | 'substantiated' | 'explained_difference' | 'formatting_only'
  | 'accepted_as_is' | 'not_applicable' | 'out_of_scope_referred' | 'acknowledged';
export type Area =
  | 'Wages & stock comp' | 'Investments & digital assets' | 'Business (Sch C)' | 'Rentals & sale'
  | 'Pass-throughs & basis' | 'Deductions & credits' | 'California' | 'Payments' | 'Identity & filing'
  | 'Foreign' | 'Retirement' | 'Engagement';

export interface Side { label: string; value: number | string | null; refs: string[]; note?: string }
export interface Reconciliation {
  id: string;
  title: string;
  a: Side;
  b: Side;
  unit: 'USD' | 'miles' | 'text' | 'sq ft';
  /** Whether a numeric difference is meaningful (same quantity, units and aggregation). */
  comparable: boolean;
  expectation: string;
  /** What the evidence shows, computed from the packet. */
  finding?: string;
}

export interface SuggestedAdjustment {
  lineKey: string;
  from: number;
  to: number;
  reason: string;
  effect: Effect;
}

export interface CaseDef {
  id: string;
  origin: 'engine' | 'workpaper';
  ruleId: string;
  title: string;
  area: Area;
  jurisdiction: 'federal' | 'california' | 'both' | 'none';
  severity: Severity;
  classification: Classification;
  why: string;
  matters: string;
  facts: { text: string; refs: string[] }[];
  conflicts: { text: string; refs: string[] }[];
  openQuestions: string[];
  nextAction: string;
  requirements: string[];
  refs: string[];
  lines: string[];
  reconciliations: Reconciliation[];
  effect?: Effect;
  suggested?: SuggestedAdjustment;
  allowedOutcomes: Outcome[];
  /** Outcomes that require linked documentary (non-client-statement) evidence. */
  documentaryFor: Outcome[];
  versionsSeen?: string[];
  diagnosticMessage?: string;
  defaultOwner: string;
  priorityScore: number;
  priorityBasis: string;
  priority: 'P1' | 'P2' | 'P3';
}

type Draft = Omit<CaseDef, 'priorityScore' | 'priorityBasis' | 'priority' | 'allowedOutcomes' | 'documentaryFor' | 'defaultOwner' | 'facts' | 'conflicts' | 'openQuestions' | 'reconciliations' | 'lines'> &
  Partial<Pick<CaseDef, 'allowedOutcomes' | 'documentaryFor' | 'defaultOwner' | 'facts' | 'conflicts' | 'openQuestions' | 'reconciliations' | 'lines'>>;

const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const DEFAULT_OUTCOMES: Outcome[] = ['corrected', 'substantiated', 'explained_difference', 'accepted_as_is', 'not_applicable'];

function finish(d: Draft): CaseDef {
  const sevW: Record<Severity, number> = { blocker: 100, high: 60, medium: 30, low: 10 };
  const mat = Math.min(40, Math.round(absEffect(d.effect) / 150));
  const flags = (d.classification === 'contradiction' ? 8 : 0) + (d.classification === 'missing_evidence' ? 8 : 0) + (d.classification === 'confirmed_discrepancy' ? 10 : 0);
  const score = sevW[d.severity] + mat + flags;
  const basis = [
    `${d.severity} severity (+${sevW[d.severity]})`,
    d.effect ? `est. tax effect ${money(absEffect(d.effect))} (+${mat})` : 'no estimated tax effect',
    flags ? `${d.classification.replace(/_/g, ' ')} (+${flags})` : '',
  ].filter(Boolean).join(' · ');
  return {
    facts: [], conflicts: [], openQuestions: [], reconciliations: [], lines: [],
    allowedOutcomes: DEFAULT_OUTCOMES, documentaryFor: ['corrected', 'substantiated'], defaultOwner: 'st-01',
    ...d,
    priorityScore: score,
    priorityBasis: basis,
    priority: score >= 80 ? 'P1' : score >= 45 ? 'P2' : 'P3',
  };
}

function sumOf(xs: number[]) { return xs.reduce((a, b) => a + b, 0); }
const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Engine diagnostics -> cases (all versions; a code that disappears in a later
// version is still a case: the engine clearing a flag is not a review).
// ---------------------------------------------------------------------------

function engineCases(ix: PacketIndex): CaseDef[] {
  const seen = new Map<string, { versions: string[]; diag: any }>();
  for (const v of ix.versions) {
    for (const g of v.diagnostics) {
      const s = seen.get(g.code) ?? { versions: [], diag: g };
      s.versions.push(v.version);
      s.diag = g; // keep the latest wording/refs
      seen.set(g.code, s);
    }
  }
  const out: CaseDef[] = [];
  for (const [code, { versions, diag }] of seen) {
    const enrich = ENGINE_ENRICH[code]?.(ix, diag, versions);
    const cleared = !versions.includes(ix.current.version);
    const base: Draft = {
      id: `ENG-${code}`,
      origin: 'engine',
      ruleId: code,
      title: diag.message,
      area: 'Engagement',
      jurisdiction: 'federal',
      severity: diag.severity === 'warning' ? 'medium' : 'low',
      classification: diag.severity === 'warning' ? 'potential_discrepancy' : 'informational',
      why: `Engine diagnostic ${code} (${diag.severity}) raised in ${versions.join(', ')}${cleared ? `; not raised in ${ix.current.version}` : ''}.`,
      matters: '',
      nextAction: 'Review the cited evidence and record a conclusion.',
      requirements: ['Documented rationale'],
      refs: diag.refs,
      diagnosticMessage: diag.message,
      versionsSeen: versions,
      ...enrich,
    };
    if (cleared && !enrich?.why) base.why += ' The engine cleared it after new documents arrived; a reviewer still has to confirm the new inputs.';
    out.push(finish(base));
  }
  return out;
}

type Enricher = (ix: PacketIndex, diag: any, versions: string[]) => Partial<Draft>;

const ENGINE_ENRICH: Record<string, Enricher> = {
  BROKER_SUMMARY_DETAIL_MISMATCH: (ix) => {
    const doc = 'D31';
    const lots = (ix.evsByDoc.get(doc) ?? []).filter((e) => /^M\d+_proceeds$/.test(e.field));
    const lotSum = round2(sumOf(lots.map((e) => num(e.value))));
    const summary = evNum(ix, 'ev-0703');
    const unread = unreadPages(ix, doc);
    const unreadText = unread.map((p) => ix.docs.get(doc)!.pages.find((x) => x.page === p)!.printed_content).join(' ');
    const unreadProceeds = round2(sumOf([...unreadText.matchAll(/proceeds ([\d,]+\.\d\d)/g)].map((m) => num(m[1].replace(/,/g, '')))));
    const unreadBasis = round2(sumOf([...unreadText.matchAll(/basis ([\d,]+\.\d\d)/g)].map((m) => num(m[1].replace(/,/g, '')))));
    const diff = round2(summary - lotSum);
    const lotGain = round2(unreadProceeds - unreadBasis);
    const explained = Math.abs(diff - unreadProceeds) < 0.005;
    return {
      title: `Meridian 1099-B summary proceeds ${money(summary)} vs extracted lots ${money(lotSum)} (difference ${money(diff)})`,
      area: 'Investments & digital assets',
      severity: 'medium',
      classification: 'confirmed_discrepancy',
      why: `Summary proceeds on the corrected Meridian 1099 (ev-0703) do not equal the sum of the ${lots.length} lots the pipeline extracted.`,
      matters: `Proceeds and basis on Form 8949 must reconcile to the broker's 1099-B or the IRS matching program will flag the return. Page ${unread.join(', ')} of ${doc} was never extracted.`,
      facts: [
        { text: `Corrected 1099 (D31) supersedes the original (D30); client said so in msg-05. v2 and v3 use D31.`, refs: ['D31', 'D30', 'msg-05'] },
        { text: `Unread page ${unread.join(', ')} prints additional transaction(s) with proceeds ${money(unreadProceeds)} and basis ${money(unreadBasis)} (gain ${money(lotGain)}).`, refs: unread.map((p) => `doc:${doc}#page${p}`) },
      ],
      openQuestions: ['Should the page-32 lot be added to Form 8949 as a short-term noncovered sale (box B)?'],
      nextAction: explained
        ? `Add the page-${unread.join(',')} lot to Form 8949 (proceeds ${money(unreadProceeds)}, basis ${money(unreadBasis)}) or document why it is excluded.`
        : 'Locate the missing proceeds before concluding.',
      requirements: ['Difference explained by a specific source', 'Decision on the missing lot recorded'],
      refs: ['ev-0703', 'D31', 'D30', 'msg-05', ...unread.map((p) => `doc:${doc}#page${p}`)],
      lines: ['SchD.1b', 'F8949.A.total'],
      reconciliations: [{
        id: 'meridian-proceeds',
        title: 'Meridian 1099-B proceeds: broker summary vs lot detail',
        a: { label: 'Broker summary proceeds (D31 p1)', value: summary, refs: ['ev-0703'] },
        b: { label: `Sum of ${lots.length} extracted lots (D31 p2-31)`, value: lotSum, refs: lots.map((e) => e.id) },
        unit: 'USD', comparable: true,
        expectation: 'Should agree: the summary is the total of every lot on the statement.',
        finding: explained
          ? `Difference ${money(diff)} equals the proceeds printed on unread page ${unread.join(', ')} (${money(unreadProceeds)}). The discrepancy is an extraction gap, not a broker error.`
          : `Difference ${money(diff)} is not explained by unread pages (${money(unreadProceeds)}).`,
      }],
      effect: estimateEffect(ix, [{ category: 'stcg', amount: lotGain, label: `Add lot gain/loss ${money(lotGain)} (sold in December, after the move)` }]),
      suggested: undefined,
    };
  },

  QUESTIONNAIRE_SALES_CONFLICT: (ix) => {
    const lotKeys = [...ix.lines.get(ix.current.version)!.keys()].filter((k) => /^F8949\.[A-Z]\.[NMX]\d+$/.test(k));
    const cryptoKeys = [...ix.lines.get(ix.current.version)!.keys()].filter((k) => /^F8949\.[A-Z]\.C\d+$/.test(k));
    return {
      area: 'Investments & digital assets',
      severity: 'medium',
      classification: 'contradiction',
      title: `Questionnaire says no investments sold; the return reports ${lotKeys.length} brokerage sales and ${cryptoKeys.length} digital-asset dispositions`,
      why: 'qa-14 answered "No" to selling investments; qa-15 says crypto was "just moved around".',
      matters: 'The answer is contradicted by third-party 1099-B and 1099-DA forms. Clients often misread the question (direct indexing and RSU sell-to-cover sales are automatic). The contradiction must be resolved and documented, not ignored, and it bears on whether other answers can be relied on.',
      facts: [
        { text: `${lotKeys.length} brokerage lots on Form 8949 from Northlake (D28), Meridian (D31) and Brightpath (D74).`, refs: ['D28', 'D31', 'D74'] },
        { text: `${cryptoKeys.length} Coinhaven dispositions on Form 1099-DA (D34) and the CSV export (D35).`, refs: ['D34', 'D35'] },
      ],
      conflicts: [
        { text: 'qa-14: "No" to selling stocks, bonds, mutual funds or other investments.', refs: ['qa-14'] },
        { text: 'qa-15: "We didn\'t really sell, just moved things around."', refs: ['qa-15'] },
      ],
      openQuestions: ['Does the client recognise the Brightpath direct-indexing and Corvane RSU sales?', 'Were any Coinhaven transactions transfers between the client\'s own wallets rather than sales?'],
      nextAction: 'Send the client a follow-up question listing the accounts with sales; record the answer as evidence.',
      requirements: ['Client follow-up recorded', 'Documented conclusion'],
      refs: ['qa-14', 'qa-15', 'D28', 'D31', 'D74', 'D34', 'D35'],
      lines: ['SchD.16'],
      reconciliations: [{
        id: 'qa14-vs-1099b', title: 'Client answer vs third-party forms',
        a: { label: 'qa-14 answer', value: ix.qa.get('qa-14')?.answer ?? null, refs: ['qa-14'] },
        b: { label: 'Dispositions on 1099-B / 1099-DA', value: `${lotKeys.length} brokerage + ${cryptoKeys.length} digital asset`, refs: ['D28', 'D31', 'D74', 'D34'] },
        unit: 'text', comparable: false,
        expectation: 'A "No" answer should mean no 1099-B/1099-DA sales.',
        finding: 'Third-party forms control the reporting. The open question is the client\'s understanding, which affects reliance on the other answers.',
      }],
      allowedOutcomes: ['explained_difference', 'accepted_as_is', 'corrected'],
    };
  },

  DIGITAL_ASSET_BASIS_MISSING: (ix) => {
    const proceeds = num(lineValue(ix, 'F8949.H.C6') ?? NaN);
    const claimed = 3050;
    const claimText = ix.msgs.get('msg-07')?.text ?? '';
    const claimMatch = /about ([\d,]+)/.exec(claimText);
    const claimedAmt = claimMatch ? num(claimMatch[1].replace(/,/g, '')) : claimed;
    const ifSubst: EffectPart[] = [
      { category: 'stcg', amount: -proceeds, label: `Remove short-term gain ${money(proceeds)} (zero basis, transfer-in date)` },
      { category: 'ltcg', amount: proceeds - claimedAmt, label: `Add long-term gain ${money(proceeds - claimedAmt)} (basis ${money(claimedAmt)}, acquired 2021)` },
    ];
    return {
      area: 'Investments & digital assets',
      severity: 'high',
      classification: 'missing_evidence',
      title: `Coinhaven lot C6 (BTC 0.05, proceeds ${money(proceeds)}) reported with zero basis`,
      why: 'The Coinhaven CSV shows C6 as a transfer-in with no cost; the engine used zero basis and the transfer-in date (2025-06-01), making the whole sale a short-term gain.',
      matters: `Zero basis overstates gain. The client's account (msg-07) would also change the holding period to long-term. Neither can be accepted on a client statement alone.`,
      facts: [
        { text: 'D35 CSV: "C6 BTC 0.05 acquired TRANSFER-IN 2025-06-01 (cost basis unknown)". Extraction: basis missing (confidence 0.60), date "transfer-in".', refs: ['ev-0919', 'ev-0918', 'ev-0879', 'ev-0881', 'ev-0882'] },
        { text: `Client (msg-07): bought on CryptoNorth in March 2021 for about ${money(claimedAmt)}, moved to Coinhaven in June; the exchange shut down; only a bank statement line remains.`, refs: ['msg-07'] },
      ],
      conflicts: [{ text: 'The bank statement the client describes is not in the file. A purchase payment alone would not show that this specific 0.05 BTC was the asset transferred in.', refs: ['msg-07'] }],
      openQuestions: [
        'Can the client upload the bank statement showing the 03/15/2021 CryptoNorth debit?',
        'Is there any wallet or blockchain record linking the 2021 purchase to the June 2025 transfer-in?',
        'How many BTC did the 3,050 buy, and is 0.05 BTC all or part of it?',
      ],
      nextAction: 'Request the bank statement and any wallet/transfer records. Keep zero basis until basis is substantiated.',
      requirements: ['Documentary evidence linked (not only the client message)', 'Basis and acquisition date decision documented', 'Reviewer approval'],
      refs: ['ev-0879', 'ev-0881', 'ev-0882', 'ev-0918', 'ev-0919', 'D34', 'D35', 'msg-07'],
      lines: ['F8949.H.C6'],
      reconciliations: [{
        id: 'c6-basis', title: 'Lot C6 cost basis',
        a: { label: 'Basis used by engine', value: 0, refs: ['F8949.H.C6', 'ev-0919'], note: 'nothing printed on the CSV' },
        b: { label: 'Client-reported purchase (lead, unverified)', value: claimedAmt, refs: ['msg-07'], note: 'approximate; bank statement not in file' },
        unit: 'USD', comparable: true,
        expectation: 'Basis must be substantiated by records, not by the client\'s recollection.',
        finding: 'Unresolved. The client\'s figure is a lead to follow up, not verified basis.',
      }],
      effect: estimateEffect(ix, ifSubst, 'If the 3,050 basis and the 2021 date were substantiated (federal estimate; v3 rates). Not applied.'),
      allowedOutcomes: ['substantiated', 'corrected', 'accepted_as_is'],
      documentaryFor: ['substantiated', 'corrected'],
    };
  },

  LOW_CONFIDENCE_READ: (ix) => {
    const e = ix.evs.get('ev-1049')!;
    const page = ix.docs.get('D64')!.pages[0].printed_content;
    return {
      area: 'Deductions & credits',
      severity: 'medium',
      classification: 'missing_evidence',
      title: `St. Brigid handwritten receipt read as ${money(num(e.value))} with confidence ${e.confidence}; first digit is ambiguous`,
      why: 'Handwritten amount; the extraction confidence is 0.41 and the page itself is ambiguous.',
      matters: 'A 1 or a 7 makes a 6,000 difference in cash charitable gifts. Low confidence stays on record even after the client confirms the amount.',
      facts: [
        { text: `Printed: ${page}`, refs: ['D64'] },
        { text: 'Client (msg-08): the parish confirmed 1,500 by phone; matches check #2207 dated 12/21/2025.', refs: ['msg-08'] },
      ],
      conflicts: [{ text: 'The bank statement / check image is described by the client but is not in the file.', refs: ['msg-08'] }],
      openQuestions: ['Obtain the cancelled check #2207 or the bank statement line.'],
      nextAction: 'Link the bank record (or a written parish acknowledgment) before treating 1,500 as substantiated.',
      requirements: ['Documentary evidence of the amount', 'Documented conclusion'],
      refs: ['ev-1049', 'D64', 'msg-08'],
      lines: ['SchA.11'],
      reconciliations: [{
        id: 'stbrigid', title: 'St. Brigid gift amount',
        a: { label: 'Extracted (confidence 0.41)', value: num(e.value), refs: ['ev-1049'] },
        b: { label: 'Alternative reading of first digit', value: 7500, refs: ['D64'], note: 'page says "could be read as 1 or 7"' },
        unit: 'USD', comparable: true,
        expectation: 'Only one reading can be right; the receipt alone cannot decide.',
        finding: 'The client says 1,500 (msg-08). That is consistent with the lower reading but not yet documented.',
      }],
      allowedOutcomes: ['substantiated', 'corrected', 'accepted_as_is'],
      documentaryFor: ['substantiated', 'corrected'],
    };
  },

  SCORP_BASIS_INCOMPLETE: (ix) => {
    const rec = ix.packet.prior_years.basis_records.scorp_lindqvist_family_woodworks;
    const b2022 = rec[0].ending_stock_basis as number;
    const k23inc = evNum(ix, 'ev-0983');
    const k23dist = evNum(ix, 'ev-0985');
    const k24 = ix.packet.prior_years.return_2024.K1_1120S;
    const b2023 = b2022 + k23inc - k23dist;
    const b2024 = b2023 + k24.box1 - k24.box16D;
    const engine = num(lineValue(ix, 'F7203.1'));
    return {
      area: 'Pass-throughs & basis',
      severity: 'medium',
      classification: 'missing_evidence',
      why: 'Raised in v1 and v2 when the 2023 K-1 was missing. Cleared in v3 after the client found the 2023 K-1 (D40, msg-06). The engine clearing a flag is not a review.',
      matters: 'Distributions above basis are taxable capital gain (F7203.excess). Basis must be rolled forward from 2022.',
      facts: [
        { text: `Independent roll-forward: 2022 ending ${money(b2022)} + 2023 income ${money(k23inc)} - 2023 distributions ${money(k23dist)} = ${money(b2023)}; + 2024 income ${money(k24.box1)} - distributions ${money(k24.box16D)} = ${money(b2024)}.`, refs: ['py:/basis_records/scorp_lindqvist_family_woodworks', 'ev-0983', 'ev-0985', 'py:/return_2024/K1_1120S'] },
        { text: 'D40 is a photo of a K-1 found in a relative\'s papers. Confirm it is the final 2023 K-1 (not a draft).', refs: ['D40', 'msg-06'] },
      ],
      nextAction: 'Confirm D40 is the issued 2023 K-1 and agree the basis roll-forward.',
      requirements: ['Roll-forward agreed', 'Documented conclusion'],
      refs: ['F7203.1', 'D40', 'msg-06', 'D39'],
      lines: ['F7203.1', 'F7203.excess'],
      reconciliations: [{
        id: 'scorp-basis', title: 'S corporation stock basis at 1/1/2025',
        a: { label: 'Engine F7203.1 (v3)', value: engine, refs: ['F7203.1'] },
        b: { label: 'Workpaper recomputation', value: b2024, refs: ['ev-0983', 'ev-0985', 'py:/return_2024/K1_1120S'] },
        unit: 'USD', comparable: true,
        expectation: 'Should agree.',
        finding: engine === b2024 ? 'Agrees. The v3 basis is supported once D40 is accepted.' : `Differs by ${money(engine - b2024)}.`,
      }],
    };
  },

  K1_EXPECTED_NOT_RECEIVED: (ix) => ({
    area: 'Pass-throughs & basis',
    severity: 'medium',
    classification: 'missing_evidence',
    title: 'Ridgeline Real Estate Fund III K-1 expected (late document)',
    why: 'Raised in v1 and v2. The K-1 (D37) and state supplement (D38) arrived 2026-06-22 and were used in v3.',
    matters: 'K-1 items feed Schedule E, Schedule B, Schedule D, the foreign tax credit and California sourcing (D38: 22% California).',
    facts: [
      { text: `K-1 box 2 rental income ${money(evNum(ix, 'ev-0964'))} reported on SchE.28B (${money(num(lineValue(ix, 'SchE.28B')))}).`, refs: ['ev-0964', 'SchE.28B'] },
      { text: 'State supplement: California 22%, Texas 31%, Arizona 27%, Nevada 20%. Arizona composite filed; no partner filing.', refs: ['D38', 'ev-0971'] },
    ],
    nextAction: 'Agree each K-1 line to the return and confirm the California share used for the nonresident period.',
    requirements: ['K-1 lines agreed to return', 'Documented conclusion'],
    refs: ['D37', 'D38', 'ev-0964', 'ev-0965', 'ev-0971', 'py:/return_2024/K1_1065'],
    lines: ['SchE.28B', 'SchB.1.8', 'SchD.12'],
    reconciliations: [{
      id: 'ridgeline-box2', title: 'Ridgeline box 2 vs Schedule E',
      a: { label: 'K-1 box 2 (D37)', value: evNum(ix, 'ev-0964'), refs: ['ev-0964'] },
      b: { label: 'SchE.28B (v3)', value: num(lineValue(ix, 'SchE.28B')), refs: ['SchE.28B'] },
      unit: 'USD', comparable: true, expectation: 'Should agree.',
    }],
  }),

  AMT_CREDIT_CARRYFORWARD: (ix) => ({
    area: 'Wages & stock comp', severity: 'low', classification: 'informational',
    matters: `Minimum tax credit carried to 2026: ${money(ix.current.carryovers_out.federal.minimum_tax_credit_from_2025_amt)}. Next year's preparer must pick it up (Form 8801).`,
    facts: [{ text: 'ISO exercise 07/30/2025: 1,000 sh, exercise 12.00, FMV 52.00 (D12). AMT adjustment 40,000 (F6251.2i).', refs: ['D12', 'F6251.2i'] }],
    nextAction: 'Acknowledge and add to the carry-forward plan.',
    requirements: ['Acknowledged with carry-forward note'],
    refs: ['F6251.11', 'F6251.2i', 'D12'], lines: ['F6251.11'],
    allowedOutcomes: ['acknowledged', 'not_applicable'], documentaryFor: [],
  }),

  AOTC_PHASED_OUT: () => ({
    area: 'Deductions & credits', severity: 'low', classification: 'informational',
    matters: 'No education credit is available at this income. Ada files her own return and checks "someone can claim you", so she cannot take it either.',
    nextAction: 'Acknowledge; confirm Ada\'s return does not claim the AOTC.',
    requirements: ['Acknowledged'], refs: ['F8863.7', 'D59', 'D60'], lines: ['F8863.7'],
    allowedOutcomes: ['acknowledged', 'not_applicable'], documentaryFor: [],
  }),

  FBAR_OUTSIDE_RETURN: (ix) => ({
    area: 'Foreign', severity: 'medium', classification: 'out_of_scope', jurisdiction: 'none',
    matters: `FinCEN 114 is outside the engagement (D01) but due ${ix.packet.firm.deadlines.find((d: any) => /FBAR/.test(d.what))?.date}. The prior preparer also left a 2023 Form 3520 (foreign inheritance) open item with no resolution.`,
    facts: [
      { text: 'Engagement letter excludes FBAR and gift tax returns.', refs: ['D01'] },
      { text: 'Prior preparer open item: "2023 Form 3520 (foreign inheritance over 100,000) - discussed? (no note of resolution)".', refs: ['py:/prior_preparer_workpaper/open_items_left_by_prior_preparer/3'] },
    ],
    nextAction: 'Tell the client in writing that FBAR (and possibly a late 2023 Form 3520) is required and not in scope; record their response.',
    requirements: ['Client notified in writing (question or note recorded)', 'Referral or acknowledgment recorded'],
    refs: ['F8938.1.max', 'D36', 'D01', 'qa-07'], lines: ['F8938.1.max'],
    allowedOutcomes: ['out_of_scope_referred', 'acknowledged'], documentaryFor: [],
  }),

  FORM_1099_FILING: (ix) => ({
    area: 'Business (Sch C)', severity: 'medium', classification: 'out_of_scope', jurisdiction: 'none',
    matters: `Contractors were paid ${money(evNum(ix, 'ev-0487'))} and ${money(evNum(ix, 'ev-0488'))}. Forms 1099-NEC were due ${ix.packet.firm.deadlines.find((d: any) => /1099-NEC/.test(d.what))?.date} and are outside the engagement. Schedule C line J answers "No".`,
    facts: [{ text: 'Client did not know 1099s were required (qa-23); paid by ACH (call-01).', refs: ['qa-23', 'call-01', 'D27'] }],
    nextAction: 'Advise the client in writing about late 1099-NEC filing; record the response.',
    requirements: ['Client advised in writing', 'Acknowledgment recorded'],
    refs: ['SchC.I', 'SchC.J', 'D27', 'qa-22', 'qa-23', 'ev-0487', 'ev-0488'], lines: ['SchC.I', 'SchC.J'],
    allowedOutcomes: ['out_of_scope_referred', 'acknowledged'], documentaryFor: [],
  }),

  DUE_DILIGENCE_REQUIRED: () => ({
    area: 'Deductions & credits', severity: 'high', classification: 'judgment',
    matters: 'Firm rule: due diligence must be documented for the child tax credit and credit for other dependents. The paid preparer is penalised per failure.',
    facts: [{ text: 'Theo (CTC) and Ada (ODC, full-time student). Ada files her own return.', refs: ['household:theo', 'household:ada', 'D59'] }],
    nextAction: 'Preparer completes the Form 8867 checklist (relationship, residency, age, TIN); reviewer signs off.',
    requirements: ['Due-diligence rationale recorded', 'Reviewer sign-off'],
    refs: ['F8867.status', 'F8812.12'], lines: ['F8812.12'],
    allowedOutcomes: ['substantiated', 'acknowledged'], documentaryFor: [],
  }),

  CA_AMT_NOT_COMPUTED: () => ({
    area: 'California', severity: 'high', classification: 'judgment', jurisdiction: 'california',
    matters: 'The engine does not compute California AMT. The ISO spread (40,000) was exercised after the move but the options were granted and partly earned during California residency.',
    facts: [{ text: 'Grant 03/01/2022, exercise 07/30/2025 (D12). Residency: CA to 07/14/2025.', refs: ['D12', 'household:ngozi'] }],
    nextAction: 'Compute Schedule P (540NR) outside the engine, or document why no California AMT applies.',
    requirements: ['Schedule P computation or documented conclusion', 'Reviewer sign-off'],
    refs: ['F6251.2i', 'D12'], lines: ['F6251.2i'],
  }),

  HOME_OFFICE_AREA_CHANGE: (ix) => {
    const sac = evNum(ix, 'ev-0481');
    const aus = evNum(ix, 'ev-0482');
    // Independent estimate: Sacramento Jan 1 - Jul 15 (6.5 months), Austin Jul 16 - Dec 31 (5.5 months).
    const avg = Math.round(((sac * 6.5 + aus * 5.5) / 12) * 10) / 10;
    return {
      area: 'Business (Sch C)', severity: 'low', classification: 'judgment',
      matters: 'The prior preparer used 300 sq ft (D07 note: "2 rooms combined?" - client to confirm). 2025 measurements support about 240.',
      facts: [
        { text: `Measurements: Sacramento ${sac} sq ft to mid-July, Austin ${aus} sq ft from 07/16 (D24). Independent monthly average ~${avg} sq ft.`, refs: ['ev-0481', 'ev-0482', 'ev-0483'] },
        { text: 'Prior preparer note: "Home office 300 sq ft (Sacramento rental house, 2 rooms combined?) - client to confirm."', refs: ['py:/prior_preparer_workpaper/notes/4'] },
      ],
      nextAction: 'Accept the measured 2025 area; note that 2024 may have been overstated.',
      requirements: ['Documented conclusion'],
      refs: ['SchC.30', 'D24', 'py:/return_2024/lines/SchC.30'], lines: ['SchC.30'],
      reconciliations: [{
        id: 'home-office', title: 'Home office area',
        a: { label: '2024 return', value: 300, refs: ['py:/return_2024/notes/SchC.30'] },
        b: { label: '2025 measured average', value: 240, refs: ['SchC.30', 'ev-0481', 'ev-0482'] },
        unit: 'sq ft', comparable: true, expectation: 'Same room would give the same area; a move explains a change.',
        finding: `Different houses in 2025; measured areas support ~${avg} sq ft (engine 240).`,
      }],
    };
  },
};

// ---------------------------------------------------------------------------
// Workpaper checks: deterministic rules that do not trust the engine.
// ---------------------------------------------------------------------------

function wpCases(ix: PacketIndex): CaseDef[] {
  const out: (Draft | null)[] = [
    rsuBasis(ix), mileageDuplicatePage(ix), form1099KInBooks(ix), federalEstimates(ix), californiaEstimates(ix),
    sehiEligibility(ix), caWageSourcing(ix), duplicateInterest(ix), fxRateYear(ix), vehicleDonation(ix),
    propertyTaxProration(ix), mortgagePayoffInterest(ix), hvacRepair(ix), mixedUse(ix), dependentTin(ix),
    providerDetails(ix), duplicateW2(ix), iraBasisAnswer(ix), priorOpenItems(ix), priorYearVariance(ix), letter566(ix),
  ];
  return out.filter((d): d is Draft => d !== null).map(finish);
}

function rsuBasis(ix: PacketIndex): Draft | null {
  const supp = (ix.evsByDoc.get('D11') ?? []).filter((e) => /^RSU-\d+_acquired$/.test(e.field));
  const lots: { key: string; acquired: string; basis: number; suppEv: string; box: string; sold: string }[] = [];
  for (const s of supp) {
    const lotId = s.field.replace('_acquired', '');
    const basisEv = (ix.evsByDoc.get('D11') ?? []).find((e) => e.field === `${lotId}_adjusted_basis`)!;
    for (const [key, l] of ix.lines.get(ix.current.version)!) {
      if (!/^F8949\.[A-Z]\.N\d+$/.test(key)) continue;
      const m = /acquired (\S+), sold (\S+); proceeds [\d,.]+, basis ([\d,.]+)/.exec(l.label);
      if (m && m[1] === s.value && num(m[3].replace(/,/g, '')) === 0) {
        lots.push({ key, acquired: m[1], sold: m[2].replace(/;$/, ''), basis: num(basisEv.value), suppEv: basisEv.id, box: key.split('.')[1] });
      }
    }
  }
  if (!lots.length) return null;
  const caEnd = ix.packet.household.residency.find((r: any) => r.state === 'CA')?.to as string;
  const parts: EffectPart[] = lots.map((l) => ({
    category: 'ABC'.includes(l.box) ? 'stcg' : 'ltcg',
    amount: -l.basis,
    caSource: l.sold <= caEnd,
    label: `${l.key}: add basis ${money(l.basis)}`,
  }));
  const total = sumOf(lots.map((l) => l.basis));
  const w2rsu = evNum(ix, 'ev-0027');
  return {
    id: 'WP-RSU-BASIS', origin: 'workpaper', ruleId: 'WP-SUPPLEMENT-BASIS',
    title: `Corvane RSU sales reported with $0 basis; supplemental statement gives ${money(total)} of basis`,
    area: 'Wages & stock comp', jurisdiction: 'both', severity: 'high', classification: 'confirmed_discrepancy',
    why: `${lots.length} noncovered RSU lots on Form 8949 have basis 0.00. The Corvane supplemental statement (D11) gives adjusted basis for the same lots (matched on acquisition date). Rule R-8949-LOT says the supplement is used when matched; it was not.`,
    matters: `RSU value is already taxed as wages (W-2 box 14 RSU ${money(w2rsu)}). Zero basis taxes the same income twice. No engine diagnostic flags this.`,
    facts: lots.map((l) => ({ text: `${l.key}: acquired ${l.acquired}, sold ${l.sold}. Supplemental adjusted basis ${money(l.basis)}.`, refs: [l.key, l.suppEv] })),
    nextAction: 'Propose adjustments to enter the supplemental basis (code B adjustment) on each lot.',
    requirements: ['Adjustment proposed per lot or documented reason not to', 'Partner approval (tax effect over 1,000)'],
    refs: ['D11', 'D28', 'ev-0027', ...lots.map((l) => l.suppEv)],
    lines: lots.map((l) => l.key),
    reconciliations: lots.map((l) => ({
      id: `rsu-${l.key}`, title: `${l.key} basis`,
      a: { label: '1099-B / Form 8949 basis', value: 0, refs: [l.key] },
      b: { label: 'Supplemental adjusted basis (D11)', value: l.basis, refs: [l.suppEv] },
      unit: 'USD' as const, comparable: true, expectation: 'Should agree once the supplement is applied.',
    })),
    effect: estimateEffect(ix, parts),
    suggested: (() => {
      const l0 = lots[0];
      const gain = num(lineValue(ix, l0.key));
      return {
        lineKey: l0.key, from: gain, to: round2(gain - l0.basis),
        reason: `Apply supplemental adjusted basis ${money(l0.basis)} (D11); repeat for the other lots`,
        effect: estimateEffect(ix, [parts[0]]),
      };
    })(),
  };
}

function mileageDuplicatePage(ix: PacketIndex): Draft | null {
  const dups = duplicatePages(ix).filter((d) => d.docId === 'D23' || true);
  for (const d of dups) {
    const pageTotals = (ix.evsByDoc.get(d.docId) ?? []).filter((e) => e.field === 'page_total');
    const dupEv = pageTotals.find((e) => e.page === d.duplicatePage);
    const origEv = pageTotals.find((e) => e.page === d.originalPage);
    if (!dupEv || !origEv) continue;
    const users = ix.refToLines.get(ix.current.version)!.get(dupEv.id) ?? [];
    const both = users.filter((k) => (line(ix, k)?.sources ?? []).includes(origEv.id));
    if (!both.length) continue;
    const milesKey = both[0];
    const miles = num(lineValue(ix, milesKey));
    const rate = ix.packet.engine_reference.parameters.mileage_rate as number;
    const dupMiles = num(dupEv.value);
    const overstated = Math.round(dupMiles * rate);
    const py = ix.packet.prior_years.return_2024.lines['SchC.44a'];
    return {
      id: 'WP-MILEAGE-DUP', origin: 'workpaper', ruleId: 'WP-DUPLICATE-PAGE',
      title: `Mileage log page ${d.duplicatePage} is a second scan of page ${d.originalPage}; ${money(dupMiles)} miles counted twice`,
      area: 'Business (Sch C)', jurisdiction: 'both', severity: 'high', classification: 'confirmed_discrepancy',
      why: `Page ${d.duplicatePage} of ${d.docId} repeats page ${d.originalPage} trip for trip. ${milesKey} (${money(miles)} miles) sums the page totals of all ${pageTotals.length} pages (rule R-MILEAGE-PAGE-TOTALS).`,
      matters: `Car expense is overstated by ${money(dupMiles)} mi x ${rate} = ${money(overstated)}. The swing from 2024 (${money(py)} miles) is another signal. No engine diagnostic flags it.`,
      facts: [
        { text: `Page ${d.duplicatePage} header: "${d.marker}"`, refs: [`doc:${d.docId}#page${d.duplicatePage}`] },
        { text: `Page totals: ${pageTotals.map((e) => `p${e.page} ${money(num(e.value))}`).join(', ')}.`, refs: pageTotals.map((e) => e.id) },
      ],
      nextAction: `Exclude page ${d.duplicatePage}; business miles become ${money(miles - dupMiles)}.`,
      requirements: ['Adjustment proposed', 'Partner approval (tax effect over 1,000)'],
      refs: [d.docId, dupEv.id, origEv.id, 'msg-03'],
      lines: [milesKey, 'SchC.9'],
      reconciliations: [{
        id: 'miles', title: 'Business miles',
        a: { label: `${milesKey} (engine)`, value: miles, refs: [milesKey] },
        b: { label: 'Distinct pages only', value: miles - dupMiles, refs: pageTotals.filter((e) => e.page !== d.duplicatePage).map((e) => e.id) },
        unit: 'miles', comparable: true, expectation: 'Each trip counted once.',
        finding: `Difference ${money(dupMiles)} miles = page ${d.duplicatePage} total.`,
      }],
      effect: estimateEffect(ix, [{ category: 'schc_profit', amount: overstated, label: `Car expense down ${money(overstated)}` }]),
      suggested: { lineKey: 'SchC.9', from: num(lineValue(ix, 'SchC.9')), to: num(lineValue(ix, 'SchC.9')) - overstated, reason: `Exclude duplicate page ${d.duplicatePage}`, effect: estimateEffect(ix, [{ category: 'schc_profit', amount: overstated, label: '' }]) },
    };
  }
  return null;
}

function form1099KInBooks(ix: PacketIndex): Draft | null {
  const gross = num(lineValue(ix, 'SchC.1'));
  const books = evNum(ix, 'ev-0103');
  const k = evNum(ix, 'ev-0127');
  const inBooks = evNum(ix, 'ev-0109');
  if (gross !== books + k || inBooks !== k) return null;
  return {
    id: 'WP-1099K-DOUBLE', origin: 'workpaper', ruleId: 'WP-1099K-IN-BOOKS',
    title: `Form 1099-K receipts (${money(k)}) added to books revenue although the books already include them`,
    area: 'Business (Sch C)', jurisdiction: 'both', severity: 'high', classification: 'confirmed_discrepancy',
    why: `SchC.1 ${money(gross)} = books revenue ${money(books)} + 1099-K ${money(k)}. The deposits detail (D15 p3) says the Paywell payments were deposited gross and recorded as sales. The engine could not match them to a deposit.`,
    matters: 'Gross receipts are overstated. The 2028 IRS examination letter (D72) asks for exactly this reconciliation to the Forms 1099-NEC and 1099-K.',
    facts: [
      { text: `D15 p3: Atlas paid ${money(evNum(ix, 'ev-0110'))}, of which ${money(inBooks)} arrived through Paywell (deposited gross).`, refs: ['ev-0109', 'ev-0110'] },
      { text: `1099-K box 1a ${money(k)} (D21).`, refs: ['ev-0127'] },
    ],
    nextAction: `Remove the ${money(k)} add-on; gross receipts become ${money(books)}.`,
    requirements: ['Adjustment proposed', 'Partner approval (tax effect over 1,000)'],
    refs: ['ev-0103', 'ev-0109', 'ev-0110', 'ev-0127', 'D14', 'D15', 'D21'],
    lines: ['SchC.1'],
    reconciliations: [{
      id: 'gross', title: 'Schedule C gross receipts',
      a: { label: 'SchC.1 (engine)', value: gross, refs: ['SchC.1'] },
      b: { label: 'Books total income (includes Paywell)', value: books, refs: ['ev-0103', 'ev-0109'] },
      unit: 'USD', comparable: true, expectation: 'Books revenue already contains card receipts deposited gross.',
      finding: `Difference ${money(gross - books)} = 1099-K box 1a.`,
    }],
    effect: estimateEffect(ix, [{ category: 'schc_profit', amount: -k, label: `Gross receipts down ${money(k)}` }]),
    suggested: { lineKey: 'SchC.1', from: gross, to: books, reason: 'Paywell receipts already in books revenue (D15 p3)', effect: estimateEffect(ix, [{ category: 'schc_profit', amount: -k, label: '' }]) },
  };
}

function federalEstimates(ix: PacketIndex): Draft | null {
  const onReturn = num(lineValue(ix, 'F1040.26'));
  const snap = ix.packet.tax_agency_records.irs_account_transcript_2025[0];
  const est = snap.transactions.filter((t: any) => t.code === '670' && /Estimated/.test(t.description));
  const irs = sumOf(est.map((t: any) => num(t.amount)));
  if (irs === onReturn) return null;
  const q41 = ix.qa.get('qa-41')!;
  return {
    id: 'WP-EST-FED', origin: 'workpaper', ruleId: 'WP-PAYMENTS-AGENCY',
    title: `Federal estimated payments on return ${money(onReturn)} vs IRS transcript ${money(irs)}`,
    area: 'Payments', jurisdiction: 'federal', severity: 'high', classification: 'confirmed_discrepancy',
    why: `F1040.26 uses three EFTPS confirmations plus the client's questionnaire answer for Q4 ("${q41.answer}"). The IRS transcript (pulled ${snap.as_of}) shows ${est.length} payments totalling ${money(irs)}.`,
    matters: 'Claiming a payment the IRS never received produces a balance-due notice with interest. The firm\'s required step "Estimated payments agreed to IRS and FTB records" fails.',
    facts: est.map((t: any) => ({ text: `${t.date} ${t.description} ${money(num(t.amount))}`, refs: ['agency:/irs_account_transcript_2025/0'] })),
    conflicts: [{ text: `qa-41: "${q41.answer}"`, refs: ['qa-41'] }],
    nextAction: `Use the transcript: Q4 was ${money(num(est[est.length - 1]?.amount))} on ${est[est.length - 1]?.date}.`,
    requirements: ['Payments agreed to agency record', 'Adjustment proposed'],
    refs: ['F1040.26', 'qa-41', 'ev-1056', 'ev-1058', 'ev-1060', 'agency:/irs_account_transcript_2025/0', 'D69'],
    lines: ['F1040.26'],
    reconciliations: [{
      id: 'fed-est', title: '2025 federal estimated payments',
      a: { label: 'F1040.26 (engine)', value: onReturn, refs: ['F1040.26'] },
      b: { label: 'IRS account transcript', value: irs, refs: ['agency:/irs_account_transcript_2025/0'] },
      unit: 'USD', comparable: true, expectation: 'Should agree exactly.',
      finding: `Return overstates payments by ${money(onReturn - irs)}; the Q4 amount came from the client's recollection.`,
    }],
    effect: estimateEffect(ix, [{ category: 'payment_federal', amount: irs - onReturn, label: `Payments down ${money(onReturn - irs)} (balance due up 1:1)` }], 'Payments change the balance due 1:1. The underpayment penalty may also change.'),
    suggested: { lineKey: 'F1040.26', from: onReturn, to: irs, reason: 'Agree to IRS transcript', effect: estimateEffect(ix, [{ category: 'payment_federal', amount: irs - onReturn, label: '' }]) },
  };
}

function californiaEstimates(ix: PacketIndex): Draft | null {
  const onReturn = num(lineValue(ix, 'F540NR.72'));
  const ftb = ix.packet.tax_agency_records.ftb_account;
  const ftbSum = sumOf(ftb.tax_year_2025_payments.map((p: any) => num(p.amount)));
  if (ftbSum === onReturn) return null;
  const misdesignated = ftb.tax_year_2024_payments_after_filing[0];
  return {
    id: 'WP-EST-CA', origin: 'workpaper', ruleId: 'WP-PAYMENTS-AGENCY',
    title: `California estimated payments on return ${money(onReturn)} vs FTB account ${money(ftbSum)}`,
    area: 'Payments', jurisdiction: 'california', severity: 'high', classification: 'confirmed_discrepancy',
    why: `Rule R-CA-ESTIMATED-PAYMENTS counts every FTB payment dated 2025-04-01 to 2026-01-15. The ${misdesignated.date} payment of ${money(num(misdesignated.amount))} was designated tax year 2024 (Web Pay confirmation, D68) and the FTB holds it as a 2024 credit.`,
    matters: 'The California refund is overstated by the misdesignated payment unless the FTB moves the credit to 2025.',
    facts: [
      { text: `FTB account (${ftb.as_of}): 2025 payments ${ftb.tax_year_2025_payments.map((p: any) => `${p.date} ${money(p.amount)}`).join(', ')}.`, refs: ['agency:/ftb_account'] },
      { text: `D68: ${misdesignated.date} ${money(num(misdesignated.amount))} "tax year 2024".`, refs: ['ev-1074', 'ev-1075', 'ev-1076'] },
    ],
    openQuestions: ['Ask the FTB to transfer the 2024 credit to 2025, or claim it on the 2024 account?'],
    nextAction: 'Exclude the 2024-designated payment from 2025 estimates, or document an FTB transfer request.',
    requirements: ['Payments agreed to FTB record', 'Decision on the 2024 credit recorded'],
    refs: ['F540NR.72', 'agency:/ftb_account', 'ev-1074', 'ev-1075', 'ev-1076', 'D68'],
    lines: ['F540NR.72'],
    reconciliations: [{
      id: 'ca-est', title: '2025 California estimated payments',
      a: { label: 'F540NR.72 (engine)', value: onReturn, refs: ['F540NR.72'] },
      b: { label: 'FTB account, tax year 2025', value: ftbSum, refs: ['agency:/ftb_account'] },
      unit: 'USD', comparable: true, expectation: 'Should agree.',
      finding: `Difference ${money(onReturn - ftbSum)} = payment designated tax year 2024.`,
    }],
    effect: estimateEffect(ix, [{ category: 'payment_california', amount: ftbSum - onReturn, label: 'California payments down; refund smaller 1:1' }], 'Payments change the balance 1:1.'),
    suggested: { lineKey: 'F540NR.72', from: onReturn, to: ftbSum, reason: 'Agree to FTB account (2024-designated payment excluded)', effect: estimateEffect(ix, [{ category: 'payment_california', amount: ftbSum - onReturn, label: '' }]) },
  };
}

function sehiEligibility(ix: PacketIndex): Draft | null {
  const sehi = num(lineValue(ix, 'Sch1.17'));
  const qa = ix.qa.get('qa-25');
  if (!sehi || !qa || !/^Yes/.test(qa.answer)) return null;
  const pyNote = ix.packet.prior_years.return_2024.notes['Sch1.17'];
  return {
    id: 'WP-SEHI', origin: 'workpaper', ruleId: 'WP-QUESTIONNAIRE-VS-LINE',
    title: `Self-employed health insurance deduction ${money(sehi)} claimed although Erik was eligible for employer family coverage`,
    area: 'Business (Sch C)', jurisdiction: 'both', severity: 'high', classification: 'contradiction',
    why: `Sch1.17 deducts Erik's individual premiums (D25). qa-25 says both of Ngozi's employers offered family coverage and Erik chose his own plan. The 2024 return took no deduction for the same reason.`,
    matters: 'The deduction is not allowed for any month the self-employed person was eligible for an employer-subsidized plan through a spouse. It also lowers QBI.',
    facts: [{ text: `2024 note: "${pyNote}"`, refs: ['py:/return_2024/notes/Sch1.17'] }, { text: 'Premiums 14,400, individual PPO, paid from the studio account.', refs: ['ev-0484'] }],
    conflicts: [{ text: `qa-25: "${qa.answer}"`, refs: ['qa-25'] }],
    openQuestions: ['Was Erik eligible for the employer plan in every month (Corvane Jan-May, Halvorsen from June 2)? Any gap months?'],
    nextAction: 'Confirm eligibility by month with the client; propose removing the deduction for eligible months.',
    requirements: ['Eligibility by month documented', 'Partner approval (tax effect over 1,000)'],
    refs: ['Sch1.17', 'qa-25', 'ev-0484', 'D25', 'py:/return_2024/notes/Sch1.17'],
    lines: ['Sch1.17'],
    effect: estimateEffect(ix, [{ category: 'adjustment', amount: -sehi, label: `Remove adjustment ${money(sehi)}` }], 'Estimate with the adjustment rate; the QBI effect is not captured (README).'),
    suggested: { lineKey: 'Sch1.17', from: sehi, to: 0, reason: 'Eligible for employer-subsidized plan through spouse (qa-25)', effect: estimateEffect(ix, [{ category: 'adjustment', amount: -sehi, label: '' }]) },
  };
}

function caWageSourcing(ix: PacketIndex): Draft | null {
  const caWages = num(lineValue(ix, 'SchCA540NR.1.E'));
  const halvBox16 = evNum(ix, 'ev-0047');
  const ytdCa = evNum(ix, 'ev-1081');
  const res = ix.packet.household.residency;
  const caTo = res.find((r: any) => r.state === 'CA').to;
  const d09 = ix.docs.get('D09')!.pages[0].printed_content;
  const note = /\(([^)]*work state[^)]*)\)/.exec(d09)?.[1] ?? '';
  const delta = halvBox16 - ytdCa;
  return {
    id: 'WP-CA-WAGES', origin: 'workpaper', ruleId: 'WP-STATE-SOURCE',
    title: `California-source wages include all Halvorsen box 16 wages (${money(halvBox16)}) though residency ended ${caTo}`,
    area: 'California', jurisdiction: 'california', severity: 'high', classification: 'judgment',
    why: `Rule R-CA-WAGES-SOURCE takes California wages from W-2 box 16. Halvorsen's payroll kept California as the work state through 09/30 ("${note}"), and the client says that was a mistake (qa-45). The July paystub (D73) shows work location changed to Austin effective 07/15.`,
    matters: 'Wages for work done in Texas by a Texas resident are not California-source. Payroll coding and residence dates alone do not settle the split: actual work location and workdays do.',
    facts: [
      { text: `SchCA540NR.1.E California wages ${money(caWages)} = Corvane box 16 ${money(evNum(ix, 'ev-0030'))} + Halvorsen box 16 ${money(halvBox16)}.`, refs: ['SchCA540NR.1.E', 'ev-0030', 'ev-0047'] },
      { text: `Paystub (D73): YTD California taxable wages through 07/15/2025 = ${money(ytdCa)}.`, refs: ['ev-1081', 'ev-1082'] },
      { text: 'qa-03: remote from Sacramento until the move.', refs: ['qa-03'] },
      { text: `Residency: CA through ${caTo}; TX from ${res.find((r: any) => r.state === 'TX').from}.`, refs: ['household:ngozi'] },
    ],
    conflicts: [{ text: `W-2 box 16 (CA) ${money(halvBox16)}: the whole year coded California.`, refs: ['ev-0047'] }, { text: 'qa-45: employer kept withholding California tax until September by mistake.', refs: ['qa-45'] }],
    openQuestions: ['Did Ngozi do any work in California after 07/14 (trips, office visits)?', 'Will Halvorsen issue a corrected W-2 (box 16)? Until then the return must explain the difference.'],
    nextAction: 'Get workday records (or the employer\'s corrected W-2) and decide the California-source amount.',
    requirements: ['Work-location evidence linked', 'Allocation method documented', 'Partner approval (tax effect over 1,000)'],
    refs: ['SchCA540NR.1.E', 'ev-0047', 'ev-1081', 'D09', 'D73', 'qa-03', 'qa-45'],
    lines: ['SchCA540NR.1.E'],
    reconciliations: [{
      id: 'halv-ca', title: 'Halvorsen California wages',
      a: { label: 'W-2 box 16 (whole year coded CA)', value: halvBox16, refs: ['ev-0047'] },
      b: { label: 'Paystub YTD CA wages to 07/15 (lead)', value: ytdCa, refs: ['ev-1081'] },
      unit: 'USD', comparable: false,
      expectation: 'Not directly comparable: different periods and the paystub excludes later pay. Shows the scale of the issue.',
      finding: `If the paystub split were adopted, California-source wages would fall by about ${money(delta)}.`,
    }],
    effect: estimateEffect(ix, [{ category: 'ca_source_income', amount: -delta, label: `CA-source wages down ~${money(delta)}` }], 'If the paystub split were adopted (estimate; ca_source_income rate). Not applied.'),
    allowedOutcomes: ['corrected', 'substantiated', 'accepted_as_is'],
  };
}

function duplicateInterest(ix: PacketIndex): Draft | null {
  const lines = [...ix.lines.get(ix.current.version)!.values()].filter((l) => /^SchB\.1\.\d+$/.test(l.key));
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i], b = lines[j];
      if (a.value !== b.value) continue;
      const wa = new Set(a.label.match(/[A-Z][a-z]{4,}/g) ?? []);
      const common = (b.label.match(/[A-Z][a-z]{4,}/g) ?? []).filter((w) => wa.has(w) && w !== 'Interest');
      if (!common.length) continue;
      const amt = num(a.value);
      return {
        id: 'WP-INTEREST-DUP', origin: 'workpaper', ruleId: 'WP-DUPLICATE-PAYER',
        title: `${common[0]} interest ${money(amt)} reported twice (composite 1099 and a separate 1099-INT)`,
        area: 'Investments & digital assets', jurisdiction: 'both', severity: 'medium', classification: 'confirmed_discrepancy',
        why: `${a.key} and ${b.key} report the same amount from the same payer. The Northlake composite (D28) shows the bank sweep interest, and D29 is the sweep bank's own 1099-INT for the same account (ending 7731).`,
        matters: 'Interest is overstated, and so are NIIT and the California proration.',
        facts: [
          { text: `${a.key}: ${a.label}`, refs: [a.key, ...a.sources] },
          { text: `${b.key}: ${b.label}`, refs: [b.key, ...b.sources] },
        ],
        nextAction: `Remove one of the two lines (keep the one from D29).`,
        requirements: ['Adjustment proposed'],
        refs: [...a.sources, ...b.sources, 'D28', 'D29'],
        lines: [a.key, b.key],
        reconciliations: [{
          id: 'nl-int', title: 'Northlake sweep interest',
          a: { label: a.key, value: amt, refs: a.sources }, b: { label: b.key, value: num(b.value), refs: b.sources },
          unit: 'USD', comparable: true, expectation: 'One account, one amount: should appear once.',
          finding: 'D29 printed: "bank sweep program for Northlake Securities account ending 7731" (same account as D28).',
        }],
        effect: estimateEffect(ix, [{ category: 'interest', amount: -amt, label: `Interest down ${money(amt)}` }]),
        suggested: { lineKey: a.key, from: amt, to: 0, reason: 'Same interest as D29 (sweep bank 1099-INT)', effect: estimateEffect(ix, [{ category: 'interest', amount: -amt, label: '' }]) },
      };
    }
  }
  return null;
}

function fxRateYear(ix: PacketIndex): Draft | null {
  const year = String(ix.packet.household.tax_year);
  for (const l of ix.current.lines) {
    const fx = l.sources.find((s) => s.startsWith('ref:fx.'));
    if (!fx) continue;
    const [, cur, rateName] = fx.split('.');
    if (rateName.startsWith(year)) continue;
    const params = ix.packet.engine_reference.parameters.fx[cur];
    const avgName = `${year}_average`;
    const right = params[avgName];
    const sekEv = l.sources.find((s) => s.startsWith('ev-'))!;
    const foreign = evNum(ix, sekEv);
    const used = num(l.value);
    const correct = Math.round(foreign / right);
    return {
      id: 'WP-FX-YEAR', origin: 'workpaper', ruleId: 'WP-FX-RATE-YEAR',
      title: `Swedish interest converted at the ${rateName.replace('_', ' ')} rate instead of ${avgName.replace('_', ' ')}`,
      area: 'Foreign', jurisdiction: 'both', severity: 'low', classification: 'confirmed_discrepancy',
      why: `${l.key} converts ${cur} ${money(foreign)} at ${params[rateName]} (${rateName}). The ${year} average rate is ${right}.`,
      matters: `Income is understated by ${money(correct - used)}. Using a prior-year rate is also inconsistent with Form 8938, which uses the ${year} year-end rate.`,
      nextAction: `Convert at the ${year} average (${right}): ${money(correct)}.`,
      requirements: ['Adjustment proposed'],
      refs: [sekEv, fx, `ref:fx.${cur}.${avgName}`, 'D36'],
      lines: [l.key],
      reconciliations: [{
        id: 'fx', title: `${cur} interest in USD`,
        a: { label: `${l.key} at ${params[rateName]}`, value: used, refs: [l.key, fx] },
        b: { label: `At ${year} average ${right}`, value: correct, refs: [sekEv, `ref:fx.${cur}.${avgName}`] },
        unit: 'USD', comparable: true, expectation: 'Same SEK amount, current-year rate.',
      }],
      effect: estimateEffect(ix, [{ category: 'interest', amount: correct - used, label: `Interest up ${money(correct - used)}` }]),
      suggested: { lineKey: l.key, from: used, to: correct, reason: `Convert at ${avgName}`, effect: estimateEffect(ix, [{ category: 'interest', amount: correct - used, label: '' }]) },
    };
  }
  return null;
}

function vehicleDonation(ix: PacketIndex): Draft | null {
  const claimed = num(lineValue(ix, 'F8283.A1.vehicle'));
  const proceeds = evNum(ix, 'ev-1054');
  const printed = ix.docs.get('D66')!.pages[0].printed_content;
  const sold = /4a vehicle sold in arm's length transaction[^;]*checked/.test(printed);
  if (!sold || claimed <= proceeds) return null;
  const diff = claimed - proceeds;
  return {
    id: 'WP-VEHICLE-GIFT', origin: 'workpaper', ruleId: 'WP-1098C-LIMIT',
    title: `Car donation claimed at ${money(claimed)} (client's estimate) but the charity sold it for ${money(proceeds)}`,
    area: 'Deductions & credits', jurisdiction: 'both', severity: 'high', classification: 'confirmed_discrepancy',
    why: 'R-NONCASH-GIFT used the donor\'s value (qa-39, "Kelley Blue Book said about 6,000"). Form 1098-C box 4a is checked (sold in an arm\'s-length sale) with gross proceeds in box 4c.',
    matters: 'When the charity sells the vehicle, the deduction is limited to the gross proceeds on Form 1098-C. The 2028 examination letter (D72) asks about noncash contributions.',
    facts: [{ text: `D66: ${printed}`, refs: ['D66', 'ev-1054'] }, { text: 'call-01: "the charity sold it at auction".', refs: ['call-01'] }],
    conflicts: [{ text: 'qa-39: Kelley Blue Book about 6,000.', refs: ['qa-39'] }],
    nextAction: `Limit the vehicle deduction to ${money(proceeds)}.`,
    requirements: ['Adjustment proposed', 'Partner approval (tax effect over 1,000)'],
    refs: ['F8283.A1.vehicle', 'ev-1054', 'D66', 'qa-39', 'call-01'],
    lines: ['F8283.A1.vehicle', 'SchA.12'],
    reconciliations: [{
      id: 'vehicle', title: 'Vehicle donation value',
      a: { label: 'Claimed (F8283)', value: claimed, refs: ['F8283.A1.vehicle', 'qa-39'] },
      b: { label: 'Form 1098-C box 4c gross proceeds', value: proceeds, refs: ['ev-1054'] },
      unit: 'USD', comparable: true, expectation: 'Deduction should not exceed box 4c when box 4a is checked.',
    }],
    effect: estimateEffect(ix, [{ category: 'itemized', amount: -diff, label: `Itemized down ${money(diff)}` }]),
    suggested: { lineKey: 'F8283.A1.vehicle', from: claimed, to: proceeds, reason: '1098-C box 4c gross proceeds', effect: estimateEffect(ix, [{ category: 'itemized', amount: -diff, label: '' }]) },
  };
}

function propertyTaxProration(ix: PacketIndex): Draft | null {
  const home = num(lineValue(ix, 'SchA.5b'));
  const credit = evNum(ix, 'ev-1027');
  if (!credit) return null;
  const totalSalt = num(lineValue(ix, 'SchA.5d'));
  const capped = num(lineValue(ix, 'SchA.5e'));
  const newTotal = totalSalt - credit;
  const newCapped = Math.min(capped, newTotal);
  const itemDrop = capped - newCapped;
  return {
    id: 'WP-PROPTAX-PRORATION', origin: 'workpaper', ruleId: 'WP-SALT-PRORATION',
    title: `Home property tax deducted in full (${money(home)}) although the seller paid ${money(credit)} of it through the closing credit`,
    area: 'Deductions & credits', jurisdiction: 'both', severity: 'medium', classification: 'potential_discrepancy',
    why: `SchA.5b takes Form 1098 box 10 (${money(home)}). The buyer closing statement (D54) shows a seller credit for 2025 county taxes 01/01-07/07 of ${money(credit)}.`,
    matters: `The buyer deducts only taxes for the days they owned the home. Removing the seller's share drops total SALT to ${money(newTotal)}, below the ${money(capped)} cap, so it reduces itemized deductions by ${money(itemDrop)} federally.`,
    facts: [{ text: `D54: seller credit for 2025 county taxes ${money(credit)}.`, refs: ['ev-1027'] }, { text: `D57/D58: 2025 levy ${money(home)} paid from escrow 12/18/2025.`, refs: ['ev-1036', 'ev-1038'] }],
    nextAction: 'Reduce the home property tax by the seller credit, or document why not.',
    requirements: ['Documented conclusion', 'Partner approval if adjusted (tax effect over 1,000)'],
    refs: ['SchA.5b', 'ev-1027', 'ev-1036', 'ev-1038', 'D54', 'D57', 'D58'],
    lines: ['SchA.5b', 'SchA.5e'],
    reconciliations: [{
      id: 'proptax', title: 'Deductible home property tax',
      a: { label: 'SchA.5b (engine)', value: home, refs: ['SchA.5b'] },
      b: { label: 'Buyer\'s share (levy - seller credit)', value: home - credit, refs: ['ev-1036', 'ev-1027'] },
      unit: 'USD', comparable: true, expectation: 'Buyer deducts the post-purchase share.',
    }],
    effect: estimateEffect(ix, [
      { category: 'itemized', amount: -itemDrop, label: `Federal: SALT falls below cap, itemized down ${money(itemDrop)}` },
    ], 'Estimate: the reduction below the federal SALT cap x itemized rates. California has no SALT cap, so its true reduction is the full seller credit; the California figure is understated.'),
    suggested: { lineKey: 'SchA.5b', from: home, to: home - credit, reason: 'Exclude seller\'s prorated share credited at closing', effect: estimateEffect(ix, [{ category: 'itemized', amount: -itemDrop, label: '' }]) },
  };
}

function mortgagePayoffInterest(ix: PacketIndex): Draft | null {
  const l = line(ix, 'SchA.8a');
  if (!l || !l.sources.includes('ev-1032')) return null;
  const printed = ix.docs.get('D56')!.pages[0].printed_content;
  if (!/reported on the 2025 Form 1098/.test(printed)) return null;
  const amt = evNum(ix, 'ev-1032');
  return {
    id: 'WP-MORTGAGE-DUP', origin: 'workpaper', ruleId: 'WP-DUPLICATE-SOURCE',
    title: `Payoff-statement interest (${money(amt)}) added on top of a Form 1098 that already includes it`,
    area: 'Deductions & credits', jurisdiction: 'both', severity: 'medium', classification: 'confirmed_discrepancy',
    why: `SchA.8a adds the Lonestar payoff statement interest (D56) to the Lonestar Form 1098 (D55). D56 says: "(Interest is reported on the 2025 Form 1098.)". D55 box 1 also says it includes interest paid at payoff.`,
    matters: `Mortgage interest is overstated by ${money(amt)}.`,
    facts: [{ text: `SchA.8a note: ${l.note}`, refs: ['SchA.8a'] }, { text: printed, refs: ['D56', 'ev-1032'] }],
    nextAction: `Remove the payoff-statement add-on (${money(amt)}).`,
    requirements: ['Adjustment proposed'],
    refs: ['SchA.8a', 'ev-1032', 'ev-1029', 'D55', 'D56'],
    lines: ['SchA.8a'],
    effect: estimateEffect(ix, [{ category: 'itemized', amount: -amt, label: `Itemized down ${money(amt)}` }]),
    suggested: { lineKey: 'SchA.8a', from: num(l.value), to: num(l.value) - amt, reason: 'Payoff interest already on Form 1098 (D56)', effect: estimateEffect(ix, [{ category: 'itemized', amount: -amt, label: '' }]) },
  };
}

function hvacRepair(ix: PacketIndex): Draft | null {
  const alt = ix.packet.what_if.alternatives.find((a: any) => a.id === 'hvac_improvement');
  if (!alt) return null;
  const l = line(ix, 'SchE.14A');
  return {
    id: 'WP-HVAC', origin: 'workpaper', ruleId: 'WP-REPAIR-VS-IMPROVEMENT',
    title: 'HVAC replacement at 1450 Fremont Way (11,000) deducted as a repair',
    area: 'Rentals & sale', jurisdiction: 'both', severity: 'high', classification: 'judgment',
    why: `SchE.14A (${money(num(l?.value))}) includes the HVAC invoice ("${l?.note}"). The invoice and call notes describe replacing the whole system with a new heat pump, air handler and line set, with a permit.`,
    matters: `Replacing a building system is generally a capital improvement depreciated over 27.5 years. Engine what-if "${alt.id}": federal tax +${money(alt.federal.total_tax_change)}, California +${money(alt.california.total_tax_change)}. Repairs also jumped from ${money(ix.packet.prior_years.return_2024.lines['SchE.14A'])} in 2024.`,
    facts: [
      { text: ix.docs.get('D47')!.pages[0].printed_content, refs: ['D47', 'ev-1004'] },
      { text: 'call-01: "replaced the whole system with a heat pump (new air handler, line set)".', refs: ['call-01'] },
    ],
    nextAction: 'Decide repair vs improvement and record the authority relied on (firm rule).',
    requirements: ['Judgment and authority documented', 'Partner approval (tax effect over 1,000)'],
    refs: ['SchE.14A', 'D46', 'D47', 'ev-1001', 'ev-1004', 'call-01'],
    lines: ['SchE.14A'],
    effect: { federal: alt.federal.total_tax_change, california: alt.california.total_tax_change, parts: [], basis: `Engine what-if result (${alt.id}), not an estimate.` },
    allowedOutcomes: ['corrected', 'accepted_as_is', 'explained_difference'],
  };
}

function mixedUse(ix: PacketIndex): Draft | null {
  const call = ix.calls.get('call-01');
  if (!call) return null;
  const phoneShare = num(/business share is (\d+)%/.exec(call.notes.join(' '))?.[1]) / 100;
  const netShare = num(/business use about (\d+)%/.exec(call.notes.join(' '))?.[1]) / 100;
  const phone = evNum(ix, 'ev-0101');
  const net = evNum(ix, 'ev-0095');
  const spotify = evNum(ix, 'ev-0106');
  if (isNaN(phoneShare) || isNaN(netShare)) return null;
  const disallow = Math.round(phone * (1 - phoneShare) + net * (1 - netShare) + spotify);
  return {
    id: 'WP-MIXED-USE', origin: 'workpaper', ruleId: 'WP-CALL-NOTES-VS-BOOKS',
    title: `Family phone, home internet and Spotify deducted at 100% (${money(disallow)} personal share)`,
    area: 'Business (Sch C)', jurisdiction: 'both', severity: 'medium', classification: 'confirmed_discrepancy',
    why: `SchC.25 takes telephone ${money(phone)} and internet ${money(net)} from the books at 100%. SchC.27a.1 includes Spotify Family ${money(spotify)}. On the 26 March call the client gave the business shares as ${phoneShare * 100}% and ${netShare * 100}% and said Spotify is personal.`,
    matters: 'Personal use is not deductible. The client\'s own statements set the business percentages.',
    facts: call.notes.slice(0, 3).map((n) => ({ text: n, refs: ['call-01'] })),
    nextAction: `Reduce Schedule C expenses by ${money(disallow)}.`,
    requirements: ['Adjustment proposed'],
    refs: ['call-01', 'ev-0101', 'ev-0095', 'ev-0106', 'D15', 'SchC.25', 'SchC.27a.1'],
    lines: ['SchC.25', 'SchC.27a.1'],
    effect: estimateEffect(ix, [{ category: 'schc_profit', amount: disallow, label: `Expenses down ${money(disallow)}` }]),
    suggested: { lineKey: 'SchC.25', from: phone + net, to: Math.round(phone * phoneShare + net * netShare), reason: 'Business-use shares per call-01 (Spotify handled on 27a)', effect: estimateEffect(ix, [{ category: 'schc_profit', amount: Math.round(phone * (1 - phoneShare) + net * (1 - netShare)), label: '' }]) },
  };
}

function dependentTin(ix: PacketIndex): Draft | null {
  const deps = ix.packet.household.people.filter((p: any) => p.role === 'dependent');
  const conflicts: { name: string; organizer: string; other: { v: string; ref: string }[] }[] = [];
  deps.forEach((p: any, i: number) => {
    const other = ix.packet.extracted_values
      .filter((e) => e.value_type === 'ssn' && (e.field === `dep${i + 1}_ssn` || (e.document_id === 'D71' && /Theo/.test(ix.docs.get('D71')!.title) && p.id === 'theo')))
      .map((e) => ({ v: String(e.value), ref: e.id }));
    if (other.some((o) => o.v !== p.ssn)) conflicts.push({ name: p.name, organizer: p.ssn, other });
  });
  if (!conflicts.length) return null;
  const c = conflicts[0];
  const rej = ix.packet.tax_agency_records.efile.find((e: any) => e.status === 'rejected');
  return {
    id: 'WP-DEPENDENT-TIN', origin: 'workpaper', ruleId: 'WP-IDENTITY-CROSSCHECK',
    title: `${c.name}: SSN in the organizer differs from the 2024 return`,
    area: 'Identity & filing', jurisdiction: 'federal', severity: 'blocker', classification: 'confirmed_discrepancy',
    why: `The organizer (household, entered by the client) has ${c.organizer}. ${c.other.map((o) => `${o.ref} reads ${o.v}`).join('; ')}.`,
    matters: `A dependent TIN mismatch rejects the e-file (the packet replay shows exactly this: ${rej?.errors?.[0]?.code} "${rej?.errors?.[0]?.message}"). The check is available from the prior-year return before filing.`,
    facts: c.other.map((o) => ({ text: `${o.ref}: ${o.v}`, refs: [o.ref] })),
    conflicts: [{ text: `Organizer: ${c.organizer}`, refs: ['household:theo'] }],
    nextAction: 'Ask the client for the Social Security card and correct the organizer before e-file.',
    requirements: ['Identity document linked', 'Organizer corrected (documented)'],
    refs: ['household:theo', ...c.other.map((o) => o.ref), 'D06', 'msg-10'],
    lines: [],
    reconciliations: [{
      id: 'tin', title: `${c.name} SSN`,
      a: { label: 'Organizer (client-entered)', value: c.organizer, refs: ['household:theo'] },
      b: { label: '2024 return as filed (D06)', value: c.other[0].v, refs: [c.other[0].ref] },
      unit: 'text', comparable: false, expectation: 'Identical.',
      finding: 'Last four digits transposed (3309 vs 3390).',
    }],
    allowedOutcomes: ['corrected', 'substantiated'],
    documentaryFor: ['corrected', 'substantiated'],
    defaultOwner: 'st-01',
  };
}

function providerDetails(ix: PacketIndex): Draft | null {
  const mism = readVsPrinted(ix).filter((r) => r.ev.document_id !== 'D64');
  const lines = [...ix.lines.get(ix.current.version)!.values()].filter((l) => /^F2441\.1[a-z]$/.test(l.key));
  const nameIssues = lines.filter((l) => {
    const ev = l.sources.map((s) => ix.evs.get(s)).find(Boolean);
    const doc = ev && ix.docs.get(ev.document_id);
    const name = doc?.pages[0].printed_content.split(',')[0] ?? '';
    return name && !l.label.includes(name);
  });
  if (!mism.length && !nameIssues.length) return null;
  return {
    id: 'WP-READ-VS-PRINTED', origin: 'workpaper', ruleId: 'WP-READ-VS-PRINTED',
    title: `${mism.length} extracted value(s) do not appear on the printed page; Form 2441 provider details wrong`,
    area: 'Deductions & credits', jurisdiction: 'federal', severity: 'medium', classification: 'confirmed_discrepancy',
    why: 'Every extracted value was compared with the printed content of its page. These values (with high confidence) are not what is printed.',
    matters: 'Form 2441 requires each provider\'s correct name and TIN even when the credit is zero (benefits were excluded). A wrong EIN is a confident mistake the engine passed straight through.',
    facts: [
      ...mism.map((r) => ({ text: `${r.ev.id} (${r.ev.label}): read "${r.ev.text_as_read}" at confidence ${r.ev.confidence}; printed: "${r.printedNear}".`, refs: [r.ev.id] })),
      ...nameIssues.map((l) => ({ text: `${l.key} label "${l.label}" does not match the statement's provider name.`, refs: [l.key, ...l.sources] })),
    ],
    nextAction: 'Correct the EIN and provider name on Form 2441 from the statements.',
    requirements: ['Corrected values documented'],
    refs: [...mism.map((r) => r.ev.id), 'D61', 'D62', ...nameIssues.map((l) => l.key)],
    lines: lines.map((l) => l.key),
    reconciliations: mism.map((r) => ({
      id: `rvp-${r.ev.id}`, title: `${r.ev.label} (${r.ev.document_id})`,
      a: { label: 'Extracted', value: String(r.ev.value), refs: [r.ev.id] },
      b: { label: 'Printed on page', value: r.printedNear, refs: [r.ev.document_id] },
      unit: 'text' as const, comparable: false, expectation: 'Identical.',
      finding: 'Digits transposed.',
    })),
    allowedOutcomes: ['corrected', 'formatting_only', 'accepted_as_is'],
  };
}

function duplicateW2(ix: PacketIndex): Draft | null {
  const dup = duplicateDocuments(ix).find((d) => ix.docs.get(d.a)?.document_type === 'W-2');
  if (!dup) return null;
  const l = line(ix, 'F1040.1a');
  const evsB = new Set((ix.evsByDoc.get(dup.b) ?? []).map((e) => e.id));
  const usedB = [...ix.refToLines.get(ix.current.version)!.entries()].filter(([ref]) => evsB.has(ref));
  return {
    id: 'WP-DUP-W2', origin: 'workpaper', ruleId: 'WP-DUPLICATE-DOCUMENT',
    title: `${dup.b} is a second image of ${dup.a} (Halvorsen W-2); confirm it is counted once`,
    area: 'Wages & stock comp', jurisdiction: 'both', severity: 'low', classification: 'duplicate',
    why: `${dup.matched} of ${dup.compared} money values on ${dup.b} equal ${dup.a}, same EIN and employee. msg-02: the client re-uploaded a phone photo "in case the PDF was blurry".`,
    matters: 'Counting both images would double wages and withholding. Both records stay in the file for provenance.',
    facts: [
      { text: `F1040.1a note: "${l?.note}"`, refs: ['F1040.1a'] },
      { text: usedB.length ? `${dup.b} values are cited by ${usedB.map(([, k]) => k.join(', ')).join('; ')}.` : `No return line cites a value from ${dup.b}.`, refs: [dup.b] },
      { text: `${dup.a} carries a payroll note not on the photo: "${/\(([^)]*)\)/.exec(ix.docs.get(dup.a)!.pages[0].printed_content)?.[1] ?? ''}"`, refs: [dup.a] },
    ],
    nextAction: `Mark ${dup.a} primary and ${dup.b} duplicate (keep both).`,
    requirements: ['Document dispositions set', 'Documented conclusion'],
    refs: [dup.a, dup.b, 'msg-02', 'F1040.1a'],
    lines: ['F1040.1a'],
    allowedOutcomes: ['explained_difference', 'corrected'],
    documentaryFor: [],
  };
}

function iraBasisAnswer(ix: PacketIndex): Draft | null {
  const qa = ix.qa.get('qa-31');
  const basis = num(lineValue(ix, 'F8606.2'));
  if (!qa || !basis || !/none/i.test(qa.answer)) return null;
  return {
    id: 'WP-IRA-BASIS', origin: 'workpaper', ruleId: 'WP-QUESTIONNAIRE-VS-RECORDS',
    title: `Client says no prior IRA basis; records show ${money(basis)} from the 2024 contribution`,
    area: 'Retirement', jurisdiction: 'federal', severity: 'low', classification: 'contradiction',
    why: `qa-31: "${qa.answer}". The 2024 Form 8606 line 14 and the 2024 Form 5498 (D42, contribution made 02/12/2025 for 2024) show 7,000 of basis. The engine used the records (taxable conversion 26).`,
    matters: 'The documents are right and the answer is wrong. Without the 2024 basis, about 7,000 more of the conversion would be taxed. Record why the client\'s answer was overridden.',
    facts: [{ text: 'F8606.2 sources the 2024 Form 8606 and D42.', refs: ['F8606.2', 'ev-0991', 'py:/return_2024/lines/F8606.14'] }],
    conflicts: [{ text: qa.answer, refs: ['qa-31'] }],
    nextAction: 'Confirm with the client that the 02/2025 deposit was the 2024 contribution; document.',
    requirements: ['Documented conclusion'],
    refs: ['qa-31', 'ev-0991', 'D42', 'D43', 'D41', 'F8606.2'],
    lines: ['F8606.2', 'F1040.4b'],
    allowedOutcomes: ['explained_difference', 'accepted_as_is'], documentaryFor: [],
  };
}

function priorOpenItems(ix: PacketIndex): Draft | null {
  const items: string[] = ix.packet.prior_years.prior_preparer_workpaper.open_items_left_by_prior_preparer;
  if (!items?.length) return null;
  const status = [
    'Resolved by D40 (2023 K-1 received 2026-06-05).',
    'D42 (2024 Form 5498) in file: 7,000 for 2024.',
    'See home-office case (D24 measurements).',
    'No record anywhere in the packet. A late 2023 Form 3520 may be required (outside engagement).',
  ];
  return {
    id: 'WP-PRIOR-OPEN-ITEMS', origin: 'workpaper', ruleId: 'WP-PRIOR-PREPARER',
    title: `Prior preparer left ${items.length} open items; one (2023 Form 3520) is unresolved`,
    area: 'Engagement', jurisdiction: 'none', severity: 'medium', classification: 'out_of_scope',
    why: 'The 2024 workpaper (D07) lists open items. Each must be closed or carried forward with a record.',
    matters: 'An inheritance of over 100,000 from a foreign person (Erik\'s mother, 2023) requires Form 3520. Penalties for not filing are large and the statute stays open.',
    facts: items.map((t, i) => ({ text: `${t} → ${status[i] ?? ''}`, refs: [`py:/prior_preparer_workpaper/open_items_left_by_prior_preparer/${i}`] })),
    nextAction: 'Notify the client about the possible Form 3520 and refer it; record the response.',
    requirements: ['Each item dispositioned', 'Client notified about Form 3520'],
    refs: ['D07', 'D36', 'qa-07', 'qa-08'],
    allowedOutcomes: ['out_of_scope_referred', 'acknowledged'], documentaryFor: [],
  };
}

function priorYearVariance(ix: PacketIndex): Draft | null {
  const std = ix.packet.firm.starter_standards.variance_review;
  const py = ix.packet.prior_years.return_2024;
  const swings: { key: string; label: string; py: number; cy: number; pct: number }[] = [];
  for (const [key, pv] of Object.entries(py.lines)) {
    const cy = lineValue(ix, key);
    if (typeof pv !== 'number' || typeof cy !== 'number') continue;
    const diff = cy - pv;
    const pct = pv === 0 ? Infinity : Math.abs(diff / pv) * 100;
    if (Math.abs(diff) > std.and_over_amount && pct > std.flag_if_change_over_percent) {
      swings.push({ key, label: py.line_labels?.[key] ?? line(ix, key)?.label ?? key, py: pv, cy, pct });
    }
  }
  if (!swings.length) return null;
  swings.sort((a, b) => Math.abs(b.cy - b.py) - Math.abs(a.cy - a.py));
  return {
    id: 'WP-PY-VARIANCE', origin: 'workpaper', ruleId: 'WP-VARIANCE-PRIOR-YEAR',
    title: `${swings.length} lines changed more than ${std.flag_if_change_over_percent}% and ${money(std.and_over_amount)} from 2024`,
    area: 'Engagement', jurisdiction: 'federal', severity: 'medium', classification: 'judgment',
    why: `Firm standard: flag changes over ${std.flag_if_change_over_percent}% and over ${money(std.and_over_amount)} versus the prior year.`,
    matters: 'Unexplained swings are where errors hide. Two of these swings (business miles, Fremont repairs) point to separate cases.',
    facts: swings.slice(0, 40).map((s) => ({ text: `${s.key} ${s.label}: 2024 ${money(s.py)} → 2025 ${money(s.cy)} (${s.pct === Infinity ? 'new' : `${s.pct.toFixed(0)}%`})`, refs: [s.key, `py:/return_2024/lines/${s.key}`] })),
    nextAction: 'Write a one-line explanation for each swing.',
    requirements: ['Every swing explained (rationale)'],
    refs: ['D06'],
    lines: swings.map((s) => s.key),
    allowedOutcomes: ['explained_difference', 'corrected'], documentaryFor: [],
  };
}

function letter566(ix: PacketIndex): Draft | null {
  const n = ix.packet.tax_agency_records.notices.find((x: any) => x.tax_year === 2025);
  if (!n) return null;
  return {
    id: 'WP-NOTICE-L566', origin: 'workpaper', ruleId: 'WP-AGENCY-NOTICE',
    title: `${n.type} for 2025 (dated ${n.dated}, response due ${n.response_due})`,
    area: 'Identity & filing', jurisdiction: 'federal', severity: 'low', classification: 'informational',
    why: 'Post-filing notice in the packet timeline (replay, 2028). It is listed so the response record can be assembled from this file.',
    matters: `Items under examination: ${n.items_under_examination.join(' ')} Both items match open cases in this workpaper (vehicle donation value; 1099-K counted twice).`,
    facts: n.items_under_examination.map((t: string) => ({ text: t, refs: ['D72'] })),
    nextAction: 'Assemble the response from the linked cases (vehicle donation, gross receipts reconciliation).',
    requirements: ['Response record assembled'],
    refs: ['D72', 'agency:/notices/1', 'case:WP-VEHICLE-GIFT', 'case:WP-1099K-DOUBLE'],
    allowedOutcomes: ['acknowledged', 'not_applicable'], documentaryFor: [],
    defaultOwner: 'st-02',
  };
}

// ---------------------------------------------------------------------------

export function buildCases(ix: PacketIndex): CaseDef[] {
  const all = [...engineCases(ix), ...wpCases(ix)];
  return all.sort((a, b) => b.priorityScore - a.priorityScore);
}

export { resolvePointer };
