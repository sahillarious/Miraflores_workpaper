import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildIndex, type PacketIndex } from '../src/domain/packetIndex';
import { buildCases, type CaseDef } from '../src/domain/cases';
import type { Packet } from '../src/domain/types';
import { DEFAULT_BUDGET, runInvestigation, type ModelProvider } from '../src/copilot/agent';
import type { CopilotStatus } from '../src/copilot/types';
import { anthropicProvider } from './anthropic';

// HTTP API for the copilot. Read-only: it loads the packet from disk, runs an
// investigation and returns the result. It never writes workpaper state; the
// reviewer's decision is recorded by the browser through the normal command
// layer. Only metadata is logged (no prompts, evidence or report text).

export interface ApiOptions { packetPath: string; env?: NodeJS.ProcessEnv; provider?: ModelProvider | null; log?: (line: string) => void }

export function createCopilotApi(opts: ApiOptions) {
  const env = opts.env ?? process.env;
  const log = opts.log ?? ((l: string) => console.log(l));
  let loaded: { ix: PacketIndex; defs: CaseDef[] } | null = null;
  const load = () => (loaded ??= (() => { const ix = buildIndex(JSON.parse(readFileSync(opts.packetPath, 'utf-8')) as Packet); return { ix, defs: buildCases(ix) }; })());

  const model = env.COPILOT_MODEL || 'claude-sonnet-5-5';
  const effort = (env.COPILOT_EFFORT || 'high') as any;
  const provider: ModelProvider | null = opts.provider !== undefined ? opts.provider
    : env.ANTHROPIC_API_KEY ? anthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model, effort, timeoutMs: 120_000 }) : null;

  const inFlight = new Set<string>();
  const MAX_CONCURRENT = 2;

  const status = (): CopilotStatus => ({
    configured: !!provider, provider: provider?.name ?? 'none', model: provider ? provider.model : null,
    maxModelTurns: DEFAULT_BUDGET.maxModelTurns, maxToolCalls: DEFAULT_BUDGET.maxToolCalls,
    reason: provider ? undefined : 'ANTHROPIC_API_KEY is not set on the server. Add it to new_assmt/.env and restart.',
  });

  return async function handle(req: IncomingMessage, res: ServerResponse, next?: () => void) {
    const url = (req.url ?? '').split('?')[0];
    if (!url.startsWith('/api/copilot/')) return next ? next() : send(res, 404, { error: 'not found' });
    try {
      if (url === '/api/copilot/status' && req.method === 'GET') return send(res, 200, status());
      if (url === '/api/copilot/investigate' && req.method === 'POST') {
        const body = await readJson(req);
        const caseId = typeof body?.caseId === 'string' ? body.caseId : '';
        const { ix, defs } = load();
        if (!defs.some((d) => d.id === caseId)) return send(res, 400, { error: `Unknown case "${caseId}".` });
        if (!provider) return send(res, 503, { error: status().reason, outcome: 'unconfigured' });
        if (inFlight.has(caseId)) return send(res, 409, { error: 'An investigation for this case is already running.' });
        if (inFlight.size >= MAX_CONCURRENT) return send(res, 429, { error: 'Too many investigations running. Try again shortly.' });
        inFlight.add(caseId);
        try {
          const run = await runInvestigation(provider, ix, defs, caseId);
          log(`[copilot] ${run.runId} case=${caseId} outcome=${run.outcome} turns=${run.modelTurns} tools=${run.toolCalls} in=${run.usage.inputTokens + run.usage.cacheReadTokens + run.usage.cacheWriteTokens} (cached ${run.usage.cacheReadTokens}) out=${run.usage.outputTokens} ms=${run.latencyMs}${run.error ? ` error=${run.error.kind}` : ''}`);
          return send(res, 200, run);
        } finally {
          inFlight.delete(caseId);
        }
      }
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      log(`[copilot] request failed: ${(e as Error).message}`);
      return send(res, 500, { error: 'Internal error' });
    }
  };
}

function send(res: ServerResponse, code: number, body: unknown) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) { size += c.length; if (size > 10_000) throw new Error('body too large'); chunks.push(c as Buffer); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}'); } catch { return {}; }
}
