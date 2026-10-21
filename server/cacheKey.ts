import { createHash } from 'node:crypto';
import type { CaseDef } from '../src/domain/cases';
import { SYSTEM_PROMPT, toolDefinitions } from '../src/copilot/agent';
import { VERIFIER_VERSION } from '../src/copilot/verify';

// Cache key for a copilot report: the case, the exact packet, the exact case
// definition, the copilot's prompt/tools/verifier and the model. The copilot
// reads only the immutable packet, so nothing else can change its answer;
// workpaper events it cannot see never make a report stale.

export const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

/** Changes whenever the system prompt, the tool definitions or the verifier version change. */
export const copilotVersion = () => sha256(SYSTEM_PROMPT + JSON.stringify(toolDefinitions()) + VERIFIER_VERSION).slice(0, 16);

export function cacheKey(p: { caseId: string; packetHash: string; def: CaseDef; model: string }): string {
  return sha256([p.caseId, p.packetHash, sha256(JSON.stringify(p.def)), copilotVersion(), p.model].join('|')).slice(0, 32);
}
