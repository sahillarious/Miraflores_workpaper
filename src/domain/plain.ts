import type { CaseDef } from './cases';

// One plain-language sentence per case for the guided flow. Where a case's own
// "why" text is already free of ids and codes it is used as is. Otherwise a
// sentence is written here, taking every number from the same case data
// (comparisons, suggestion, title), so it cannot drift from the evidence.

const n = (v: unknown) => (typeof v === 'number' ? v : NaN);
const fmt = (v: number) => Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 2 });
const rec = (d: CaseDef, id: string) => d.reconciliations.find((r) => r.id === id)!;
const a = (d: CaseDef, id: string) => n(rec(d, id).a.value);
const b = (d: CaseDef, id: string) => n(rec(d, id).b.value);
/** First amount in parentheses or after a phrase in the title, e.g. "(11,000)". */
const titleAmount = (d: CaseDef, re = /\(([\d,]+(?:\.\d+)?)\)/) => n(Number((re.exec(d.title)?.[1] ?? '').replace(/,/g, '')));
const last4 = (v: unknown) => String(v ?? '').slice(-4);

const WRITTEN: Record<string, (d: CaseDef) => string> = {
  'WP-RSU-BASIS': (d) => `${d.reconciliations.length} company stock (RSU) sales were reported with zero cost, but the company's own statement gives ${fmt(d.reconciliations.reduce((s, r) => s + n(r.b.value), 0))} of cost, so the same income would be taxed twice.`,
  'WP-DEPENDENT-TIN': (d) => `${d.title.split(':')[0]}'s Social Security number in the organizer (ending ${last4(rec(d, 'tin').a.value)}) does not match last year's return (ending ${last4(rec(d, 'tin').b.value)}), so the e-file would be rejected.`,
  'WP-1099K-DOUBLE': (d) => `The card-payment receipts on Form 1099-K (${fmt(a(d, 'gross') - b(d, 'gross'))}) were added to business income although the books already include them, so that income is counted twice.`,
  'WP-SEHI': (d) => `A ${fmt(n(d.suggested?.from))} self-employed health insurance deduction was claimed, but the client says Erik could have joined a spouse's employer plan, which would make it not deductible.`,
  'WP-CA-WAGES': (d) => `All ${fmt(a(d, 'halv-ca'))} of Halvorsen wages were treated as California income although the family moved to Texas in July; the July paystub points to about ${fmt(b(d, 'halv-ca'))} earned while in California.`,
  'WP-EST-CA': (d) => `The return counts ${fmt(a(d, 'ca-est'))} of California estimated payments, but the state's account shows ${fmt(b(d, 'ca-est'))} for this year because one payment was applied to the year before.`,
  'WP-HVAC': (d) => `Replacing the heating and cooling system at the rental (${fmt(titleAmount(d))}) was deducted as a repair, but a replacement like this is usually an improvement that is depreciated over many years.`,
  'WP-MILEAGE-DUP': (d) => `Page 3 of the mileage log is a second scan of page 2, so ${fmt(a(d, 'miles') - b(d, 'miles'))} business miles were counted twice (${fmt(a(d, 'miles'))} claimed, ${fmt(b(d, 'miles'))} on distinct pages).`,
  'WP-EST-FED': (d) => `The return claims ${fmt(a(d, 'fed-est'))} of federal estimated payments, but the IRS record shows ${fmt(b(d, 'fed-est'))}; the last payment came from the client's "I think" answer, not the IRS record.`,
  'WP-VEHICLE-GIFT': (d) => `The donated car was deducted at ${fmt(a(d, 'vehicle'))}, the client's estimate, but the charity sold it for ${fmt(b(d, 'vehicle'))}, and the deduction is limited to the sale price.`,
  'ENG-DUE_DILIGENCE_REQUIRED': () => 'The preparer must complete and keep the due-diligence checklist (Form 8867) because the return claims the child tax credit and the credit for other dependents.',
  'ENG-CA_AMT_NOT_COMPUTED': () => 'The tax software did not compute California’s alternative minimum tax, and the stock options exercised after the move may still be partly California income.',
  'WP-INTEREST-DUP': (d) => `The same ${fmt(a(d, 'nl-int'))} of Northlake interest is reported twice, once from the combined brokerage form and once from the bank's own form.`,
  'WP-MORTGAGE-DUP': (d) => `${fmt(n(d.suggested?.from) - n(d.suggested?.to))} of mortgage interest from the payoff statement was added on top of the lender's Form 1098, which already includes it.`,
  'WP-MIXED-USE': (d) => `The family phone, home internet and Spotify were deducted as 100% business, but the client's own call gives lower business shares, so about ${fmt(titleAmount(d, /\(([\d,]+) personal/))} of personal use is deducted.`,
  'WP-PROPTAX-PRORATION': (d) => `The full ${fmt(a(d, 'proptax'))} of property tax on the new home was deducted, but ${fmt(a(d, 'proptax') - b(d, 'proptax'))} of it was the seller's share, credited at closing.`,
  'ENG-BROKER_SUMMARY_DETAIL_MISMATCH': (d) => `The Meridian broker form's total sales (${fmt(a(d, 'meridian-proceeds'))}) are ${fmt(a(d, 'meridian-proceeds') - b(d, 'meridian-proceeds'))} more than the individual sales that were read (${fmt(b(d, 'meridian-proceeds'))}), because one page of the form was never read.`,
  'ENG-SCORP_BASIS_INCOMPLETE': () => 'The S corporation stock basis was first worked out without the 2023 K-1; the K-1 has since arrived and the tax software stopped flagging it, but someone still has to confirm the basis.',
  'ENG-K1_EXPECTED_NOT_RECEIVED': () => 'The Ridgeline real estate fund’s K-1 arrived late and is used only in the latest version of the return, so its figures still need a reviewer’s check.',
  'ENG-QUESTIONNAIRE_SALES_CONFLICT': (d) => `The client answered that no investments were sold, but ${d.title.split('; ')[1] ?? 'the tax forms show sales'}.`,
  'ENG-FBAR_OUTSIDE_RETURN': () => 'The family’s foreign accounts went over 10,000 dollars, so a separate foreign bank account report (FBAR) is due; it is not part of this return or this engagement.',
  'ENG-FORM_1099_FILING': () => 'The business paid two contractors 600 dollars or more and has not filed the required 1099-NEC forms; that filing is outside this engagement.',
  'WP-PRIOR-OPEN-ITEMS': (d) => `Last year's preparer left ${/left (\d+) open/.exec(d.title)?.[1] ?? 'several'} open items, and one, a form for a large foreign inheritance in 2023, is still unresolved.`,
  'WP-FX-YEAR': (d) => `Swedish bank interest was converted to dollars at last year's exchange rate instead of this year's, so it is understated (${fmt(a(d, 'fx'))} instead of ${fmt(b(d, 'fx'))}).`,
  'WP-IRA-BASIS': (d) => `The client said there was no earlier IRA contribution, but the records show ${fmt(titleAmount(d, /show ([\d,]+)/))} from the 2024 contribution, which lowers the tax on this year's conversion.`,
  'ENG-AMT_CREDIT_CARRYFORWARD': () => 'The stock option exercise caused alternative minimum tax this year, which creates a credit to carry forward and use from 2026.',
  'ENG-AOTC_PHASED_OUT': () => 'The family’s income is too high for the American opportunity education credit, so none is available.',
  'ENG-HOME_OFFICE_AREA_CHANGE': (d) => `The home office is now measured at about ${fmt(b(d, 'home-office'))} square feet, down from ${fmt(a(d, 'home-office'))} on last year's return.`,
  'WP-DUP-W2': () => 'The Halvorsen W-2 was uploaded twice (a PDF and a phone photo); it must be counted only once.',
  'ENG-DIGITAL_ASSET_BASIS_MISSING': (d) => `A bitcoin sale (proceeds ${fmt(titleAmount(d, /proceeds ([\d,]+)/))}) was reported with zero cost; the client says it cost ${fmt(b(d, 'c6-basis'))}, but only the client's message supports that so far.`,
  'WP-READ-VS-PRINTED': (d) => (d.reconciliations.length === 1
    ? 'One value was read from a document with high confidence but does not match what is printed on the page.'
    : `${d.reconciliations.length} values were read from documents with high confidence but do not match what is printed on the page.`),
  'ENG-LOW_CONFIDENCE_READ': (d) => `A handwritten church receipt was read as ${fmt(a(d, 'stbrigid'))}, but the first digit is unclear and could make it ${fmt(b(d, 'stbrigid'))}.`,
  'WP-PY-VARIANCE': (d) => `${/^(\d+) lines/.exec(d.title)?.[1] ?? 'Several'} return lines changed by more than 10% and 1,000 dollars from last year, and each change needs a short explanation.`,
  'WP-NOTICE-L566': () => 'The IRS later sends an examination letter about this return; this case keeps the response file together.',
};

/** Case ids whose plain sentence is written here rather than taken from the case's own text. */
export const PLAIN_WRITTEN = Object.keys(WRITTEN);

/** Ids, rule codes and line keys that should not appear in a plain sentence. */
export const TECHNICAL = /\bR-[A-Z0-9-]+|\bWP-[A-Z0-9-]+|\bev-\d+|\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b|\b(?:F\d{4}[A-Z]*|Sch[A-Z0-9]*|F540NR)\.[A-Za-z0-9.]+|\bqa-\d+|\bmsg-\d+|\bcall-\d+|\bD\d\d\b/;

export function plainSummary(d: CaseDef): string {
  return WRITTEN[d.id]?.(d) ?? d.why;
}
