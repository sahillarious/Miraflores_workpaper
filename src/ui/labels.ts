import type { CaseDef } from '../domain/cases';
import type { CaseStatus, ReconStatus } from '../domain/workflow';

// Plain-language labels for the UI. The domain keeps its own terms
// (STATUS_LABEL, RECON_LABEL, priority P1-P3); those stay visible in tooltips.

export type PriorityLevel = 'Blocker' | 'High' | 'Medium' | 'Low';

/** One label from severity and priority: blocker severity wins, otherwise the priority band. */
export function priorityLevel(d: CaseDef): PriorityLevel {
  if (d.severity === 'blocker') return 'Blocker';
  return d.priority === 'P1' ? 'High' : d.priority === 'P2' ? 'Medium' : 'Low';
}

export function priorityDetail(d: CaseDef): string {
  return `Priority ${d.priority} · score ${d.priorityScore} · severity ${d.severity}\n${d.priorityBasis}`;
}

export const STATUS_HELP: Record<CaseStatus, string> = {
  open: 'Nobody has started on this yet.',
  in_review: 'Someone is checking the evidence.',
  awaiting_client: 'Waiting for the client to answer a question.',
  blocked: 'Work is stopped until something outside the case is done.',
  ready_for_approval: 'A decision was submitted and is waiting for a reviewer or partner.',
  resolved: 'Approved and signed off.',
  reopened: 'Was resolved, then reopened with a reason.',
};

export const RECON_PLAIN: Record<ReconStatus, string> = {
  unchecked: 'Not reviewed yet',
  confirmed_discrepancy: 'Mismatch confirmed',
  explained: 'Difference explained',
  formatting_only: 'Only formatting differs',
  awaiting_evidence: 'Waiting for evidence',
  judgment_required: 'Needs reviewer judgment',
  resolved: 'Resolved with a reason',
};

export const originLabel = (d: CaseDef) => (d.origin === 'engine' ? 'Raised by the tax software' : 'Found by our checks');

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
