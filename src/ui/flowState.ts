import type { CaseDef, SuggestedAdjustment } from '../domain/cases';
import type { PacketIndex } from '../domain/packetIndex';
import { refKind } from '../domain/refs';
import { caseFacts, PARTNER_THRESHOLD, type Adjustment, type WorkState } from '../domain/workflow';
import { comparePriority } from './labels';

// Read-only view model for the guided case flow. Everything here is derived
// from projected domain state (project -> caseFacts); nothing is stored, so
// the checklist can never disagree with the event log.

export type ItemState = 'done' | 'todo' | 'waiting' | 'stale' | 'na';
export interface CheckItem { id: 'evidence' | 'client' | 'adjustments' | 'decision'; label: string; state: ItemState; detail: string }

/** Link kinds closeBlockers counts as documentary evidence. Display only; closeBlockers stays the gate. */
const DOCUMENTARY_KINDS = ['ev', 'doc', 'docpage', 'agency', 'py'];

export interface FlowState {
  items: CheckItem[];
  /** Resolved and the last reviewer/partner sign-off no longer matches the evidence. */
  staleSignoff: boolean;
  /** Submitted for approval, but the evidence changed after submission (approval will be refused). */
  staleProposal: boolean;
  pending: Adjustment[];
  pendingApprover: 'partner' | 'reviewer' | null;
  defaultStep: 1 | 2 | 3 | 4;
}

/** Who must approve an adjustment: mirrors the threshold rule in authorize(). */
export const approverFor = (a: { federal: number; california: number }) =>
  (Math.max(Math.abs(a.federal), Math.abs(a.california)) > PARTNER_THRESHOLD ? 'partner' : 'reviewer');

export function flowState(ix: PacketIndex, def: CaseDef, st: WorkState): FlowState {
  const cs = st.cases[def.id];
  const f = caseFacts(ix, def, st);
  const staleProposal = cs.status === 'ready_for_approval' && !!cs.proposal && cs.proposal.fingerprint !== f.currentFingerprint;
  const stale = f.staleSignoff || staleProposal;

  const docLinks = cs.links.filter((l) => DOCUMENTARY_KINDS.includes(refKind(l.ref))).length;
  const evidence: CheckItem = cs.links.length
    ? { id: 'evidence', label: 'Evidence linked', state: 'done', detail: `${cs.links.length} linked (${docLinks} documentary)` }
    : { id: 'evidence', label: 'Evidence linked', state: 'todo', detail: def.suggestions.length ? 'Nothing linked yet (not needed for a correction backed by approved adjustments)' : 'Nothing linked yet' };

  const clientQs = cs.questions.filter((q) => q.to === 'client');
  const unanswered = clientQs.filter((q) => !q.answer).length;
  const client: CheckItem = !clientQs.length
    ? { id: 'client', label: 'Client answered', state: 'na', detail: 'No questions sent to the client' }
    : unanswered
      ? { id: 'client', label: 'Client answered', state: 'waiting', detail: `${unanswered} of ${clientQs.length} question(s) waiting for the client` }
      : { id: 'client', label: 'Client answered', state: 'done', detail: `${clientQs.length} question(s) answered` };

  const active = cs.adjustments.filter((a) => a.decision?.status !== 'rejected');
  const pending = f.pendingAdjustments;
  const pendingApprover = pending.length ? (pending.some((a) => approverFor(a) === 'partner') ? 'partner' : 'reviewer') : null;
  const adjustments: CheckItem = !active.length
    ? { id: 'adjustments', label: 'Adjustments approved', state: 'na', detail: 'No adjustments proposed' }
    : pending.length
      ? { id: 'adjustments', label: 'Adjustments approved', state: 'waiting', detail: `${pending.length} waiting for ${pendingApprover} approval` }
      : stale
        ? { id: 'adjustments', label: 'Adjustments approved', state: 'stale', detail: 'Approved, but the evidence changed since the sign-off' }
        : { id: 'adjustments', label: 'Adjustments approved', state: 'done', detail: `${active.length} approved` };

  let decision: CheckItem;
  if (cs.status === 'resolved') {
    decision = f.staleSignoff
      ? { id: 'decision', label: 'Decision submitted', state: 'stale', detail: 'Signed off, but the evidence changed afterwards. Reopen and reconsider.' }
      : { id: 'decision', label: 'Decision submitted', state: 'done', detail: 'Approved and signed off' };
  } else if (cs.status === 'ready_for_approval') {
    decision = staleProposal
      ? { id: 'decision', label: 'Decision submitted', state: 'stale', detail: 'The evidence changed after submission. A reviewer must return it.' }
      : { id: 'decision', label: 'Decision submitted', state: 'waiting', detail: f.needsPartner && cs.proposal?.outcome === 'corrected' ? 'Waiting for partner approval' : 'Waiting for reviewer or partner approval' };
  } else {
    decision = { id: 'decision', label: 'Decision submitted', state: 'todo', detail: 'Not submitted yet' };
  }

  const defaultStep = cs.status === 'resolved' || cs.status === 'ready_for_approval' ? 4 : pending.length ? 3 : 1;
  return { items: [evidence, client, adjustments, decision], staleSignoff: f.staleSignoff, staleProposal, pending, pendingApprover, defaultStep };
}

const fmt = (n: number) => Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2 });

/** Plain-words explanation of a suggested adjustment, using only numbers already on the case. */
export function explainSuggestion(def: CaseDef, s: SuggestedAdjustment): string {
  if (def.ruleId === 'WP-SUPPLEMENT-BASIS') {
    const lot = s.lineKey.split('.').pop();
    const basis = def.reconciliations.find((r) => r.id === `rsu-${s.lineKey}`)?.b.value;
    const change = s.to < 0 ? `the gain of ${fmt(s.from)} becomes a loss of ${fmt(s.to)}` : `the taxable gain drops from ${fmt(s.from)} to ${fmt(s.to)}`;
    return `The broker reported zero cost for lot ${lot}. The company statement (D11) gives a cost of ${typeof basis === 'number' ? fmt(basis) : 'the supplemental amount'}, so ${change}.`;
  }
  return `${s.reason}. ${s.lineKey} changes from ${fmt(s.from)}${s.from < 0 ? ' (negative)' : ''} to ${fmt(s.to)}${s.to < 0 ? ' (negative)' : ''}.`;
}

/** An adjustment on this line with this value that is still pending or approved (the domain refuses another). */
export function existingAdjustment(st: WorkState, def: CaseDef, s: SuggestedAdjustment): Adjustment | undefined {
  return st.cases[def.id].adjustments.find((a) => a.lineKey === s.lineKey && a.to === s.to && a.decision?.status !== 'rejected');
}

/**
 * The cases a person should work on next, most urgent first. Reviewers and
 * partners see what waits for their approval first (never their own work);
 * everyone then sees unresolved cases they own, then the rest, by priority.
 */
export function workList(ix: PacketIndex, defs: CaseDef[], st: WorkState, actor: { id: string; role: string }): CaseDef[] {
  const byPrio = comparePriority;
  const unresolved = defs.filter((d) => st.cases[d.id].status !== 'resolved').sort(byPrio);
  const approver = actor.role === 'partner' || actor.role === 'reviewer';
  const awaitingMe = approver ? unresolved.filter((d) => {
    const cs = st.cases[d.id];
    if (cs.status === 'ready_for_approval' && cs.proposal && cs.proposal.by !== actor.id) return true;
    return caseFacts(ix, d, st).pendingAdjustments.some((a) => a.by !== actor.id && (actor.role === 'partner' || approverFor(a) === 'reviewer'));
  }) : [];
  const workable = unresolved.filter((d) => st.cases[d.id].status !== 'ready_for_approval' && !awaitingMe.includes(d));
  const mine = workable.filter((d) => st.cases[d.id].owner === actor.id);
  const others = workable.filter((d) => st.cases[d.id].owner !== actor.id);
  return [...awaitingMe, ...mine, ...others];
}
