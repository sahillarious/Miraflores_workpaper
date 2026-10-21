import type { PacketIndex } from '../domain/packetIndex';
import { refKind, resolveRef } from '../domain/refs';
import { isVerified } from './clientCache';
import type { InvestigationRun } from './types';

// "Link these records as evidence": a narrow bridge from a verified report to
// the existing case.link command. It only proposes; a person clicks, and each
// link goes through authorize() like a manual one. Being cited by the AI does
// not mean a record proves anything, and the substantiation rules still apply.

/** Link kinds closeBlockers counts as documentary evidence (calc ids, line keys and client statements do not count). */
export const DOCUMENTARY_KINDS = ['ev', 'doc', 'docpage', 'agency', 'py'];

export interface LinkCandidate { ref: string; label: string; documentary: boolean; reason: string }

/**
 * Records a verified report cites in its facts (not its hypotheses) that were
 * retrieved in that run, exist in the packet, and are not already linked.
 * Calculation ids are never candidates: they are not packet records.
 */
export function linkCandidates(ix: PacketIndex, run: InvestigationRun | null, alreadyLinked: Set<string>): LinkCandidate[] {
  if (!run || !isVerified(run)) return [];
  const retrieved = new Set(run.retrievedIds);
  const out = new Map<string, LinkCandidate>();
  for (const f of run.report!.facts) {
    for (const ref of [...f.evidence_ids, ...f.quantities.map((q) => q.evidence_id)]) {
      if (out.has(ref) || alreadyLinked.has(ref) || ref.startsWith('calc-') || !retrieved.has(ref)) continue;
      const r = resolveRef(ix, ref);
      if (r.kind === 'unknown' || /not found|unknown/i.test(r.label)) continue;
      out.set(ref, { ref, label: r.label, documentary: DOCUMENTARY_KINDS.includes(refKind(ref)), reason: f.statement.length > 160 ? `${f.statement.slice(0, 159)}…` : f.statement });
    }
  }
  return [...out.values()];
}

/** The case.link payload for one candidate; the reason records that the AI cited it. */
export const linkCommand = (caseId: string, runId: string, c: LinkCandidate) =>
  ({ type: 'case.link' as const, payload: { caseId, ref: c.ref, why: `Cited by AI analysis ${runId}: ${c.reason}` } });
