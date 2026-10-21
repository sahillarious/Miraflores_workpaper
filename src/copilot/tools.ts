import { z } from 'zod';
import type { CaseDef } from '../domain/cases';
import { line, num, resolvePointer, unreadPages, type PacketIndex } from '../domain/packetIndex';
import { fmtValue, refKind, resolveRef } from '../domain/refs';
import { makeRedactor } from './redact';

// Read-only investigation tools. The model can only call these; none of them
// writes state. Every tool reports the ids whose *content* it returned, so the
// verifier can require that cited ids were actually retrieved in the run.

export interface Calc { id: string; a: number; b: number; difference: number; aLabel: string; bLabel: string; aRef?: string; bRef?: string }

export class ToolContext {
  retrieved = new Set<string>();
  listed = new Set<string>();
  calcs = new Map<string, Calc>();
  seenNumbers = new Set<string>();
  defsById: Map<string, CaseDef>;
  redact: (s: string) => string;
  private corpus: Doc[] | null = null;
  constructor(public ix: PacketIndex, public defs: CaseDef[]) {
    this.defsById = new Map(defs.map((d) => [d.id, d]));
    this.redact = makeRedactor(ix);
  }
  getCorpus() { return (this.corpus ??= buildCorpus(this.ix)); }
}

export interface ToolOutput { data: unknown; refs: string[] }
export class ToolError extends Error {}

const MAX_RESULT_CHARS = 12000;

// --- tool definitions (sent to the model) -------------------------------------

const S = { type: 'string' } as const;
export const TOOL_DEFS = [
  {
    name: 'get_case',
    description: 'Load a review case: the question being investigated, the two sides of any comparison (values and the ids they come from), affected return lines, close requirements and the ids of the evidence attached to it. Returns pointers, not record contents: fetch records with get_evidence or get_document_context.',
    input_schema: { type: 'object', additionalProperties: false, required: ['case_id'], properties: { case_id: S } },
  },
  {
    name: 'get_evidence',
    description: 'Fetch up to 15 records by id. Accepts extracted values (ev-####), documents (D##), unextracted pages (doc:D##page#), questionnaire answers (qa-##), client messages (msg-##), call notes (call-##), prior-year or agency records (py:/..., agency:/...), household members (household:ngozi, household:erik, household:ada, household:theo: role, dependency facts, residency, related returns), and return lines (e.g. F1040.11, SchC.9). Returns the record content, provenance and confidence.',
    input_schema: { type: 'object', additionalProperties: false, required: ['ids'], properties: { ids: { type: 'array', items: S } } },
  },
  {
    name: 'search_evidence',
    description: 'Keyword search over extracted values, document pages, questionnaire answers, client messages and call notes. Use to find records the case does not already point to (e.g. a bank statement, a corrected form, a client explanation). Optional filters narrow by kind or document.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['query', 'kinds', 'document_id'],
      properties: {
        query: S,
        kinds: { type: 'array', items: { type: 'string', enum: ['extracted_value', 'document_page', 'questionnaire', 'message', 'call_note'] }, description: 'Empty array = all kinds.' },
        document_id: { type: ['string', 'null'], description: 'Restrict to one document (D##), or null.' },
      },
    },
  },
  {
    name: 'get_document_context',
    description: 'Read one page of a document as printed, with the ids and values the extraction pipeline read from that page, the extraction status, pages that were never extracted, and whether the document was used or superseded in each return version.',
    input_schema: { type: 'object', additionalProperties: false, required: ['document_id', 'page'], properties: { document_id: S, page: { type: 'integer', description: 'Page number, starting at 1.' } } },
  },
  {
    name: 'compare_return_versions',
    description: 'Values of return lines in the 2024 return and in engine versions v1, v2, v3, with the trigger for each version that changed them.',
    input_schema: { type: 'object', additionalProperties: false, required: ['line_keys'], properties: { line_keys: { type: 'array', items: S } } },
  },
  {
    name: 'calculate_difference',
    description: 'Deterministic arithmetic: A minus B. Give each side either a record id (its numeric value is read from the packet) or a literal number. Returns a calc id you must cite for any difference you state.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['a', 'b'],
      properties: {
        a: { type: 'object', additionalProperties: false, required: ['label', 'ref', 'value'], properties: { label: S, ref: { type: ['string', 'null'] }, value: { type: ['number', 'null'] } } },
        b: { type: 'object', additionalProperties: false, required: ['label', 'ref', 'value'], properties: { label: S, ref: { type: ['string', 'null'] }, value: { type: ['number', 'null'] } } },
      },
    },
  },
] as const;

export type ToolName = (typeof TOOL_DEFS)[number]['name'];

const Inputs = {
  get_case: z.object({ case_id: z.string() }),
  get_evidence: z.object({ ids: z.array(z.string()).min(1).max(15) }),
  search_evidence: z.object({ query: z.string().min(2).max(200), kinds: z.array(z.enum(['extracted_value', 'document_page', 'questionnaire', 'message', 'call_note'])).default([]), document_id: z.string().nullable().default(null) }),
  get_document_context: z.object({ document_id: z.string(), page: z.number().int().min(1) }),
  compare_return_versions: z.object({ line_keys: z.array(z.string()).min(1).max(20) }),
  calculate_difference: z.object({
    a: z.object({ label: z.string(), ref: z.string().nullable(), value: z.number().nullable() }),
    b: z.object({ label: z.string(), ref: z.string().nullable(), value: z.number().nullable() }),
  }),
};

// --- execution -----------------------------------------------------------------

export function executeTool(ctx: ToolContext, name: string, rawInput: unknown): { text: string; refs: string[] } {
  if (!(name in Inputs)) throw new ToolError(`Unknown tool "${name}".`);
  const parsed = (Inputs as any)[name].safeParse(rawInput);
  if (!parsed.success) throw new ToolError(`Invalid input for ${name}: ${parsed.error.issues.map((i: any) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  const out: ToolOutput = (TOOLS as any)[name](ctx, parsed.data);
  let text = ctx.redact(JSON.stringify(out.data));
  if (text.length > MAX_RESULT_CHARS) text = text.slice(0, MAX_RESULT_CHARS) + '…[truncated; request fewer ids or a narrower page]';
  for (const r of out.refs) ctx.retrieved.add(r);
  for (const m of text.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)) ctx.seenNumbers.add(normNum(m[0]));
  return { text, refs: out.refs };
}

export function normNum(s: string): string {
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? String(Math.round(Math.abs(n) * 100) / 100) : s;
}

const TOOLS = {
  get_case(ctx: ToolContext, { case_id }: { case_id: string }): ToolOutput {
    const d = ctx.defsById.get(case_id);
    if (!d) throw new ToolError(`No case "${case_id}". Valid ids look like ENG-BROKER_SUMMARY_DETAIL_MISMATCH or WP-RSU-BASIS.`);
    const evidence = [...new Set([...d.refs, ...d.reconciliations.flatMap((r) => [...r.a.refs, ...r.b.refs]), ...d.facts.flatMap((f) => f.refs), ...d.conflicts.flatMap((f) => f.refs)])];
    evidence.forEach((r) => ctx.listed.add(r));
    // Deliberately omits the deterministic rule's conclusion ("finding", fact
    // statements, next action) so the copilot investigates the records itself.
    return {
      refs: [],
      data: {
        case_id: d.id, title: d.title, origin: d.origin, rule: d.ruleId, area: d.area, jurisdiction: d.jurisdiction,
        severity: d.severity, classification_by_rules: d.classification, why_flagged: d.why, why_it_matters: d.matters,
        comparisons: d.reconciliations.map((r) => ({
          title: r.title, unit: r.unit, comparable: r.comparable, expectation: r.expectation,
          a: { label: r.a.label, value: r.a.value, ids: r.a.refs.slice(0, 20), more: Math.max(0, r.a.refs.length - 20) },
          b: { label: r.b.label, value: r.b.value, ids: r.b.refs.slice(0, 20), more: Math.max(0, r.b.refs.length - 20) },
        })),
        affected_lines: d.lines.slice(0, 25),
        open_questions: d.openQuestions,
        close_requirements: d.requirements,
        evidence_ids: evidence.slice(0, 60),
        evidence_ids_omitted: Math.max(0, evidence.length - 60),
      },
    };
  },

  get_evidence(ctx: ToolContext, { ids }: { ids: string[] }): ToolOutput {
    const ix = ctx.ix;
    const refs: string[] = [];
    const records = ids.map((id) => {
      const kind = refKind(id);
      if (kind === 'unknown') return { id, error: 'unrecognised id format' };
      if (kind === 'ev') {
        const e = ix.evs.get(id);
        if (!e) return { id, error: 'no such extracted value' };
        refs.push(id);
        const d = ix.docs.get(e.document_id)!;
        return {
          id, kind: 'extracted_value', document_id: e.document_id, document_title: d.title, page: e.page, field: e.field, label: e.label,
          value: e.value, value_type: e.value_type, text_as_read: e.text_as_read, confidence: e.confidence,
          used_by_lines_v3: ix.refToLines.get(ix.current.version)!.get(id) ?? [],
        };
      }
      if (kind === 'doc') {
        const d = ix.docs.get(id);
        if (!d) return { id, error: 'no such document' };
        refs.push(id);
        return { id, kind: 'document', title: d.title, type: d.document_type, issuer: d.issuer, belongs_to: d.belongs_to, received_at: d.received_at, uploaded_by: d.uploaded_by, page_count: d.page_count, marked_corrected: !!d.marked_corrected, extraction: d.extraction, hint: 'use get_document_context for page text' };
      }
      if (kind === 'docpage') {
        const m = /^doc:(D\d\d)#page(\d+)$/.exec(id)!;
        const p = ix.docs.get(m[1])?.pages.find((x) => x.page === Number(m[2]));
        if (!p) return { id, error: 'no such page' };
        refs.push(id, m[1]);
        return { id, kind: 'document_page', document_id: m[1], page: p.page, printed_content: p.printed_content };
      }
      if (kind === 'qa') { const q = ix.qa.get(id); if (!q) return { id, error: 'no such answer' }; refs.push(id); return { kind: 'questionnaire', ...q }; }
      if (kind === 'msg') { const m = ix.msgs.get(id); if (!m) return { id, error: 'no such message' }; refs.push(id); return { kind: 'client_message', ...m }; }
      if (kind === 'call') { const c = ix.calls.get(id); if (!c) return { id, error: 'no such call note' }; refs.push(id); return { kind: 'call_note', ...c }; }
      if (kind === 'py' || kind === 'agency') {
        const root = kind === 'py' ? ix.packet.prior_years : ix.packet.tax_agency_records;
        const v = resolvePointer(root, id.slice(kind === 'py' ? 3 : 7));
        if (v === undefined) return { id, error: 'pointer does not resolve' };
        refs.push(id);
        return { id, kind: kind === 'py' ? 'prior_year_record' : 'agency_record', value: v };
      }
      if (kind === 'line') {
        const l = line(ix, id);
        if (!l) return { id, error: `line not in ${ix.current.version}` };
        refs.push(id);
        return { id, kind: 'return_line', version: ix.current.version, label: l.label, value: l.value, rule: l.rule, rule_text: ix.packet.engine_reference.rules[l.rule], inputs: l.inputs, sources: l.sources, note: l.note ?? null };
      }
      if (kind === 'household') {
        const pid = id.slice('household:'.length);
        const person = ix.packet.household.people.find((x: any) => x.id === pid);
        if (!person) return { id, error: 'no such person' };
        refs.push(id);
        // Identity numbers stay out (redaction would mask them anyway); facts a reviewer needs stay in.
        const { ssn: _s, ip_pin: _p, phone: _ph, email: _e, ...facts } = person;
        return { id, kind: 'household_person', ...facts, filing_status: ix.packet.household.filing_status, residency: ix.packet.household.residency, related_returns: ix.packet.household.related_returns.filter((r: any) => String(r.who).includes(person.name)) };
      }
      const r = resolveRef(ix, id);
      refs.push(id);
      return { id, kind, label: r.label, value: r.value ?? null };
    });
    return { refs, data: { records } };
  },

  search_evidence(ctx: ToolContext, { query, kinds, document_id }: { query: string; kinds: string[]; document_id: string | null }): ToolOutput {
    const corpus = ctx.getCorpus();
    const qTerms = terms(query);
    const qNums = [...query.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => normNum(m[0]));
    const df = idf(corpus);
    const scored = corpus
      .filter((d) => (!kinds.length || kinds.includes(d.kind)) && (!document_id || d.document_id === document_id))
      .map((d) => {
        let s = 0;
        for (const t of qTerms) if (d.terms.has(t)) s += df.get(t) ?? 0;
        for (const n of qNums) if (d.nums.has(n)) s += 3;
        if (query.length > 6 && d.text.toLowerCase().includes(query.toLowerCase())) s += 2;
        return { d, s };
      })
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 10);
    const refs = scored.map((x) => x.d.id);
    return {
      refs,
      data: {
        query, results: scored.map(({ d, s }) => ({ id: d.id, kind: d.kind, document_id: d.document_id ?? null, score: Math.round(s * 10) / 10, text: d.text.length > 400 ? d.text.slice(0, 400) + '…' : d.text })),
        note: scored.length ? undefined : 'No matches. Try different words or remove filters.',
      },
    };
  },

  get_document_context(ctx: ToolContext, { document_id, page }: { document_id: string; page: number }): ToolOutput {
    const ix = ctx.ix;
    const d = ix.docs.get(document_id);
    if (!d) throw new ToolError(`No document "${document_id}".`);
    const p = d.pages.find((x) => x.page === page);
    if (!p) throw new ToolError(`${document_id} has pages 1-${d.page_count}.`);
    const evs = (ix.evsByDoc.get(document_id) ?? []).filter((e) => e.page === page);
    const pageRef = `doc:${document_id}#page${page}`;
    return {
      refs: [document_id, pageRef, ...evs.map((e) => e.id)],
      data: {
        document_id, title: d.title, issuer: d.issuer, received_at: d.received_at, marked_corrected: !!d.marked_corrected,
        page, page_count: d.page_count, page_ref: pageRef, printed_content: p.printed_content,
        extracted_on_this_page: evs.slice(0, 60).map((e) => ({ id: e.id, label: e.label, value: e.value, text_as_read: e.text_as_read, confidence: e.confidence })),
        extracted_on_this_page_omitted: Math.max(0, evs.length - 60),
        extraction: d.extraction,
        pages_with_amounts_not_extracted: unreadPages(ix, document_id),
        versions: ix.versions.map((v) => ({ version: v.version, status: v.documents_superseded.includes(document_id) ? 'superseded' : v.documents_used.includes(document_id) ? 'used' : 'not used' })),
      },
    };
  },

  compare_return_versions(ctx: ToolContext, { line_keys }: { line_keys: string[] }): ToolOutput {
    const ix = ctx.ix;
    const refs: string[] = [];
    const rows = line_keys.map((k) => {
      const per = Object.fromEntries(ix.versions.map((v) => [v.version, line(ix, k, v.version)?.value ?? null]));
      if (Object.values(per).every((x) => x === null)) return { line: k, error: 'line not found in any version' };
      refs.push(k);
      return {
        line: k, label: line(ix, k)?.label ?? line(ix, k, 'v1')?.label, prior_year_2024: ix.packet.prior_years.return_2024.lines[k] ?? null, ...per,
        changed_in: ix.versions.filter((v) => v.changes_from_previous.some((c) => c.key === k)).map((v) => ({ version: v.version, trigger: v.trigger })),
      };
    });
    return { refs, data: { rows } };
  },

  calculate_difference(ctx: ToolContext, input: { a: { label: string; ref: string | null; value: number | null }; b: { label: string; ref: string | null; value: number | null } }): ToolOutput {
    const side = (s: typeof input.a, name: string) => {
      if (s.ref) {
        const v = numericValue(ctx, s.ref);
        if (v === null) throw new ToolError(`Side ${name}: "${s.ref}" has no numeric value.`);
        if (s.value !== null && Math.abs(s.value - v) > 0.005) throw new ToolError(`Side ${name}: you gave ${s.value} but ${s.ref} is ${v}. Use the record's value.`);
        return v;
      }
      if (s.value === null) throw new ToolError(`Side ${name}: give a ref or a value.`);
      return s.value;
    };
    const a = side(input.a, 'A');
    const b = side(input.b, 'B');
    const id = `calc-${ctx.calcs.size + 1}`;
    const calc: Calc = { id, a, b, difference: Math.round((a - b) * 100) / 100, aLabel: input.a.label, bLabel: input.b.label, aRef: input.a.ref ?? undefined, bRef: input.b.ref ?? undefined };
    ctx.calcs.set(id, calc);
    return { refs: [id, ...[input.a.ref, input.b.ref].filter((x): x is string => !!x)], data: { calc_id: id, a, b, difference: calc.difference, note: 'A minus B. A difference is an observation, not by itself an error.' } };
  },
};

/** Numeric value of a record id, or null. Used by calculate_difference and the verifier. */
export function numericValue(ctx: ToolContext, id: string): number | null {
  const ix = ctx.ix;
  if (ctx.calcs.has(id)) return ctx.calcs.get(id)!.difference;
  const k = refKind(id);
  let v: unknown;
  if (k === 'ev') v = ix.evs.get(id)?.value;
  else if (k === 'line') v = line(ix, id)?.value;
  else if (k === 'py') v = resolvePointer(ix.packet.prior_years, id.slice(3));
  else if (k === 'agency') v = resolvePointer(ix.packet.tax_agency_records, id.slice(7));
  const n = num(v);
  return Number.isFinite(n) ? n : null;
}

/** Does the id refer to something that exists (packet record, return line, or a calc from this run)? */
export function idExists(ctx: ToolContext, id: string): boolean {
  if (ctx.calcs.has(id)) return true;
  const r = resolveRef(ctx.ix, id);
  if (r.kind === 'unknown' || r.kind === 'case') return false;
  if (/not found|unknown document|line not in this version/.test(r.label)) return false;
  if ((r.kind === 'py' || r.kind === 'agency') && (r.value === undefined || r.value === '')) return false;
  if (r.kind === 'docpage') return !!ctx.ix.docs.get(id.slice(4, 7))?.pages.find((p) => `doc:${id.slice(4, 7)}#page${p.page}` === id);
  if (r.kind === 'qa') return ctx.ix.qa.has(id);
  if (r.kind === 'msg') return ctx.ix.msgs.has(id);
  if (r.kind === 'call') return ctx.ix.calls.has(id);
  return true;
}

// --- lexical retrieval ---------------------------------------------------------------

interface Doc { id: string; kind: string; document_id?: string; text: string; terms: Set<string>; nums: Set<string> }

const STOP = new Set('the a an and or of to in on for with by from at is was were be this that it as are not no yes our we you your has have had did do does any per'.split(' '));
function terms(s: string): string[] {
  return [...new Set(s.toLowerCase().replace(/[^a-z0-9.\- ]/g, ' ').split(/\s+/).map((t) => t.replace(/^[.\-]+|[.\-]+$/g, '')).filter((t) => t.length > 1 && !STOP.has(t)).map(stem))];
}
function stem(t: string) { return t.length > 4 ? t.replace(/(ings|ing|ed|es|s)$/, '') : t; }

function buildCorpus(ix: PacketIndex): Doc[] {
  const docs: Doc[] = [];
  const add = (id: string, kind: string, text: string, document_id?: string) => {
    docs.push({ id, kind, document_id, text, terms: new Set(terms(text)), nums: new Set([...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => normNum(m[0]))) });
  };
  for (const e of ix.packet.extracted_values) {
    const d = ix.docs.get(e.document_id)!;
    add(e.id, 'extracted_value', `${e.label} = ${fmtValue(e.value)} (${e.field}; ${d.title}; read "${e.text_as_read}")`, e.document_id);
  }
  for (const d of ix.packet.documents) for (const p of d.pages) add(`doc:${d.id}#page${p.page}`, 'document_page', `${d.title} — page ${p.page}: ${p.printed_content}`, d.id);
  for (const q of ix.packet.client.questionnaire) add(q.id, 'questionnaire', `${q.question} Answer: ${q.answer} (${q.answered_by})`);
  for (const m of ix.packet.client.messages) add(m.id, 'message', `${m.from}, ${m.sent_at.slice(0, 10)}: ${m.text}`);
  for (const c of ix.packet.client.call_notes) add(c.id, 'call_note', `Call ${c.date.slice(0, 10)}: ${c.notes.join(' ')}`);
  return docs;
}

function idf(corpus: Doc[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const d of corpus) for (const t of d.terms) df.set(t, (df.get(t) ?? 0) + 1);
  const N = corpus.length;
  return new Map([...df].map(([t, n]) => [t, Math.log(1 + N / n)]));
}
