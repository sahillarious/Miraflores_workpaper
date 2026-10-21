// Copilot evaluation. Runs real model calls against the cases in eval/cases.ts
// and scores them with deterministic checks.
//   npm run eval:copilot                 all cases, 1 run each
//   npm run eval:copilot -- --cases WP-RSU-BASIS --repeat 2
//   npm run eval:copilot -- --dry        check the eval definitions only (no model calls)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildIndex } from '../src/domain/packetIndex';
import { buildCases } from '../src/domain/cases';
import { resolveRef } from '../src/domain/refs';
import type { Packet } from '../src/domain/types';
import { runInvestigation } from '../src/copilot/agent';
import type { InvestigationRun } from '../src/copilot/types';
import { anthropicProvider } from '../server/anthropic';
import { EVAL_CASES, type EvalCase } from './cases';

const root = resolve(process.cwd());
if (!process.env.ANTHROPIC_API_KEY && existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const dry = args.includes('--dry');
const repeat = Number(flag('--repeat') ?? 1);
const only = flag('--cases')?.split(',');
const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = { 'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 }, 'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 }, 'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 } }; // $ per million tokens, list prices

const ix = buildIndex(JSON.parse(readFileSync(join(root, 'public/data/okafor_lindqvist_2025_packet.json'), 'utf-8')) as Packet);
const defs = buildCases(ix);
const cases = EVAL_CASES.filter((c) => !only || only.includes(c.caseId));

// --- validate the eval itself: every expected id must exist ---------------------
const problems: string[] = [];
for (const c of cases) {
  if (!defs.some((d) => d.id === c.caseId)) problems.push(`${c.caseId}: no such case`);
  for (const g of c.expectRetrieved) for (const id of g) {
    if (id.endsWith('*')) continue;
    const r = resolveRef(ix, id);
    if (r.kind === 'unknown' || /not found|line not in/.test(r.label)) problems.push(`${c.caseId}: expected id ${id} does not exist`);
  }
}
if (problems.length) { console.error(problems.join('\n')); process.exit(2); }
if (dry) { console.log(`Eval definitions OK: ${cases.length} cases, ${cases.reduce((a, c) => a + c.expectRetrieved.length, 0)} retrieval groups.`); process.exit(0); }

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is not set (env or new_assmt/.env). The eval needs a live model; no results were produced.');
  process.exit(3);
}
const model = process.env.COPILOT_MODEL || 'claude-sonnet-5-5';
const PRICE = PRICES[model] ?? PRICES['claude-sonnet-5-5'];
const provider = anthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY, model, effort: (process.env.COPILOT_EFFORT as any) || 'high', timeoutMs: 120_000 });

// --- scoring ---------------------------------------------------------------------
const lower = (s: string) => s.toLowerCase();
const anyMention = (text: string, group: string[]) => group.some((k) => lower(text).includes(lower(k)));
const ratio = (a: number, b: number) => (b === 0 ? null : a / b);

function score(c: EvalCase, run: InvestigationRun) {
  const rep = run.report;
  const v = run.validation;
  const retrieved = new Set(run.retrievedIds);
  const hit = (id: string) => (id.endsWith('*') ? run.retrievedIds.some((r) => r.startsWith(id.slice(0, -1))) : retrieved.has(id));
  const groupsHit = c.expectRetrieved.filter((g) => g.some(hit)).length;
  const text = rep ? [rep.summary, ...rep.facts.map((f) => f.statement), ...rep.hypotheses.map((h) => h.statement), ...rep.missing_information.map((m) => `${m.item} ${m.why_needed}`)].join(' ') : '';
  const stepsText = rep ? rep.recommended_next_steps.map((s) => `${s.action} ${s.rationale}`).join(' ') : '';
  const quantities = rep ? rep.facts.flatMap((f) => f.quantities) : [];
  const forbidden = c.forbidFactQuantity && rep
    ? rep.facts.some((f) => f.quantities.some((q) => Math.abs(q.value - c.forbidFactQuantity!.value) < 0.01 && q.evidence_id !== c.forbidFactQuantity!.unlessCites) || (f.evidence_ids.every((id) => id === c.forbidFactQuantity!.unlessCites) && f.quantities.some((q) => Math.abs(q.value - c.forbidFactQuantity!.value) < 0.01) && !/client|says|states|report/i.test(f.statement)))
    : false;
  return {
    outcome: run.outcome,
    usable: !!rep,
    retrievalRecall: ratio(groupsHit, c.expectRetrieved.length),
    citationValidity: v ? ratio(v.existingCited, v.citedIds.length) : null,
    citedWereRetrieved: v ? ratio(v.retrievedCited, v.citedIds.length) : null,
    quantityAccuracy: v ? ratio(v.quantitiesVerified, v.quantitiesChecked) : null,
    proseNumbersGrounded: v ? ratio(v.textNumbersFound, v.textNumbersChecked) : null,
    expectedQuantitiesFound: c.expectQuantities ? ratio(c.expectQuantities.filter((x) => quantities.some((q) => Math.abs(Math.abs(q.value) - x) < 0.01)).length, c.expectQuantities.length) : null,
    statusAcceptable: rep ? c.acceptableStatus.includes(rep.status) : false,
    status: rep?.status ?? null,
    mentions: c.mustMention ? ratio(c.mustMention.filter((g) => anyMention(text, g)).length, c.mustMention.length) : null,
    nextStepRelevance: c.nextStepMentions ? ratio(c.nextStepMentions.filter((g) => anyMention(stepsText, g)).length, c.nextStepMentions.length) : null,
    uncertaintyPreserved: c.expectMissingInfo ? !!rep && rep.missing_information.length > 0 : null,
    clientQuestion: c.expectClientQuestion ? !!rep?.client_question_draft : null,
    abstained: c.kind === 'abstain' || c.kind === 'negative' ? !!rep && rep.status !== 'confirmed_discrepancy' && !forbidden : null,
    validationIssues: v?.issues ?? [],
    schemaFailures: run.schemaFailures,
    latencyMs: run.latencyMs,
    tokens: run.usage,
    costUsd: (run.usage.inputTokens * PRICE.input + run.usage.outputTokens * PRICE.output + run.usage.cacheReadTokens * PRICE.cacheRead + run.usage.cacheWriteTokens * PRICE.cacheWrite) / 1e6,
    toolCalls: run.toolCalls,
    modelTurns: run.modelTurns,
    error: run.error,
  };
}

const results: any[] = [];
for (const c of cases) {
  for (let r = 0; r < repeat; r++) {
    process.stdout.write(`${c.caseId} (run ${r + 1}/${repeat}) … `);
    const run = await runInvestigation(provider, ix, defs, c.caseId);
    const s = score(c, run);
    results.push({ caseId: c.caseId, label: c.label, kind: c.kind, run: r + 1, score: s, report: run.report, trace: run.trace });
    console.log(`${run.outcome} status=${s.status} recall=${fmt(s.retrievalRecall)} cites=${fmt(s.citationValidity)} ${(run.latencyMs / 1000).toFixed(1)}s $${s.costUsd.toFixed(3)}`);
  }
}

function fmt(x: number | null | boolean) { return x === null ? '—' : typeof x === 'boolean' ? (x ? 'yes' : 'no') : `${Math.round(x * 100)}%`; }
const mean = (k: string) => { const xs = results.map((r) => r.score[k]).filter((x) => typeof x === 'number'); return xs.length ? xs.reduce((a: number, b: number) => a + b, 0) / xs.length : null; };
const rate = (k: string) => { const xs = results.map((r) => r.score[k]).filter((x) => typeof x === 'boolean'); return xs.length ? xs.filter(Boolean).length / xs.length : null; };
const summary = {
  model, runs: results.length, cases: cases.length, repeat, at: new Date().toISOString(),
  usableReports: rate('usable'),
  validatedRuns: results.filter((r) => r.score.outcome === 'validated').length / results.length,
  retrievalRecall: mean('retrievalRecall'), citationValidity: mean('citationValidity'), citedWereRetrieved: mean('citedWereRetrieved'),
  quantityAccuracy: mean('quantityAccuracy'), proseNumbersGrounded: mean('proseNumbersGrounded'), expectedQuantitiesFound: mean('expectedQuantitiesFound'),
  statusAcceptable: rate('statusAcceptable'), mentions: mean('mentions'), nextStepRelevance: mean('nextStepRelevance'),
  uncertaintyPreserved: rate('uncertaintyPreserved'), clientQuestion: rate('clientQuestion'), abstained: rate('abstained'),
  schemaFailuresTotal: results.reduce((a, r) => a + r.score.schemaFailures, 0),
  latencyMsMedian: [...results.map((r) => r.score.latencyMs)].sort((a, b) => a - b)[Math.floor(results.length / 2)],
  inputTokensTotal: results.reduce((a, r) => a + r.score.tokens.inputTokens + r.score.tokens.cacheReadTokens + r.score.tokens.cacheWriteTokens, 0),
  cacheReadTokens: results.reduce((a, r) => a + r.score.tokens.cacheReadTokens, 0), outputTokens: results.reduce((a, r) => a + r.score.tokens.outputTokens, 0),
  costUsd: results.reduce((a, r) => a + r.score.costUsd, 0),
};

console.log('\n| Case | Outcome | Status (ok?) | Recall | Cites exist | Cited⇒retrieved | Quantities | Expected amounts | Mentions | Next step | Missing info | Abstained | Issues | s |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of results) {
  const s = r.score;
  console.log(`| ${r.label} | ${s.outcome} | ${s.status ?? '—'} (${s.statusAcceptable ? 'yes' : 'no'}) | ${fmt(s.retrievalRecall)} | ${fmt(s.citationValidity)} | ${fmt(s.citedWereRetrieved)} | ${fmt(s.quantityAccuracy)} | ${fmt(s.expectedQuantitiesFound)} | ${fmt(s.mentions)} | ${fmt(s.nextStepRelevance)} | ${fmt(s.uncertaintyPreserved)} | ${fmt(s.abstained)} | ${s.validationIssues.length} | ${(s.latencyMs / 1000).toFixed(0)} |`);
}
console.log('\nSummary:', JSON.stringify(summary, null, 2));
mkdirSync(join(root, 'eval/results'), { recursive: true });
const out = join(root, 'eval/results', `run-${summary.at.replace(/[:.]/g, '-')}.json`);
writeFileSync(out, JSON.stringify({ summary, results }, null, 2));
console.log(`Saved ${out}`);
