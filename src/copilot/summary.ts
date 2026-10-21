import type { InvestigationReport, ReportStatus } from './types';

// Deterministic text built from a verified report's own fields. No second
// model call: the summary and the rationale draft only rearrange what the
// verified report already says.

/** Record ids, rule ids, case codes and line keys that must not appear in the visible summary. */
const ID_PATTERNS: [RegExp, string][] = [
  [/\brule\s+R-[A-Z0-9-]+/gi, 'the rule'],
  [/\bR-[A-Z0-9-]+\b/g, 'the rule'],
  [/\bWP-[A-Z0-9-]+\b/g, 'this case'],
  [/\bENG-[A-Z0-9_]+\b/g, 'this case'],
  [/\bdoc:D\d\d#page\d+\b/g, 'a document page'],
  [/\bev-\d+\b/g, 'a record'],
  [/\bcalc-\d+\b/g, 'a calculation'],
  [/\bqa-\d+\b/g, "the client's answer"],
  [/\bmsg-\d+\b/g, "the client's message"],
  [/\bcall-\d+\b/g, 'the call notes'],
  [/\b(?:F\d{4}[A-Z]*|Sch[A-Z0-9]*|F540NR)\.[A-Za-z0-9.]*[A-Za-z0-9]/g, 'a return line'],
  [/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/g, 'the tax software flag'],
  [/\bD\d\d\b/g, 'the source document'],
];
export const VISIBLE_ID = /\bR-[A-Z0-9-]+|\bWP-[A-Z0-9-]+|\bENG-|\bev-\d+|\bcalc-\d+|\bqa-\d+|\bmsg-\d+|\bcall-\d+|\bdoc:D\d\d(?:#page\d+)?|\bD\d\d\b|\b(?:F\d{4}[A-Z]*|Sch[A-Z0-9]*|F540NR)\.[A-Za-z0-9]|\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/;

/** Remove ids from text meant for the plain view: drop parentheses that only hold ids, then name the rest generically. */
export function stripIds(text: string): string {
  let s = text.replace(/\s*\(([^()]*)\)/g, (m, inner: string) => (VISIBLE_ID.test(inner) && inner.replace(new RegExp(VISIBLE_ID.source, 'g'), '').replace(/[\s,;:and]+/g, '') === '' ? '' : m));
  for (const [re, word] of ID_PATTERNS) s = s.replace(re, word);
  return s.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1').trim();
}

const sentences = (t: string) => t.split(/(?<=[.!?])\s+(?=[A-Z0-9"“])/).map((x) => x.trim()).filter(Boolean);
const clip = (t: string, n = 170) => (t.length <= n ? t : `${t.slice(0, t.lastIndexOf(' ', n - 1) > 60 ? t.lastIndexOf(' ', n - 1) : n - 1)}…`);
const sentence = (t: string) => { const s = t.trim(); return /[.!?…]$/.test(s) ? s : `${s}.`; };

const STATUS_PLAIN: Record<ReportStatus, string> = {
  confirmed_discrepancy: 'The records show a real error',
  likely_issue: 'Likely an error, still to be confirmed',
  unresolved_discrepancy: 'A real difference that is not yet explained',
  judgment_required: 'The facts are known; the treatment is a judgment call',
  insufficient_evidence: 'The records cannot settle this yet',
};

/**
 * Three plain lines for step 1: what the AI found, what is still open (or the
 * next supporting point), and the suggested next step. No ids, rule codes or
 * line keys; those stay in the full analysis.
 */
export function summarizeReport(r: InvestigationReport): [string, string, string] {
  const found = sentences(stripIds(r.summary));
  const line1 = `${STATUS_PLAIN[r.status]}: ${clip(sentence(found[0] ?? r.summary))}`;
  const missing = r.missing_information[0];
  const line2 = missing
    ? `Still missing: ${clip(sentence(stripIds(missing.item)))}`
    : found[1] ? clip(sentence(found[1])) : 'Nothing missing was reported.';
  const next = r.recommended_next_steps[0]?.action;
  const line3 = next ? `Suggested next step: ${clip(sentence(stripIds(next)))}` : 'No next step was suggested.';
  return [line1, line2, line3];
}

/** A rationale draft for the decision box, from the verified report. Ids are kept: the rationale is the internal record. */
export function draftRationale(r: InvestigationReport): string {
  const found = sentences(r.summary).slice(0, 2).join(' ');
  const next = r.recommended_next_steps[0]?.action;
  return clip(`${found}${next ? ` Next: ${sentence(next)}` : ''}`, 600);
}
