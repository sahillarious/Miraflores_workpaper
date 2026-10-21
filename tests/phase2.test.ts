import { describe, expect, it } from 'vitest';
import { ix, packetPath } from './load';
import { buildCases } from '../src/domain/cases';
import { MemoryRepository, Workpaper } from '../src/domain/store';
import { buildActors, type Actor } from '../src/domain/workflow';
import { ProviderError, runInvestigation, type ModelProvider, type ModelRequest } from '../src/copilot/agent';
import { BAD_CODES_PER_MINUTE, createCopilotApi, RUNS_PER_MINUTE } from '../server/api';
import { cacheKey } from '../server/cacheKey';
import { lookup, remember, type KV } from '../src/copilot/clientCache';
import { draftRationale, stripIds, summarizeReport, VISIBLE_ID } from '../src/copilot/summary';
import { linkCandidates, linkCommand } from '../src/copilot/linkBridge';
import type { InvestigationReport, InvestigationRun } from '../src/copilot/types';

// Scripted provider double only: no live model calls in unit tests.

const defs = buildCases(ix);
const MERIDIAN = 'ENG-BROKER_SUMMARY_DETAIL_MISMATCH';
const OTHER = ['WP-RSU-BASIS', 'WP-HVAC', 'WP-SEHI', 'WP-FX-YEAR'];
const CODE = 'demo-code-123';
let n = 0;
const use = (name: string, input: unknown) => ({ type: 'tool_use', id: `tu_${++n}`, name, input });
const report = (caseId = MERIDIAN): InvestigationReport => ({
  case_id: caseId,
  summary: 'The corrected Meridian 1099 summary (ev-0703) shows proceeds of 71,965.00 while the extracted lots total 71,715. The 250 difference matches a lot printed on an unextracted page (doc:D31#page32).',
  status: 'likely_issue',
  facts: [
    { statement: 'Summary proceeds on the corrected 1099 are 71,965.00.', evidence_ids: ['ev-0703'], quantities: [{ label: 'summary proceeds', value: 71965, evidence_id: 'ev-0703' }] },
    { statement: 'Page 32 prints lot M18 with proceeds 250.00; nothing was extracted from that page.', evidence_ids: ['doc:D31#page32'], quantities: [] },
    { statement: 'Summary minus extracted lots is 250.', evidence_ids: ['calc-1'], quantities: [{ label: 'difference', value: 250, evidence_id: 'calc-1' }] },
  ],
  hypotheses: [],
  missing_information: [],
  recommended_next_steps: [{ action: 'Add lot M18 from page 32 of D31 to F8949.A or document why it is excluded (rule R-8949-LOT).', rationale: 'The unextracted lot accounts for the whole difference.' }],
  client_question_draft: null,
  resolution_criteria: 'Close once the page-32 lot is reflected on Form 8949.',
  requires_human_review: true,
});

/** Stateless double: the turn is chosen from the conversation length, so any number of runs replay the same investigation. */
function meridianProvider(opts: { gate?: Promise<void>; fail?: ProviderError } = {}): ModelProvider & { calls: number } {
  const p = {
    name: 'scripted', model: 'scripted-model', calls: 0,
    async create(req: ModelRequest) {
      p.calls++;
      if (opts.gate) await opts.gate;
      if (opts.fail) throw opts.fail;
      const k = Math.floor((req.messages.length - 1) / 2);
      const caseId = /case (\S+) /.exec(req.messages[0].content)?.[1] ?? MERIDIAN;
      const turns = [
        [use('get_case', { case_id: caseId })],
        [use('get_evidence', { ids: ['ev-0703'] }), use('get_document_context', { document_id: 'D31', page: 32 })],
        [use('calculate_difference', { a: { label: 'summary', ref: 'ev-0703', value: null }, b: { label: 'lots', ref: null, value: 71715 } })],
        [use('submit_report', report(caseId))],
      ];
      const t = turns[Math.min(k, 3)];
      return { content: t, stop_reason: 'tool_use', usage: { input_tokens: 100, output_tokens: 20 }, model: 'scripted-model' };
    },
  };
  return p;
}

function harness(opts: { env?: Record<string, string>; provider?: ModelProvider | null } = {}) {
  let t = Date.UTC(2026, 9, 21, 12, 0, 0);
  const logs: string[] = [];
  const api = createCopilotApi({ packetPath, env: { ANTHROPIC_API_KEY: 'sk-ant-test-SECRET', COPILOT_ACCESS_CODE: CODE, ...opts.env }, provider: opts.provider === undefined ? meridianProvider() : opts.provider, log: (l) => logs.push(l), now: () => t });
  const call = async (method: string, url: string, body?: unknown, headers: Record<string, string> = {}, ip = '10.0.0.1') => {
    const chunks = body ? [Buffer.from(JSON.stringify(body))] : [];
    const req: any = { method, url, headers, socket: { remoteAddress: ip }, [Symbol.asyncIterator]: async function* () { yield* chunks; } };
    let status = 0; let out = '';
    const res: any = { setHeader() {}, set statusCode(c: number) { status = c; }, end(s: string) { out = s; } };
    await api(req, res);
    return { status, body: JSON.parse(out), raw: out };
  };
  const run = (caseId = MERIDIAN, code: string | null = CODE, ip?: string, headers: Record<string, string> = {}) =>
    call('POST', '/api/copilot/investigate', { caseId }, { ...(code === null ? {} : { 'x-access-code': code }), ...headers }, ip);
  return { call, run, logs, advance: (ms: number) => { t += ms; } };
}

describe('endpoint security (access code, limits, safe errors)', () => {
  it('is disabled when COPILOT_ACCESS_CODE is unset, even with an API key', async () => {
    const provider = meridianProvider();
    const h = harness({ env: { COPILOT_ACCESS_CODE: '' }, provider });
    const s = await h.call('GET', '/api/copilot/status');
    expect(s.body).toMatchObject({ configured: false, model: null });
    expect(s.body.reason).toMatch(/COPILOT_ACCESS_CODE/);
    expect((await h.run()).status).toBe(503);
    expect(provider.calls).toBe(0);
  });

  it('refuses a missing or wrong code with 401 and runs with the right one', async () => {
    const h = harness();
    const missing = await h.run(MERIDIAN, null);
    expect(missing.status).toBe(401);
    expect(missing.body.error).toBe('Access code missing or not accepted.');
    expect((await h.run(MERIDIAN, 'wrong')).status).toBe(401);
    expect((await h.run(MERIDIAN, `${CODE} `)).status).toBe(401);
    const ok = await h.run();
    expect(ok.status).toBe(200);
    expect(ok.body.outcome).toBe('validated');
    expect(ok.body.cacheKey).toMatch(/^[0-9a-f]{32}$/);
  });

  it('accepts only case ids that exist', async () => {
    const h = harness();
    expect((await h.run('WP-NOPE')).status).toBe(400);
    expect((await h.run('')).status).toBe(400);
  });

  it('does not count 401s against the daily budget, but rate-limits wrong codes per IP', async () => {
    const h = harness();
    for (let i = 0; i < BAD_CODES_PER_MINUTE; i++) expect((await h.run(MERIDIAN, 'wrong')).status).toBe(401);
    expect((await h.call('GET', '/api/copilot/status')).body.usedToday).toBe(0);
    const locked = await h.run();
    expect(locked.status).toBe(429);
    expect(locked.body.error).toMatch(/wrong access code/);
    expect((await h.run(MERIDIAN, CODE, '10.0.0.2')).status).toBe(200); // another IP is not affected
    h.advance(61_000);
    expect((await h.run()).status).toBe(200);
  });

  it(`allows ${RUNS_PER_MINUTE} investigations a minute per IP`, async () => {
    const h = harness();
    for (const c of OTHER.slice(0, RUNS_PER_MINUTE)) expect((await h.run(c)).status).toBe(200);
    const fourth = await h.run(OTHER[3]);
    expect(fourth.status).toBe(429);
    expect(fourth.body.error).toMatch(/At most 3 investigations a minute/);
    h.advance(61_000);
    expect((await h.run(OTHER[3])).status).toBe(200);
  });

  it('trusts only the proxy-added (right-most) X-Forwarded-For entry when behind a proxy', async () => {
    const h = harness({ env: { COPILOT_TRUST_PROXY: '1' } });
    for (let i = 0; i < RUNS_PER_MINUTE; i++) expect((await h.run(OTHER[i], CODE, 'proxy', { 'x-forwarded-for': `spoof-${i}, 9.9.9.9` })).status).toBe(200);
    expect((await h.run(OTHER[3], CODE, 'proxy', { 'x-forwarded-for': 'spoof-new, 9.9.9.9' })).status).toBe(429);
    expect((await h.run(OTHER[3], CODE, 'proxy', { 'x-forwarded-for': '8.8.8.8' })).status).toBe(200);
  });

  it('stops at the daily cap with a clear message and resets at 00:00 UTC', async () => {
    const h = harness({ env: { COPILOT_DAILY_CAP: '2' } });
    expect((await h.run(OTHER[0])).status).toBe(200);
    expect((await h.run(OTHER[1])).status).toBe(200);
    const capped = await h.run(OTHER[2]);
    expect(capped.status).toBe(429);
    expect(capped.body).toMatchObject({ outcome: 'cap' });
    expect(capped.body.error).toMatch(/Demo limit reached for today \(2 investigations\).*00:00 UTC/);
    expect((await h.call('GET', '/api/copilot/status')).body).toMatchObject({ dailyCap: 2, usedToday: 2 });
    h.advance(12 * 3600_000); // 2026-10-22 00:00 UTC
    expect((await h.run(OTHER[2])).status).toBe(200);
  });

  it('defaults the daily cap to 60', async () => {
    expect((await harness().call('GET', '/api/copilot/status')).body.dailyCap).toBe(60);
  });

  it('counts a failed model call against the cap and returns only a safe error', async () => {
    const leak = new ProviderError('bad_request', 'Request rejected (400): system prompt "You are an investigation assistant" sk-ant-api03-LEAK');
    const h = harness({ provider: meridianProvider({ fail: leak }) });
    const r = await h.run();
    expect(r.status).toBe(200);
    expect(r.body.outcome).toBe('error');
    expect(r.body.error).toEqual({ kind: 'bad_request', message: 'The AI service could not process this request.' });
    expect(r.raw).not.toMatch(/sk-ant|LEAK|investigation assistant|Request rejected/);
    expect((await h.call('GET', '/api/copilot/status')).body.usedToday).toBe(1);
  });

  it('never logs the access code, the key or report text', async () => {
    const h = harness();
    await h.run(MERIDIAN, 'wrong-guess');
    await h.run();
    const all = h.logs.join('\n');
    expect(h.logs.length).toBeGreaterThan(0);
    expect(all).not.toMatch(new RegExp(`${CODE}|wrong-guess|SECRET|71,965|Meridian 1099 summary`));
  });

  it('shares one in-flight investigation between concurrent requests for the same key', async () => {
    let open!: () => void;
    const provider = meridianProvider({ gate: new Promise<void>((r) => { open = r; }) });
    const h = harness({ provider });
    const a = h.run(MERIDIAN, CODE, '10.0.0.1');
    const b = h.run(MERIDIAN, CODE, '10.0.0.2');
    await new Promise((r) => setTimeout(r, 20));
    open();
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.status).toBe(200);
    expect(rb.status).toBe(200);
    expect(rb.body.runId).toBe(ra.body.runId);
    expect(rb.body.shared).toBe(true);
    expect(provider.calls).toBe(4); // one investigation's worth of turns
    expect((await h.call('GET', '/api/copilot/status')).body.usedToday).toBe(1);
  });

  it('keeps the concurrency limit of 2 for different cases', async () => {
    let open!: () => void;
    const h = harness({ provider: meridianProvider({ gate: new Promise<void>((r) => { open = r; }) }) });
    const a = h.run(OTHER[0], CODE, '10.0.0.1');
    const b = h.run(OTHER[1], CODE, '10.0.0.2');
    await new Promise((r) => setTimeout(r, 20));
    const c = await h.run(OTHER[2], CODE, '10.0.0.3');
    expect(c.status).toBe(429);
    expect(c.body.outcome).toBe('busy');
    open();
    await Promise.all([a, b]);
  });
});

describe('cache key', () => {
  it('is stable, published per case, and changes with the model or the case definition', async () => {
    const s = (await harness().call('GET', '/api/copilot/status')).body;
    expect(Object.keys(s.cacheKeys)).toHaveLength(defs.length);
    expect((await harness().call('GET', '/api/copilot/status')).body.cacheKeys).toEqual(s.cacheKeys);
    const def = defs.find((d) => d.id === MERIDIAN)!;
    const base = { caseId: MERIDIAN, packetHash: 'p', def, model: 'm' };
    expect(cacheKey(base)).toBe(cacheKey({ ...base }));
    expect(cacheKey({ ...base, model: 'm2' })).not.toBe(cacheKey(base));
    expect(cacheKey({ ...base, packetHash: 'q' })).not.toBe(cacheKey(base));
    expect(cacheKey({ ...base, def: { ...def, title: `${def.title}!` } })).not.toBe(cacheKey(base));
  });
});

describe('browser report cache', () => {
  const memKV = (): KV & { data: Map<string, string> } => { const data = new Map<string, string>(); return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } }; };
  const runOf = async (provider: ModelProvider) => runInvestigation(provider, ix, defs, MERIDIAN);

  it('caches only verified reports, keeps the first per key, and replaces only on purpose', async () => {
    const kv = memKV();
    const good = await runOf(meridianProvider());
    expect(good.outcome).toBe('validated');
    const failed = await runOf(meridianProvider({ fail: new ProviderError('server', 'x') }));
    const unverified: InvestigationRun = { ...good, runId: 'run-unverified', outcome: 'unverified', validation: { ...good.validation!, passed: false } };
    expect(remember(kv, failed, 'k1')).toBe(false);
    expect(remember(kv, unverified, 'k1')).toBe(false);
    expect(kv.data.size).toBe(0);
    expect(remember(kv, good, 'k1')).toBe(true);
    const second = { ...good, runId: 'run-second', startedAt: '2026-10-21T13:00:00.000Z' };
    expect(remember(kv, second, 'k1')).toBe(false);
    expect(lookup(kv, MERIDIAN, 'k1')!.report.run.runId).toBe(good.runId);
    expect(remember(kv, second, 'k1', { replace: true })).toBe(true);
    expect(lookup(kv, MERIDIAN, 'k1')).toMatchObject({ freshness: 'cached', report: { run: { runId: 'run-second' } } });
  });

  it('marks a report made under an older key as "code or packet changed"', async () => {
    const kv = memKV();
    remember(kv, await runOf(meridianProvider()), 'old-key');
    expect(lookup(kv, MERIDIAN, 'new-key')!.freshness).toBe('changed');
    expect(lookup(kv, 'WP-HVAC', 'new-key')).toBeNull();
  });
});

describe('three-line summary and rationale draft (no second model call)', () => {
  // Wording taken from the live RSU report of 2026-10-21, which named a rule id and a document id.
  const live: InvestigationReport = {
    ...report('WP-RSU-BASIS'),
    status: 'likely_issue',
    summary: 'Three noncovered Corvane RSU lots (N1, N3, N4) are on Form 8949 with 0.00 basis in v1, v2 and v3. The Corvane supplemental statement (D11) gives adjusted basis for the same three lots, matched on acquisition date. The supplement was not applied, which is what rule R-8949-LOT says to do when a lot is matched.',
    missing_information: [{ item: 'A prior-year W-2 for the 2023 lot (ev-0070)', why_needed: 'tie basis', possible_source: 'client' }],
    recommended_next_steps: [{ action: 'Propose a per-lot basis adjustment for N1 (19,100), N3 (19,100) and N4 (9,420) from D11, or document a reason not to.', rationale: 'x' }],
  };

  it('gives three plain lines with no record ids, rule ids, case codes or line keys', () => {
    for (const r of [live, report()]) {
      const lines = summarizeReport(r);
      expect(lines).toHaveLength(3);
      for (const l of lines) { expect(l, l).not.toMatch(VISIBLE_ID); expect(l.length).toBeGreaterThan(10); }
    }
    const [l1, l2, l3] = summarizeReport(live);
    expect(l1).toMatch(/^Likely an error, still to be confirmed: Three noncovered Corvane RSU lots \(N1, N3, N4\)/);
    expect(l2).toBe('Still missing: A prior-year W-2 for the 2023 lot.');
    expect(l3).toBe('Suggested next step: Propose a per-lot basis adjustment for N1 (19,100), N3 (19,100) and N4 (9,420) from the source document, or document a reason not to.');
  });

  it('strips ids without breaking amounts in parentheses', () => {
    expect(stripIds('statement (D11) gives 19,100 (ev-0066), see rule R-8949-LOT and F8949.B.N1 (19,240)')).toBe('statement gives 19,100, see the rule and a return line (19,240)');
    // Regression (screenshot 2026-10-21): a parenthesis holding only a page reference must disappear, not become "(a document page)".
    expect(stripIds('a lot printed on an unextracted page (doc:D31#page32).')).toBe('a lot printed on an unextracted page.');
  });

  it('drafts a rationale of at least 20 characters from the verified report', () => {
    const d = draftRationale(report());
    expect(d.length).toBeGreaterThanOrEqual(20);
    expect(d).toMatch(/^The corrected Meridian 1099 summary.*Next: Add lot M18/);
  });
});

describe('"Link these records" bridge', () => {
  const actors = buildActors(ix);
  const A = (id: string) => actors.find((a) => a.id === id) as Actor;

  it('offers retrieved packet records cited in facts, never calc ids, and flags which are documentary', async () => {
    const run = await runInvestigation(meridianProvider(), ix, defs, MERIDIAN);
    const c = linkCandidates(ix, run, new Set());
    expect(c.map((x) => [x.ref, x.documentary])).toEqual([['ev-0703', true], ['doc:D31#page32', true]]);
    expect(linkCandidates(ix, run, new Set(['ev-0703'])).map((x) => x.ref)).toEqual(['doc:D31#page32']);
    expect(linkCandidates(ix, { ...run, outcome: 'unverified' }, new Set())).toEqual([]);
    expect(linkCandidates(ix, { ...run, retrievedIds: ['doc:D31#page32'] }, new Set()).map((x) => x.ref)).toEqual(['doc:D31#page32']);
  });

  it('links through the same authorize path as manual links: staff yes, client and administrator no', async () => {
    const run = await runInvestigation(meridianProvider(), ix, defs, MERIDIAN);
    const cmds = linkCandidates(ix, run, new Set()).map((c) => linkCommand(MERIDIAN, run.runId, c));
    const wp = new Workpaper(ix, defs, new MemoryRepository());
    expect((wp.dispatch(A('cu-01'), cmds) as any).error).toMatch(/Clients can only answer/);
    expect((wp.dispatch(A('st-05'), cmds) as any).error).toMatch(/administrator/);
    expect(wp.state.cases[MERIDIAN].links).toHaveLength(0);
    expect(wp.dispatch(A('st-01'), cmds).ok).toBe(true);
    expect(wp.state.cases[MERIDIAN].links.map((l) => [l.ref, l.by])).toEqual([['ev-0703', 'st-01'], ['doc:D31#page32', 'st-01']]);
    expect(wp.state.cases[MERIDIAN].links[0].why).toMatch(new RegExp(`^Cited by AI analysis ${run.runId}: `));
    expect(wp.state.cases[MERIDIAN].status).toBe('open'); // linking changes no status
  });
});
