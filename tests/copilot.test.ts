import { describe, expect, it } from 'vitest';
import { ix } from './load';
import { buildCases } from '../src/domain/cases';
import { executeTool, ToolContext, ToolError } from '../src/copilot/tools';
import { ProviderError, runInvestigation, type ModelProvider, type ModelRequest, type ModelResponse } from '../src/copilot/agent';
import { proseNumbers } from '../src/copilot/verify';
import { MemoryRepository, Workpaper } from '../src/domain/store';
import { buildActors, caseFacts, type Actor } from '../src/domain/workflow';
import { createCopilotApi } from '../server/api';
import { packetPath } from './load';

const defs = buildCases(ix);
const actors = buildActors(ix);
const A = (id: string) => actors.find((a) => a.id === id) as Actor;
const parse = (s: string) => JSON.parse(s.replace(/…\[truncated.*$/, ''));

// Test double: replays scripted model turns. Never used by the app.
function scripted(turns: ((req: ModelRequest) => any[] | Error)[]): ModelProvider & { requests: ModelRequest[] } {
  let i = 0;
  const requests: ModelRequest[] = [];
  return {
    name: 'scripted', model: 'scripted-model', requests,
    async create(req): Promise<ModelResponse> {
      requests.push(JSON.parse(JSON.stringify(req)));
      const t = turns[Math.min(i++, turns.length - 1)](req);
      if (t instanceof Error) throw t;
      const hasTool = t.some((b) => b.type === 'tool_use');
      return { content: t, stop_reason: hasTool ? 'tool_use' : 'end_turn', usage: { input_tokens: 100, output_tokens: 20 }, model: 'scripted-model' };
    },
  };
}
let n = 0;
const use = (name: string, input: unknown) => ({ type: 'tool_use', id: `tu_${++n}`, name, input });

const MERIDIAN = 'ENG-BROKER_SUMMARY_DETAIL_MISMATCH';
const goodReport = (over: any = {}) => ({
  case_id: MERIDIAN,
  summary: 'The corrected Meridian 1099 summary shows proceeds of 71,965.00 while the extracted lots total 71,715; the 250 difference matches a lot printed on an unextracted page.',
  status: 'likely_issue',
  facts: [
    { statement: 'Summary proceeds on the corrected 1099 are 71,965.00.', evidence_ids: ['ev-0703'], quantities: [{ label: 'summary proceeds', value: 71965, evidence_id: 'ev-0703' }] },
    { statement: 'Page 32 prints lot M18 with proceeds 250.00; nothing was extracted from that page.', evidence_ids: ['doc:D31#page32'], quantities: [] },
    { statement: 'Summary minus extracted lots is 250.', evidence_ids: ['calc-1'], quantities: [{ label: 'difference', value: 250, evidence_id: 'calc-1' }] },
  ],
  hypotheses: [],
  missing_information: [],
  recommended_next_steps: [{ action: 'Add lot M18 from page 32 to Form 8949 or document why it is excluded.', rationale: 'The unextracted lot accounts for the whole difference.' }],
  client_question_draft: null,
  resolution_criteria: 'Close once the page-32 lot is reflected on Form 8949 and agreed to the broker summary.',
  requires_human_review: true,
  ...over,
});
const meridianTurns = (report: any) => [
  () => [use('get_case', { case_id: MERIDIAN })],
  () => [use('get_evidence', { ids: ['ev-0703'] }), use('get_document_context', { document_id: 'D31', page: 32 })],
  () => [use('calculate_difference', { a: { label: 'summary', ref: 'ev-0703', value: null }, b: { label: 'lots', ref: null, value: 71715 } })],
  () => [use('submit_report', report)],
];

describe('tools', () => {
  it('get_case gives the question and pointers, not the rule conclusion', () => {
    const ctx = new ToolContext(ix, defs);
    const out = parse(executeTool(ctx, 'get_case', { case_id: MERIDIAN }).text);
    expect(out.comparisons[0].a.value).toBe(71965);
    expect(JSON.stringify(out)).not.toMatch(/extraction gap/);
    expect(ctx.retrieved.size).toBe(0); // listing ids is not retrieving them
  });
  it('get_evidence returns records with provenance and reports unknown ids', () => {
    const ctx = new ToolContext(ix, defs);
    const out = parse(executeTool(ctx, 'get_evidence', { ids: ['ev-0703', 'ev-9999', 'qa-14', 'F1040.11'] }).text);
    expect(out.records[0]).toMatchObject({ document_id: 'D31', value: 71965, confidence: 0.99 });
    expect(out.records[1].error).toMatch(/no such/);
    expect(out.records[2].answer).toBe('No');
    expect(out.records[3].value).toBe(445590);
    expect([...ctx.retrieved].sort()).toEqual(['F1040.11', 'ev-0703', 'qa-14']);
  });
  it('search finds narrative and unextracted-page evidence', () => {
    const ctx = new ToolContext(ix, defs);
    const s1 = parse(executeTool(ctx, 'search_evidence', { query: 'CryptoNorth bank statement', kinds: [], document_id: null }).text);
    expect(s1.results[0].id).toBe('msg-07');
    const s2 = parse(executeTool(ctx, 'search_evidence', { query: 'Ironwood additional transactions', kinds: ['document_page'], document_id: 'D31' }).text);
    expect(s2.results[0].id).toBe('doc:D31#page32');
  });
  it('document context lists unread pages', () => {
    const ctx = new ToolContext(ix, defs);
    const out = parse(executeTool(ctx, 'get_document_context', { document_id: 'D31', page: 32 }).text);
    expect(out.pages_with_amounts_not_extracted).toContain(32);
    expect(out.extracted_on_this_page).toEqual([]);
    expect(out.printed_content).toMatch(/M18 Ironwood/);
  });
  it('calculate_difference reads values from records and rejects mismatched literals', () => {
    const ctx = new ToolContext(ix, defs);
    const out = parse(executeTool(ctx, 'calculate_difference', { a: { label: 's', ref: 'ev-0703', value: null }, b: { label: 'l', ref: null, value: 71715 } }).text);
    expect(out).toMatchObject({ calc_id: 'calc-1', difference: 250 });
    expect(() => executeTool(ctx, 'calculate_difference', { a: { label: 's', ref: 'ev-0703', value: 70000 }, b: { label: 'l', ref: null, value: 1 } })).toThrow(ToolError);
  });
  it('rejects unknown tools and invalid input', () => {
    const ctx = new ToolContext(ix, defs);
    expect(() => executeTool(ctx, 'delete_case', {})).toThrow(/Unknown tool/);
    expect(() => executeTool(ctx, 'get_evidence', { ids: [] })).toThrow(/Invalid input/);
  });
  it('redacts identity and account numbers before they reach the model', () => {
    const ctx = new ToolContext(ix, defs);
    const page = executeTool(ctx, 'get_document_context', { document_id: 'D08', page: 1 }).text;
    expect(page).not.toMatch(/666-41-2287/);
    expect(page).toMatch(/\*\*\*-\*\*-2287/);
    const ssnCard = executeTool(ctx, 'get_evidence', { ids: ['ev-1080'] }).text;
    expect(ssnCard).toMatch(/3390/);
    expect(ssnCard).not.toMatch(/666-74-3390/);
    const sweden = executeTool(ctx, 'get_document_context', { document_id: 'D36', page: 1 }).text;
    expect(sweden).not.toMatch(/7783 9901/);
  });
});

describe('agent loop and verification', () => {
  it('validates a grounded report', async () => {
    const p = scripted(meridianTurns(goodReport()));
    const run = await runInvestigation(p, ix, defs, MERIDIAN);
    expect(run.outcome).toBe('validated');
    expect(run.validation!.issues).toEqual([]);
    expect(run.toolCalls).toBe(4);
    expect(run.trace.filter((t) => t.kind === 'tool').map((t) => t.name)).toEqual(['get_case', 'get_evidence', 'get_document_context', 'calculate_difference', 'submit_report']);
    // tool results were actually sent back to the model
    expect(JSON.stringify(p.requests[2].messages)).toMatch(/M18 Ironwood/);
  });
  it('flags citations that do not exist or were never retrieved', async () => {
    const rep = goodReport();
    rep.facts.push({ statement: 'A bank statement confirms the lot.', evidence_ids: ['ev-9999'], quantities: [] });
    rep.hypotheses.push({ statement: 'The client may hold more lots.', evidence_ids: ['msg-07'], confidence: 'low', how_to_test: 'Ask the client.' });
    const run = await runInvestigation(scripted(meridianTurns(rep)), ix, defs, MERIDIAN);
    expect(run.outcome).toBe('unverified');
    const msgs = run.validation!.issues.map((i) => i.message).join(' | ');
    expect(msgs).toMatch(/ev-9999.*does not exist/);
    expect(msgs).toMatch(/msg-07.*without having retrieved/);
  });
  it('flags amounts that do not match the cited record or anything retrieved', async () => {
    const rep = goodReport({ summary: 'Summary proceeds are 71,965.00 but the true difference is 3,050 according to the records reviewed.' });
    rep.facts[0].quantities[0].value = 72000;
    const run = await runInvestigation(scripted(meridianTurns(rep)), ix, defs, MERIDIAN);
    expect(run.outcome).toBe('unverified');
    const msgs = run.validation!.issues.map((i) => i.message).join(' | ');
    expect(msgs).toMatch(/72000: ev-0703 is 71965/);
    expect(msgs).toMatch(/States 3050/);
  });
  it('rejects an invalid report, lets the model fix it, and counts the failure', async () => {
    const bad = { ...goodReport(), status: 'tax_correct', requires_human_review: false };
    const turns = meridianTurns(bad);
    turns.push(() => [use('submit_report', goodReport())]);
    const p = scripted(turns);
    const run = await runInvestigation(p, ix, defs, MERIDIAN);
    expect(run.schemaFailures).toBe(1);
    expect(run.outcome).toBe('validated');
    expect(JSON.stringify(p.requests.at(-1)!.messages)).toMatch(/rejected by schema validation/);
  });
  it('enforces the tool budget and ends incomplete without a report', async () => {
    const p = scripted([() => [use('get_case', { case_id: MERIDIAN })]]);
    const run = await runInvestigation(p, ix, defs, MERIDIAN, { budget: { maxToolCalls: 3, maxModelTurns: 6 } });
    expect(run.toolCalls).toBe(3);
    expect(run.modelTurns).toBe(6);
    expect(run.outcome).toBe('incomplete');
    expect(run.trace.some((t) => /budget exhausted/.test(t.summary))).toBe(true);
  });
  it('returns tool errors to the model and continues', async () => {
    const turns = [() => [use('get_document_context', { document_id: 'D99', page: 1 })], ...meridianTurns(goodReport())];
    const p = scripted(turns);
    const run = await runInvestigation(p, ix, defs, MERIDIAN);
    expect(run.trace[1]).toMatchObject({ name: 'get_document_context', ok: false });
    expect(JSON.stringify(p.requests[1].messages)).toMatch(/"is_error":true/);
    expect(run.outcome).toBe('validated');
  });
  it('surfaces provider errors and deadlines', async () => {
    const r1 = await runInvestigation(scripted([() => new ProviderError('rate_limited', 'slow down')]), ix, defs, MERIDIAN);
    expect(r1).toMatchObject({ outcome: 'error', error: { kind: 'rate_limited' } });
    const hang: ModelProvider = { name: 'x', model: 'x', create: (_r, signal) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('aborted')))) };
    const r2 = await runInvestigation(hang, ix, defs, MERIDIAN, { budget: { deadlineMs: 50 } });
    expect(r2).toMatchObject({ outcome: 'error', error: { kind: 'timeout' } });
  });
  it('requires the report to arrive through submit_report', async () => {
    const run = await runInvestigation(scripted([() => [{ type: 'text', text: 'Here is my analysis...' }]]), ix, defs, MERIDIAN);
    expect(run.outcome).toBe('incomplete');
    expect(run.error!.kind).toBe('no_report');
  });
  it('prose number extraction ignores ids, years, dates and small counts', () => {
    expect(proseNumbers('ev-0703 on D31 page 32 in 2025 (2025-06-18) shows 71,965.00 and 3 lots, 12%')).toEqual(['71965']);
  });
});

describe('human review boundaries', () => {
  const runPayload = (over: any = {}) => ({ caseId: 'WP-RSU-BASIS', runId: 'run-1', outcome: 'validated', model: 'm', validationPassed: true, issues: 0, status: 'likely_issue', summary: 's', citedIds: ['ev-0066'], nextStep: 'x', ...over });
  it('records runs and decisions without touching status, adjustments or sign-offs', () => {
    const wp = new Workpaper(ix, defs, new MemoryRepository());
    const def = defs.find((d) => d.id === 'WP-RSU-BASIS')!;
    const fp0 = caseFacts(ix, def, wp.state).currentFingerprint;
    expect(wp.dispatch(A('st-01'), { type: 'copilot.run', payload: runPayload() }).ok).toBe(true);
    expect(wp.dispatch(A('st-01'), { type: 'copilot.review', payload: { caseId: def.id, runId: 'run-1', decision: 'accepted', note: 'ok' } }).ok).toBe(true);
    const cs = wp.state.cases[def.id];
    expect(cs.copilot[0].review!.decision).toBe('accepted');
    expect(cs.status).toBe('open');
    expect(cs.adjustments).toEqual([]);
    expect(caseFacts(ix, def, wp.state).currentFingerprint).toBe(fp0);
    expect(wp.dispatch(A('st-01'), { type: 'copilot.review', payload: { caseId: def.id, runId: 'run-1', decision: 'rejected', note: 'second thoughts' } }).ok).toBe(false);
  });
  it('refuses to accept unverified reports, requires a reason to reject, and blocks clients', () => {
    const wp = new Workpaper(ix, defs, new MemoryRepository());
    wp.dispatch(A('st-01'), { type: 'copilot.run', payload: runPayload({ validationPassed: false, outcome: 'unverified' }) });
    const acc = wp.dispatch(A('st-02'), { type: 'copilot.review', payload: { caseId: 'WP-RSU-BASIS', runId: 'run-1', decision: 'accepted' } });
    expect((acc as any).error).toMatch(/unverified/);
    expect(wp.dispatch(A('st-02'), { type: 'copilot.review', payload: { caseId: 'WP-RSU-BASIS', runId: 'run-1', decision: 'rejected', note: '' } }).ok).toBe(false);
    expect(wp.dispatch(A('cu-01'), { type: 'copilot.review', payload: { caseId: 'WP-RSU-BASIS', runId: 'run-1', decision: 'rejected', note: 'no thanks' } }).ok).toBe(false);
    expect(wp.dispatch(A('st-02'), { type: 'copilot.review', payload: { caseId: 'WP-RSU-BASIS', runId: 'run-1', decision: 'rejected', note: 'Cites a page that does not exist' } }).ok).toBe(true);
  });
  it('accepting a suggestion does not satisfy approval rules', () => {
    const wp = new Workpaper(ix, defs, new MemoryRepository());
    wp.dispatch(A('st-01'), { type: 'copilot.run', payload: runPayload({ caseId: 'ENG-DIGITAL_ASSET_BASIS_MISSING' }) });
    wp.dispatch(A('st-01'), { type: 'copilot.review', payload: { caseId: 'ENG-DIGITAL_ASSET_BASIS_MISSING', runId: 'run-1', decision: 'accepted' } });
    const r = wp.dispatch(A('st-01'), { type: 'case.propose', payload: { caseId: 'ENG-DIGITAL_ASSET_BASIS_MISSING', outcome: 'substantiated', rationale: 'The copilot accepted this so it is substantiated.' } });
    expect((r as any).error).toMatch(/documentary evidence/);
  });
});

describe('API', () => {
  const call = async (api: ReturnType<typeof createCopilotApi>, method: string, url: string, body?: unknown) => {
    const chunks = body ? [Buffer.from(JSON.stringify(body))] : [];
    const req: any = { method, url, [Symbol.asyncIterator]: async function* () { yield* chunks; } };
    let status = 0; let out = '';
    const res: any = { setHeader() {}, set statusCode(c: number) { status = c; }, end(s: string) { out = s; } };
    await api(req, res);
    return { status, body: JSON.parse(out) };
  };
  it('reports unconfigured without leaking anything and refuses to run', async () => {
    const api = createCopilotApi({ packetPath, env: {}, log: () => {} });
    const s = await call(api, 'GET', '/api/copilot/status');
    expect(s.body).toMatchObject({ configured: false, model: null });
    const r = await call(api, 'POST', '/api/copilot/investigate', { caseId: MERIDIAN });
    expect(r.status).toBe(503);
    expect((await call(api, 'POST', '/api/copilot/investigate', { caseId: 'nope' })).status).toBe(400);
  });
  it('never returns the API key', async () => {
    const api = createCopilotApi({ packetPath, env: { ANTHROPIC_API_KEY: 'sk-ant-test-SECRET' }, log: () => {} });
    const s = await call(api, 'GET', '/api/copilot/status');
    expect(JSON.stringify(s.body)).not.toMatch(/SECRET/);
    expect(s.body.configured).toBe(true);
  });
  it('runs an investigation through an injected provider', async () => {
    const api = createCopilotApi({ packetPath, provider: scripted(meridianTurns(goodReport())), log: () => {} });
    const r = await call(api, 'POST', '/api/copilot/investigate', { caseId: MERIDIAN });
    expect(r.status).toBe(200);
    expect(r.body.outcome).toBe('validated');
  });
});

describe('tool schemas (regression: strict mode rejected "minimum" in live run 2026-10-19)', () => {
  it('use only keywords strict tool schemas accept', async () => {
    const { toolDefinitions } = await import('../src/copilot/agent');
    const banned = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern', 'format', 'multipleOf'];
    const found: string[] = [];
    const walk = (o: any, path: string) => {
      if (!o || typeof o !== 'object') return;
      for (const [k, v] of Object.entries(o)) {
        if (banned.includes(k) && path.includes('properties')) found.push(`${path}.${k}`);
        walk(v, `${path}.${k}`);
      }
    };
    for (const t of toolDefinitions()) { expect(t.strict).toBe(true); walk(t.input_schema, t.name); }
    expect(found).toEqual([]);
  });
});

describe('verifier (regression: false positives in live run 2026-10-19)', () => {
  it('accepts calc operands and amounts printed on a cited page; still rejects wrong ones', async () => {
    const { quantityProblem } = await import('../src/copilot/verify');
    const ctx = new ToolContext(ix, defs);
    executeTool(ctx, 'calculate_difference', { a: { label: 's', ref: 'ev-0703', value: null }, b: { label: 'l', ref: null, value: 71715 } });
    expect(quantityProblem(ctx, 'calc-1', 71965)).toBeNull();
    expect(quantityProblem(ctx, 'calc-1', 71715)).toBeNull();
    expect(quantityProblem(ctx, 'calc-1', 250)).toBeNull();
    expect(quantityProblem(ctx, 'calc-1', 300)).toMatch(/computed/);
    expect(quantityProblem(ctx, 'doc:D31#page32', 250)).toBeNull();
    expect(quantityProblem(ctx, 'doc:D31#page32', 310)).toBeNull();
    expect(quantityProblem(ctx, 'doc:D31#page32', 999)).toMatch(/does not appear/);
    expect(quantityProblem(ctx, 'msg-07', 3050)).toBeNull();
    expect(quantityProblem(ctx, 'agency:/irs_account_transcript_2025/0', 3000)).toBeNull();
  });
});

describe('verifier (regression: classified issues from live eval 2026-10-19)', () => {
  it('still rejects the three genuine mis-citations', async () => {
    const { quantityProblem } = await import('../src/copilot/verify');
    const ctx = new ToolContext(ix, defs);
    expect(quantityProblem(ctx, 'ev-0708', 1290)).toMatch(/ev-0708 is 6420/); // SchD.1b v1 value cited to an unrelated lot
    expect(quantityProblem(ctx, 'ev-0532', 8400)).toMatch(/not an amount/); // proceeds cited to the sale-date field
    expect(quantityProblem(ctx, 'F1040.1a', 25400)).toMatch(/not its value/); // withholding cited to the wages line
  });
  it('accepts line values from any version, the 2024 return, and the line label/note/rule text', async () => {
    const { quantityProblem } = await import('../src/copilot/verify');
    const ctx = new ToolContext(ix, defs);
    expect(quantityProblem(ctx, 'SchD.1b', 1290)).toBeNull(); // v1 value
    expect(quantityProblem(ctx, 'F1040.11', 428023)).toBeNull(); // v1 AGI
    expect(quantityProblem(ctx, 'F1040.11', 228409)).toBeNull(); // 2024 AGI
    expect(quantityProblem(ctx, 'F8949.B.N1', 0)).toBeNull(); // "basis 0.00" in the label
    expect(quantityProblem(ctx, 'F1040.26', 4000)).toBeNull(); // "4,000.00" in the note
    expect(quantityProblem(ctx, 'F8863.7', 180000)).toBeNull(); // rule text
  });
  it('does not read form names as amounts', () => {
    expect(proseNumbers('the F8863 lines, Form 1099-B, 1099-DA and Form 5498 show 445,590')).toEqual(['445590']);
  });
  it('exposes household facts (eval found they were unreachable) without identity numbers', () => {
    const ctx = new ToolContext(ix, defs);
    const out = executeTool(ctx, 'get_evidence', { ids: ['household:ada'] }).text;
    expect(out).toMatch(/files her own return/);
    expect(out).not.toMatch(/666-38-1106/);
  });
});
