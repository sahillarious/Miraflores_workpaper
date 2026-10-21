import { readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildIndex, type PacketIndex } from '../src/domain/packetIndex';
import { buildCases, type CaseDef } from '../src/domain/cases';
import type { Packet } from '../src/domain/types';
import { DEFAULT_BUDGET, runInvestigation, type ModelProvider } from '../src/copilot/agent';
import type { CopilotStatus, InvestigationRun } from '../src/copilot/types';
import { anthropicProvider } from './anthropic';
import { cacheKey, sha256 } from './cacheKey';

// HTTP API for the copilot. Read-only: it loads the packet from disk, runs an
// investigation and returns the result. It never writes workpaper state; the
// reviewer's decision is recorded by the browser through the normal command
// layer. Only metadata is logged (no prompts, evidence, report text, access
// code or key).
//
// Demo gate, not user authentication: one shared access code (env
// COPILOT_ACCESS_CODE) protects the paid model calls. Limits are kept in
// memory, so they are reliable only for a single server process and reset
// when it restarts.

export interface ApiOptions {
  packetPath: string;
  env?: NodeJS.ProcessEnv;
  provider?: ModelProvider | null;
  log?: (line: string) => void;
  /** Clock, injectable for tests. */
  now?: () => number;
}

export const RUNS_PER_MINUTE = 3;
export const BAD_CODES_PER_MINUTE = 10;
export const DEFAULT_DAILY_CAP = 60;
const MAX_CONCURRENT = 2;

const SAFE_ERROR: Record<string, string> = {
  auth: 'The AI service rejected the server’s credentials. The rest of the workpaper still works.',
  rate_limited: 'The AI service is busy right now. Try again in a minute.',
  bad_request: 'The AI service could not process this request.',
  timeout: 'The investigation took too long and was stopped.',
  network: 'The AI service could not be reached.',
  server: 'The AI service had a temporary problem.',
  aborted: 'The investigation was stopped.',
  refused: 'The AI declined this request.',
  no_report: 'The AI stopped without producing a report.',
  budget: 'The AI did not produce a report within its step budget.',
  unknown: 'The investigation failed.',
};

/** Strip anything that could carry provider responses or internals from a run before it leaves the server. */
export function sanitizeRun(run: InvestigationRun): InvestigationRun {
  if (!run.error) return run;
  const safe = SAFE_ERROR[run.error.kind] ?? SAFE_ERROR.unknown;
  return {
    ...run,
    error: { kind: run.error.kind, message: safe },
    trace: run.trace.map((t) => (t.kind === 'model' && !t.ok ? { ...t, summary: `${run.error!.kind}: ${safe}` } : t)),
  };
}

export function createCopilotApi(opts: ApiOptions) {
  const env = opts.env ?? process.env;
  const log = opts.log ?? ((l: string) => console.log(l));
  const now = opts.now ?? Date.now;

  let loaded: { ix: PacketIndex; defs: CaseDef[]; packetHash: string } | null = null;
  const load = () => (loaded ??= (() => {
    const raw = readFileSync(opts.packetPath);
    const ix = buildIndex(JSON.parse(raw.toString('utf-8')) as Packet);
    return { ix, defs: buildCases(ix), packetHash: sha256(raw) };
  })());

  const model = env.COPILOT_MODEL || 'claude-sonnet-5-5';
  const effort = (env.COPILOT_EFFORT || 'high') as any;
  const provider: ModelProvider | null = opts.provider !== undefined ? opts.provider
    : env.ANTHROPIC_API_KEY ? anthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model, effort, timeoutMs: 120_000 }) : null;
  const accessCode = (env.COPILOT_ACCESS_CODE ?? '').trim();
  const codeDigest = accessCode ? Buffer.from(sha256(accessCode), 'hex') : null;
  const capEnv = Number(env.COPILOT_DAILY_CAP);
  const dailyCap = Number.isFinite(capEnv) && capEnv > 0 ? Math.floor(capEnv) : DEFAULT_DAILY_CAP;
  const trustProxy = env.COPILOT_TRUST_PROXY === '1';
  const enabled = !!provider && !!codeDigest;

  const runsByIp = new Map<string, number[]>();
  const badCodesByIp = new Map<string, number[]>();
  const day = { date: '', used: 0 };
  const inFlight = new Map<string, Promise<InvestigationRun>>();

  const keyFor = (def: CaseDef) => cacheKey({ caseId: def.id, packetHash: load().packetHash, def, model: provider?.model ?? model });
  const today = () => { const d = new Date(now()).toISOString().slice(0, 10); if (d !== day.date) { day.date = d; day.used = 0; } return day; };
  /** Count an event for this IP in the last minute; true if the limit is already reached. */
  const limited = (m: Map<string, number[]>, ip: string, limit: number, record: boolean) => {
    const t = now();
    const recent = (m.get(ip) ?? []).filter((x) => t - x < 60_000);
    const over = recent.length >= limit;
    if (record && !over) recent.push(t);
    m.set(ip, recent);
    return over;
  };

  const status = (): CopilotStatus => ({
    configured: enabled, provider: enabled ? provider!.name : 'none', model: enabled ? provider!.model : null,
    maxModelTurns: DEFAULT_BUDGET.maxModelTurns, maxToolCalls: DEFAULT_BUDGET.maxToolCalls,
    reason: !provider ? 'ANTHROPIC_API_KEY is not set on the server.' : !codeDigest ? 'COPILOT_ACCESS_CODE is not set on the server, so the AI copilot is switched off.' : undefined,
    accessCodeRequired: true,
    dailyCap,
    usedToday: today().used,
    cacheKeys: enabled ? Object.fromEntries(load().defs.map((d) => [d.id, keyFor(d)])) : undefined,
  });

  const clientIp = (req: IncomingMessage) => {
    if (trustProxy) {
      // Behind one proxy: the right-most entry is the address that proxy saw. Earlier entries are client-supplied.
      const xff = String(req.headers?.['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      if (xff.length) return xff[xff.length - 1];
    }
    return req.socket?.remoteAddress ?? 'unknown';
  };

  const codeOk = (req: IncomingMessage) => {
    const given = req.headers?.['x-access-code'];
    if (!codeDigest || typeof given !== 'string' || !given) return false;
    return timingSafeEqual(Buffer.from(sha256(given), 'hex'), codeDigest);
  };

  async function investigate(req: IncomingMessage, res: ServerResponse) {
    const body = await readJson(req);
    const caseId = typeof body?.caseId === 'string' ? body.caseId : '';
    const { ix, defs } = load();
    const def = defs.find((d) => d.id === caseId);
    if (!def) return send(res, 400, { error: 'Unknown case.' });
    if (!enabled) return send(res, 503, { error: status().reason, outcome: 'unconfigured' });

    const ip = clientIp(req);
    if (limited(badCodesByIp, ip, BAD_CODES_PER_MINUTE, false)) return send(res, 429, { error: 'Too many attempts with a wrong access code. Wait a minute.', outcome: 'rate_limited' });
    if (!codeOk(req)) {
      limited(badCodesByIp, ip, BAD_CODES_PER_MINUTE, true);
      return send(res, 401, { error: 'Access code missing or not accepted.', outcome: 'unauthorized' });
    }
    if (limited(runsByIp, ip, RUNS_PER_MINUTE, true)) return send(res, 429, { error: `At most ${RUNS_PER_MINUTE} investigations a minute. Wait a moment and try again.`, outcome: 'rate_limited' });

    const key = keyFor(def);
    const shared = inFlight.get(key);
    if (shared) return send(res, 200, { ...sanitizeRun(await shared), cacheKey: key, shared: true });

    const d = today();
    if (d.used >= dailyCap) return send(res, 429, { error: `Demo limit reached for today (${dailyCap} investigations). The rest of the workpaper keeps working; the limit resets at 00:00 UTC.`, outcome: 'cap' });
    if (inFlight.size >= MAX_CONCURRENT) return send(res, 429, { error: 'Too many investigations running. Try again shortly.', outcome: 'busy' });

    d.used++; // reserved now so concurrent requests cannot exceed the cap; refunded below if the model was never called
    const p = runInvestigation(provider!, ix, defs, caseId);
    inFlight.set(key, p);
    let run: InvestigationRun;
    try { run = await p; } finally { inFlight.delete(key); }
    if (!run.trace.some((t) => t.kind === 'model')) d.used--;
    log(`[copilot] ${run.runId} case=${caseId} outcome=${run.outcome} turns=${run.modelTurns} tools=${run.toolCalls} in=${run.usage.inputTokens + run.usage.cacheReadTokens + run.usage.cacheWriteTokens} (cached ${run.usage.cacheReadTokens}) out=${run.usage.outputTokens} ms=${run.latencyMs} used=${d.used}/${dailyCap}${run.error ? ` error=${run.error.kind}` : ''}`);
    return send(res, 200, { ...sanitizeRun(run), cacheKey: key });
  }

  return async function handle(req: IncomingMessage, res: ServerResponse, next?: () => void) {
    const url = (req.url ?? '').split('?')[0];
    if (!url.startsWith('/api/copilot/')) return next ? next() : send(res, 404, { error: 'not found' });
    try {
      if (url === '/api/copilot/status' && req.method === 'GET') return send(res, 200, status());
      if (url === '/api/copilot/investigate' && req.method === 'POST') return await investigate(req, res);
      return send(res, 404, { error: 'not found' });
    } catch {
      log('[copilot] request failed');
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
