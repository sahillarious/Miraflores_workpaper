import type { CaseDef } from '../domain/cases';
import type { PacketIndex } from '../domain/packetIndex';
import { reportJsonSchema, ReportSchema } from './schema';
import { executeTool, ToolContext, ToolError, TOOL_DEFS } from './tools';
import type { InvestigationReport, InvestigationRun, TraceStep } from './types';
import { verifyReport } from './verify';

// One bounded investigation. The model chooses which read-only tools to call;
// the loop enforces a turn and tool-call budget and an overall deadline, and
// ends only when the model submits a report that passes schema validation (or
// the budget runs out). The report is then verified deterministically.

export interface ModelBlock { type: string; [k: string]: any }
export interface ModelResponse {
  content: ModelBlock[];
  stop_reason: string | null;
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
  model: string;
}
export interface ModelRequest { system: string; messages: any[]; tools: any[] }
export interface ModelProvider {
  readonly name: string;
  readonly model: string;
  create(req: ModelRequest, signal: AbortSignal): Promise<ModelResponse>;
}

export class ProviderError extends Error {
  constructor(public kind: 'auth' | 'rate_limited' | 'bad_request' | 'timeout' | 'network' | 'server' | 'aborted' | 'refused' | 'unknown', message: string) { super(message); }
}

export interface Budget { maxModelTurns: number; maxToolCalls: number; deadlineMs: number }
export const DEFAULT_BUDGET: Budget = { maxModelTurns: 10, maxToolCalls: 18, deadlineMs: 240_000 };

export const SYSTEM_PROMPT = `You are an investigation assistant inside a tax-workpaper review tool. A CPA reviewer has opened one review case and asked you to investigate it. You do not prepare, approve or correct the return; you help the reviewer see what the records establish and what to do next.

How to work:
- Start with get_case. It gives the question and pointers to evidence, not the answer.
- Retrieve the records you rely on (get_evidence, get_document_context, search_evidence, compare_return_versions). Look for records that could explain or contradict the issue, including pages the pipeline did not extract and client messages.
- Use calculate_difference for every difference or total you state; do not do arithmetic yourself.
- Finish by calling submit_report once. Do not write the report as plain text.

Rules for the report:
- Cite only ids returned by your tool calls in this conversation. Every fact needs at least one id; every amount in a fact goes in "quantities" with the one id (record or calc id) it comes from.
- Separate facts (what a retrieved record shows) from hypotheses (possible explanations, with how to test them).
- A difference between two numbers is an observation, not an error. Use "confirmed_discrepancy" only when the records themselves show what is wrong; "likely_issue" when the records point that way but need verification; "unresolved_discrepancy" when a difference is real but unexplained; "judgment_required" when the facts are known but the treatment is a professional judgment; "insufficient_evidence" when the records cannot answer the question. A client's statement alone does not establish a fact about amounts or dates.
- Do not state tax law conclusions, final tax effects, or that the return is correct or incorrect. The reviewer decides.
- Draft a client question only when the client can supply what is missing; it will be reviewed by a person before anything is sent.
- If the evidence is insufficient, say so and list what is missing.

Tool budget: ${DEFAULT_BUDGET.maxToolCalls} tool calls. Prefer fetching several ids in one get_evidence call.`;

const SUBMIT_TOOL = {
  name: 'submit_report',
  description: 'Submit the final investigation report. Call exactly once, after retrieving the evidence you cite. Schema is validated; on errors you will be told what to fix.',
  input_schema: reportJsonSchema,
  strict: true,
};

export function toolDefinitions() {
  return [...TOOL_DEFS.map((t) => ({ ...t, strict: true })), SUBMIT_TOOL];
}

const short = (s: string, n = 160) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export async function runInvestigation(
  provider: ModelProvider,
  ix: PacketIndex,
  defs: CaseDef[],
  caseId: string,
  opts: { budget?: Partial<Budget>; runId?: string; now?: () => number } = {},
): Promise<InvestigationRun> {
  const budget = { ...DEFAULT_BUDGET, ...opts.budget };
  const now = opts.now ?? Date.now;
  const t0 = now();
  const def = defs.find((d) => d.id === caseId);
  const run: InvestigationRun = {
    runId: opts.runId ?? `run-${t0.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    caseId, outcome: 'incomplete', model: provider.model, startedAt: new Date(t0).toISOString(), latencyMs: 0,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    modelTurns: 0, toolCalls: 0, schemaFailures: 0, trace: [], retrievedIds: [], report: null, validation: null,
  };
  const finish = () => { run.latencyMs = now() - t0; return run; };
  if (!def) { run.outcome = 'error'; run.error = { kind: 'bad_request', message: `Unknown case ${caseId}` }; return finish(); }

  const ctx = new ToolContext(ix, defs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budget.deadlineMs);
  const step = (s: Omit<TraceStep, 'index'>) => run.trace.push({ index: run.trace.length + 1, ...s });
  const messages: any[] = [{ role: 'user', content: `Investigate review case ${caseId} ("${def.title}"). Use the tools, then call submit_report.` }];
  const tools = toolDefinitions();
  let nudged = false;

  try {
    while (run.modelTurns < budget.maxModelTurns) {
      const ts = now();
      let resp: ModelResponse;
      try {
        resp = await provider.create({ system: SYSTEM_PROMPT, messages, tools }, controller.signal);
      } catch (e) {
        const pe = e instanceof ProviderError ? e : new ProviderError(controller.signal.aborted ? 'timeout' : 'unknown', (e as Error).message);
        if (controller.signal.aborted) { pe.kind = 'timeout'; pe.message = `Investigation exceeded ${Math.round(budget.deadlineMs / 1000)} s.`; }
        step({ kind: 'model', name: provider.model, ok: false, summary: `${pe.kind}: ${short(pe.message)}`, ms: now() - ts });
        run.outcome = 'error';
        run.error = { kind: pe.kind, message: pe.message };
        return finish();
      }
      run.modelTurns++;
      run.usage.inputTokens += resp.usage.input_tokens ?? 0;
      run.usage.outputTokens += resp.usage.output_tokens ?? 0;
      run.usage.cacheReadTokens += resp.usage.cache_read_input_tokens ?? 0;
      run.usage.cacheWriteTokens += resp.usage.cache_creation_input_tokens ?? 0;
      run.model = resp.model;
      const uses = resp.content.filter((b) => b.type === 'tool_use');
      const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ');
      step({ kind: 'model', name: resp.model, ok: true, summary: `turn ${run.modelTurns}: ${uses.length ? uses.map((u) => u.name).join(', ') : 'no tool call'}${text ? ` — "${short(text, 100)}"` : ''} (stop: ${resp.stop_reason})`, ms: now() - ts });

      if (resp.stop_reason === 'refusal') { run.outcome = 'error'; run.error = { kind: 'refused', message: 'The model declined this request.' }; return finish(); }
      if (resp.stop_reason === 'max_tokens') { run.outcome = 'error'; run.error = { kind: 'bad_request', message: 'Model output hit max_tokens; tool input may be truncated, so nothing was executed.' }; return finish(); }

      messages.push({ role: 'assistant', content: resp.content });
      if (resp.stop_reason === 'pause_turn') continue;

      if (!uses.length) {
        if (nudged) { run.error = { kind: 'no_report', message: 'Model stopped without calling submit_report.' }; return finish(); }
        nudged = true;
        messages.push({ role: 'user', content: 'Please call submit_report with your findings (plain-text answers are not accepted).' });
        continue;
      }

      const results: any[] = [];
      for (const u of uses) {
        const tt = now();
        if (u.name === 'submit_report') {
          const parsed = ReportSchema.safeParse(u.input);
          if (!parsed.success) {
            run.schemaFailures++;
            const msg = parsed.error.issues.slice(0, 12).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
            step({ kind: 'tool', name: 'submit_report', ok: false, summary: `schema validation failed: ${short(msg, 220)}`, ms: now() - tt });
            results.push({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: `Report rejected by schema validation. Fix and resubmit: ${msg}` });
            continue;
          }
          run.report = parsed.data as InvestigationReport;
          step({ kind: 'tool', name: 'submit_report', ok: true, summary: `report submitted (status: ${parsed.data.status})`, ms: now() - tt });
          results.push({ type: 'tool_result', tool_use_id: u.id, content: 'Report received.' });
          continue;
        }
        if (run.toolCalls >= budget.maxToolCalls) {
          step({ kind: 'tool', name: u.name, input: u.input, ok: false, summary: 'refused: tool budget exhausted', ms: 0 });
          results.push({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: 'Tool budget exhausted. Call submit_report now with what you have, marking gaps as missing information.' });
          continue;
        }
        run.toolCalls++;
        try {
          const out = executeTool(ctx, u.name, u.input);
          step({ kind: 'tool', name: u.name, input: u.input, ok: true, summary: `${out.refs.length} record(s) returned${out.refs.length ? `: ${short(out.refs.slice(0, 6).join(', '), 120)}` : ''}`, ms: now() - tt });
          results.push({ type: 'tool_result', tool_use_id: u.id, content: out.text });
        } catch (e) {
          const msg = e instanceof ToolError ? e.message : `Tool failed: ${(e as Error).message}`;
          step({ kind: 'tool', name: u.name, input: u.input, ok: false, summary: short(msg), ms: now() - tt });
          results.push({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: msg });
        }
      }
      if (run.report) break;
      const left = budget.maxToolCalls - run.toolCalls;
      const turnsLeft = budget.maxModelTurns - run.modelTurns;
      messages.push({ role: 'user', content: [...results, { type: 'text', text: `Budget left: ${left} tool call(s), ${turnsLeft} turn(s).${turnsLeft <= 2 ? ' Submit your report on the next turn.' : ''}` }] });
    }
  } finally {
    clearTimeout(timer);
  }

  run.retrievedIds = [...ctx.retrieved];
  if (!run.report) {
    if (!run.error) run.error = { kind: 'budget', message: `No valid report within ${budget.maxModelTurns} turns.` };
    run.outcome = 'incomplete';
    return finish();
  }
  run.validation = verifyReport(ctx, def, run.report);
  run.outcome = run.validation.passed ? 'validated' : 'unverified';
  return finish();
}
