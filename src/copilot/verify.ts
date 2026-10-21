import type { CaseDef } from '../domain/cases';
import { line, resolvePointer } from '../domain/packetIndex';
import { refKind } from '../domain/refs';
import { idExists, normNum, numericValue, type ToolContext } from './tools';
import type { InvestigationReport, Issue, Validation } from './types';

// Deterministic checks on a model report. Nothing here edits the report: a
// problem becomes an issue and the run is marked unverified.

/** Bump when the verification rules change; it is part of the copilot cache key. */
export const VERIFIER_VERSION = '2026-10-19.2';

const ID_TOKEN = /\b(?:ev-\d{3,5}|D\d\d|doc:D\d\d#page\d+|qa-\d+|msg-\d+|call-\d+|calc-\d+|(?:F|Sch)[A-Za-z0-9-]*\.[A-Za-z0-9.]+|[A-Z]{1,3}\d{1,3})\b/g;

/** Numbers stated in prose: amounts and counts, ignoring ids, years, dates and small ordinals. */
export function proseNumbers(text: string): string[] {
  const cleaned = text
    .replace(ID_TOKEN, ' ')
    .replace(/\b(?:Form\s+|F)\d{3,4}(?:-[A-Z]{1,4})?\b/g, ' ')
    .replace(/\b\d{4}-[A-Z]{1,4}\b/g, ' ')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, ' ')
    .replace(/\bpage\s+\d+\b/gi, ' ')
    .replace(/\b\d+(?:\.\d+)?%/g, ' ');
  const out: string[] = [];
  for (const m of cleaned.matchAll(/\$?(-?\d[\d,]*(?:\.\d+)?)/g)) {
    const raw = m[1];
    const n = Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(n)) continue;
    if (Number.isInteger(n) && n >= 1900 && n <= 2100 && !raw.includes(',')) continue; // years
    if (Math.abs(n) < 100) continue; // counts, ordinals, line numbers
    out.push(normNum(raw));
  }
  return out;
}

export function verifyReport(ctx: ToolContext, def: CaseDef, report: InvestigationReport): Validation {
  const issues: Issue[] = [];
  if (report.case_id !== def.id) issues.push({ kind: 'case', message: `Report is for "${report.case_id}" but the case is "${def.id}".` });
  if (report.requires_human_review !== true) issues.push({ kind: 'schema', message: 'requires_human_review must be true.' });

  // Citations: exist in the packet (or this run's calcs), and were retrieved in this run.
  const cited = new Set<string>();
  const cite = (ids: string[], where: string) => {
    for (const id of ids) {
      cited.add(id);
      if (!idExists(ctx, id)) issues.push({ kind: 'citation', message: `Cites "${id}", which does not exist in the packet.`, where });
      else if (!ctx.retrieved.has(id)) issues.push({ kind: 'citation', message: `Cites "${id}" without having retrieved its content in this run.`, where });
    }
  };
  report.facts.forEach((f, i) => {
    cite(f.evidence_ids, `fact ${i + 1}`);
    f.quantities.forEach((q) => cite([q.evidence_id], `fact ${i + 1} quantity`));
  });
  report.hypotheses.forEach((h, i) => cite(h.evidence_ids, `hypothesis ${i + 1}`));

  // Quantities: each stated amount must equal the value of the record it cites.
  let qChecked = 0, qOk = 0;
  report.facts.forEach((f, i) => f.quantities.forEach((q) => {
    qChecked++;
    const problem = quantityProblem(ctx, q.evidence_id, q.value);
    if (problem) issues.push({ kind: 'number', message: `"${q.label}" = ${q.value}: ${problem}`, where: `fact ${i + 1}` });
    else qOk++;
  }));

  // Amounts in prose (summary, facts, hypotheses) must appear in something retrieved or computed this run.
  const prose: [string, string][] = [['summary', report.summary], ...report.facts.map((f, i) => [`fact ${i + 1}`, f.statement] as [string, string]), ...report.hypotheses.map((h, i) => [`hypothesis ${i + 1}`, h.statement] as [string, string])];
  let tChecked = 0, tFound = 0;
  for (const [where, text] of prose) {
    for (const n of proseNumbers(text)) {
      tChecked++;
      if (ctx.seenNumbers.has(n)) tFound++;
      else issues.push({ kind: 'number', message: `States ${n}, which appears in no record or calculation retrieved in this run.`, where });
    }
  }

  // Status discipline: "confirmed" needs supporting facts; the model's status is compared with the rules layer.
  if (report.status === 'confirmed_discrepancy' && report.facts.length === 0) issues.push({ kind: 'status', message: 'Status is "confirmed discrepancy" but no supporting facts are cited.' });
  if (report.status === 'confirmed_discrepancy' && ['informational', 'out_of_scope'].includes(def.classification)) {
    issues.push({ kind: 'status', message: `Status "confirmed discrepancy" conflicts with the rules layer's classification (${def.classification}).` });
  }

  const citedIds = [...cited];
  return {
    passed: issues.length === 0,
    issues,
    citedIds,
    existingCited: citedIds.filter((id) => idExists(ctx, id)).length,
    retrievedCited: citedIds.filter((id) => ctx.retrieved.has(id)).length,
    quantitiesChecked: qChecked,
    quantitiesVerified: qOk,
    textNumbersChecked: tChecked,
    textNumbersFound: tFound,
  };
}

const same = (a: number, b: number) => Math.abs(Math.abs(a) - Math.abs(b)) <= 0.01;

/** Why a stated amount is not supported by the record it cites, or null if it is. */
export function quantityProblem(ctx: ToolContext, id: string, value: number): string | null {
  const calc = ctx.calcs.get(id);
  if (calc) return [calc.a, calc.b, calc.difference].some((x) => same(x, value)) ? null : `${id} computed ${calc.a} - ${calc.b} = ${calc.difference}.`;
  if (refKind(id) === 'line') {
    // A line id carries no version: accept its value in any engine version or the 2024 return,
    // or an amount printed in the line's own label, note or rule text (all returned by the tools).
    const ix = ctx.ix;
    const vals = ix.versions.map((v) => line(ix, id, v.version)?.value).concat([ix.packet.prior_years.return_2024.lines[id]]);
    if (vals.some((x) => typeof x === 'number' && same(x, value))) return null;
    const l = line(ix, id);
    if (l && numbersIn(`${l.label} ${l.note ?? ''} ${ix.packet.engine_reference.rules[l.rule] ?? ''}`).has(normNum(String(value)))) return null;
    const shown = ix.versions.map((v) => `${v.version} ${line(ix, id, v.version)?.value ?? '—'}`).join(', ');
    return `${id} is ${shown}; ${value} is not its value in any version or in its label/note.`;
  }
  const v = numericValue(ctx, id);
  if (v !== null) return same(v, value) ? null : `${id} is ${v}.`;
  if (refKind(id) === 'ev') { const e = ctx.ix.evs.get(id); return `${id} is not an amount (${e?.field} = ${JSON.stringify(e?.value)}).`; }
  // Text records (pages, answers, messages, structured prior-year/agency records): the amount must be printed in them.
  const text = recordText(ctx, id);
  if (text === null) return `${id} has no value or text to check against.`;
  return numbersIn(text).has(normNum(String(value))) ? null : `${value} does not appear in ${id}.`;
}

function numbersIn(text: string) { return new Set([...text.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)].map((m) => normNum(m[0]))); }

function recordText(ctx: ToolContext, id: string): string | null {
  const ix = ctx.ix;
  switch (refKind(id)) {
    case 'docpage': return ix.docs.get(id.slice(4, 7))?.pages.find((p) => `doc:${id.slice(4, 7)}#page${p.page}` === id)?.printed_content ?? null;
    case 'doc': return ix.docs.get(id)?.pages.map((p) => p.printed_content).join(' ') ?? null;
    case 'qa': return ix.qa.get(id)?.answer ?? null;
    case 'msg': return ix.msgs.get(id)?.text ?? null;
    case 'call': return ix.calls.get(id)?.notes.join(' ') ?? null;
    case 'py': { const v = resolvePointer(ix.packet.prior_years, id.slice(3)); return v === undefined ? null : JSON.stringify(v); }
    case 'agency': { const v = resolvePointer(ix.packet.tax_agency_records, id.slice(7)); return v === undefined ? null : JSON.stringify(v); }
    default: return null;
  }
}
