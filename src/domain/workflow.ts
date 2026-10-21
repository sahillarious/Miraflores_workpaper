import type { CaseDef, Outcome } from './cases';
import { refKind } from './refs';
import type { PacketIndex } from './packetIndex';

// The workpaper's own records live in one append-only event log. State is a
// pure fold over the log, so history, "changed since I last looked", undo
// (an "undo" event that hides an earlier one) and stale sign-offs all come
// from the same source. Nothing in the packet is ever modified.

export type Role = 'preparer' | 'reviewer' | 'partner' | 'admin' | 'client';

export interface Actor { id: string; name: string; role: Role; clearance: boolean; title: string }

export type CaseStatus = 'open' | 'in_review' | 'awaiting_client' | 'blocked' | 'ready_for_approval' | 'resolved' | 'reopened';

export const STATUS_LABEL: Record<CaseStatus, string> = {
  open: 'Open', in_review: 'In review', awaiting_client: 'Awaiting client', blocked: 'Blocked',
  ready_for_approval: 'Ready for approval', resolved: 'Resolved', reopened: 'Reopened',
};

export const OUTCOME_LABEL: Record<Outcome, string> = {
  corrected: 'Corrected (adjustment)', substantiated: 'Substantiated by evidence', explained_difference: 'Explained difference',
  formatting_only: 'Formatting-only difference', accepted_as_is: 'Accepted as filed (judgment)', not_applicable: 'Not applicable',
  out_of_scope_referred: 'Out of scope - referred', acknowledged: 'Acknowledged',
};

export type Disposition = 'received' | 'awaiting_review' | 'reviewed' | 'primary' | 'duplicate' | 'superseded' | 'supplemental' | 'out_of_scope';
export const DISPOSITION_LABEL: Record<Disposition, string> = {
  received: 'Received (used by engine, not reviewed)', awaiting_review: 'Awaiting review', reviewed: 'Reviewed', primary: 'Primary source',
  duplicate: 'Duplicate / re-upload', superseded: 'Superseded', supplemental: 'Supplemental evidence', out_of_scope: 'Out of scope',
};

export type ReconStatus = 'unchecked' | 'confirmed_discrepancy' | 'explained' | 'formatting_only' | 'awaiting_evidence' | 'judgment_required' | 'resolved';
export const RECON_LABEL: Record<ReconStatus, string> = {
  unchecked: 'Unchecked', confirmed_discrepancy: 'Confirmed discrepancy', explained: 'Explained difference', formatting_only: 'Formatting-only',
  awaiting_evidence: 'Awaiting evidence', judgment_required: 'Reviewer judgment required', resolved: 'Resolved with rationale',
};

export type EventType =
  | 'case.status' | 'case.assign' | 'case.note' | 'case.note.clear' | 'case.link' | 'case.unlink'
  | 'case.question' | 'case.answer' | 'case.recon' | 'case.adjust' | 'case.adjust.decide'
  | 'case.propose' | 'case.resolve' | 'case.return' | 'case.reopen'
  | 'doc.disposition' | 'sensitive.view' | 'engagement.signoff' | 'undo'
  | 'copilot.run' | 'copilot.review';

export interface WEvent {
  id: string;
  seq: number;
  at: string;
  actor: string;
  role: Role;
  type: EventType;
  payload: any;
  batch?: string;
}

export interface Note { id: string; text: string; blocking: boolean; by: string; at: string; cleared?: { by: string; at: string; text: string } }
export interface Link { ref: string; why: string; by: string; at: string }
export interface Question { id: string; to: 'client' | 'staff'; toWho: string; text: string; expected: string; by: string; at: string; answer?: { text: string; by: string; at: string; eventId: string } }
export interface Adjustment { id: string; lineKey: string; from: number; to: number; reason: string; federal: number; california: number; by: string; at: string; decision?: { status: 'approved' | 'rejected'; by: string; at: string; note: string } }
export interface Proposal { outcome: Outcome; rationale: string; by: string; at: string; fingerprint: string }
/** An AI investigation and the reviewer's decision on it. Kept apart from findings, adjustments and sign-offs. */
export interface CopilotRecord {
  runId: string;
  at: string;
  by: string;
  outcome: string;
  model: string | null;
  validationPassed: boolean;
  issues: number;
  status: string | null;
  summary: string | null;
  citedIds: string[];
  nextStep: string | null;
  usage?: { inputTokens: number; outputTokens: number; latencyMs: number; toolCalls: number };
  review?: { decision: 'accepted' | 'edited' | 'rejected'; note: string; editedText?: string; by: string; at: string };
}
export interface Signoff { level: 'preparer' | 'reviewer' | 'partner'; by: string; at: string; fingerprint: string }

export interface CaseState {
  status: CaseStatus;
  owner: string;
  notes: Note[];
  links: Link[];
  questions: Question[];
  recon: Record<string, { status: ReconStatus; note: string; by: string; at: string }>;
  adjustments: Adjustment[];
  proposal?: Proposal;
  resolution?: Proposal & { approvedBy: string; approvedAt: string };
  signoffs: Signoff[];
  copilot: CopilotRecord[];
  history: WEvent[];
  lastChange?: string;
}

export interface DocState { disposition: Disposition; note?: string; by?: string; at?: string; history: WEvent[] }

export interface WorkState {
  cases: Record<string, CaseState>;
  docs: Record<string, DocState>;
  engagementSignoffs: Signoff[];
  views: WEvent[];
  events: WEvent[]; // effective (non-undone) events in order
  undone: Set<string>;
}

// --- actors ----------------------------------------------------------------

export function buildActors(ix: PacketIndex): Actor[] {
  const staff = ix.packet.firm.staff as any[];
  const roleOf = (r: string): Role => (r === 'preparer' ? 'preparer' : r === 'reviewer' ? 'reviewer' : r === 'partner' ? 'partner' : 'admin');
  const actors: Actor[] = staff
    .filter((s) => s.active_from <= '2026-10-15')
    .map((s) => ({ id: s.id, name: s.name, role: roleOf(s.role), clearance: s.sensitive_data_clearance, title: `${s.role.replace(/_/g, ' ')}${s.credential ? `, ${s.credential}` : ''}${s.sensitive_data_clearance ? '' : ' (no sensitive-data clearance)'}` }));
  for (const c of ix.packet.firm.client_users as any[]) actors.push({ id: c.id, name: c.name, role: 'client', clearance: false, title: 'client' });
  return actors;
}

// --- initial document dispositions (derived, not decided) -------------------

export function initialDisposition(ix: PacketIndex, docId: string): Disposition {
  const v = ix.current;
  if (v.documents_superseded.includes(docId)) return 'superseded';
  if (!v.documents_used.includes(docId)) return 'awaiting_review';
  return 'received';
}

// --- fingerprint: what a sign-off covers --------------------------------------

export function caseDocRefs(def: CaseDef, ix: PacketIndex): string[] {
  const out = new Set<string>();
  for (const r of def.refs) {
    const k = refKind(r);
    if (k === 'doc') out.add(r);
    if (k === 'ev') { const e = ix.evs.get(r); if (e) out.add(e.document_id); }
    if (k === 'docpage') out.add(r.slice(4, 7));
  }
  return [...out].sort();
}

export function fingerprint(cs: CaseState, def: CaseDef, docs: Record<string, DocState>, ix: PacketIndex): string {
  const body = JSON.stringify({
    links: cs.links.map((l) => l.ref).sort(),
    adj: cs.adjustments.map((a) => [a.id, a.to, a.decision?.status ?? 'pending']),
    answers: cs.questions.map((q) => [q.id, q.answer?.text ?? null]),
    recon: Object.entries(cs.recon).map(([k, v]) => [k, v.status]).sort(),
    docs: caseDocRefs(def, ix).map((d) => [d, docs[d]?.disposition]),
  });
  let h = 5381;
  for (let i = 0; i < body.length; i++) h = ((h << 5) + h + body.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// --- projection -----------------------------------------------------------------

export function emptyCase(def: CaseDef): CaseState {
  return { status: 'open', owner: def.defaultOwner, notes: [], links: [], questions: [], recon: {}, adjustments: [], signoffs: [], copilot: [], history: [] };
}

export function project(ix: PacketIndex, defs: CaseDef[], log: WEvent[]): WorkState {
  const undone = new Set<string>();
  for (const e of log) if (e.type === 'undo') for (const id of e.payload.eventIds as string[]) undone.add(id);
  const cases: Record<string, CaseState> = Object.fromEntries(defs.map((d) => [d.id, emptyCase(d)]));
  const docs: Record<string, DocState> = Object.fromEntries(ix.packet.documents.map((d) => [d.id, { disposition: initialDisposition(ix, d.id), history: [] }]));
  const engagementSignoffs: Signoff[] = [];
  const views: WEvent[] = [];
  const events: WEvent[] = [];
  const defById = new Map(defs.map((d) => [d.id, d]));

  for (const e of log) {
    if (undone.has(e.id)) continue;
    events.push(e);
    const p = e.payload;
    if (e.type === 'sensitive.view') { views.push(e); continue; }
    if (e.type === 'undo') continue;
    if (e.type === 'engagement.signoff') { engagementSignoffs.push({ level: p.level, by: e.actor, at: e.at, fingerprint: p.fingerprint }); continue; }
    if (e.type === 'doc.disposition') {
      const d = docs[p.docId];
      if (!d) continue;
      d.disposition = p.disposition; d.note = p.note; d.by = e.actor; d.at = e.at; d.history.push(e);
      continue;
    }
    const cs = cases[p.caseId];
    if (!cs) continue;
    cs.history.push(e);
    cs.lastChange = e.at;
    switch (e.type) {
      case 'case.status': cs.status = p.to; break;
      case 'case.assign': cs.owner = p.to; break;
      case 'case.note': cs.notes.push({ id: p.noteId, text: p.text, blocking: !!p.blocking, by: e.actor, at: e.at }); break;
      case 'case.note.clear': { const n = cs.notes.find((x) => x.id === p.noteId); if (n) n.cleared = { by: e.actor, at: e.at, text: p.text }; break; }
      case 'case.link': if (!cs.links.some((l) => l.ref === p.ref)) cs.links.push({ ref: p.ref, why: p.why, by: e.actor, at: e.at }); break;
      case 'case.unlink': cs.links = cs.links.filter((l) => l.ref !== p.ref); break;
      case 'case.question':
        cs.questions.push({ id: p.qid, to: p.to, toWho: p.toWho, text: p.text, expected: p.expected, by: e.actor, at: e.at });
        if (p.to === 'client' && cs.status !== 'resolved') cs.status = 'awaiting_client';
        break;
      case 'case.answer': {
        const q = cs.questions.find((x) => x.id === p.qid);
        if (q) q.answer = { text: p.text, by: e.actor, at: e.at, eventId: e.id };
        if (cs.status === 'awaiting_client' && cs.questions.every((x) => x.answer)) cs.status = 'in_review';
        break;
      }
      case 'case.recon': cs.recon[p.recId] = { status: p.status, note: p.note, by: e.actor, at: e.at }; break;
      case 'case.adjust':
        cs.adjustments.push({ id: p.adjId, lineKey: p.lineKey, from: p.from, to: p.to, reason: p.reason, federal: p.federal, california: p.california, by: e.actor, at: e.at });
        break;
      case 'case.adjust.decide': { const a = cs.adjustments.find((x) => x.id === p.adjId); if (a) a.decision = { status: p.decision, by: e.actor, at: e.at, note: p.note }; break; }
      case 'case.propose':
        cs.proposal = { outcome: p.outcome, rationale: p.rationale, by: e.actor, at: e.at, fingerprint: p.fingerprint };
        cs.signoffs.push({ level: 'preparer', by: e.actor, at: e.at, fingerprint: p.fingerprint });
        cs.status = 'ready_for_approval';
        break;
      case 'case.resolve':
        if (cs.proposal) cs.resolution = { ...cs.proposal, approvedBy: e.actor, approvedAt: e.at };
        cs.signoffs.push({ level: e.role === 'partner' ? 'partner' : 'reviewer', by: e.actor, at: e.at, fingerprint: p.fingerprint });
        cs.status = 'resolved';
        break;
      case 'case.return': cs.status = 'in_review'; cs.proposal = undefined; break;
      case 'case.reopen': cs.status = 'reopened'; cs.resolution = undefined; cs.proposal = undefined; break;
      case 'copilot.run':
        cs.copilot.push({ runId: p.runId, at: e.at, by: e.actor, outcome: p.outcome, model: p.model ?? null, validationPassed: !!p.validationPassed, issues: p.issues ?? 0, status: p.status ?? null, summary: p.summary ?? null, citedIds: p.citedIds ?? [], nextStep: p.nextStep ?? null, usage: p.usage });
        break;
      case 'copilot.review': {
        const r = cs.copilot.find((x) => x.runId === p.runId);
        if (r) r.review = { decision: p.decision, note: p.note ?? '', editedText: p.editedText, by: e.actor, at: e.at };
        break;
      }
    }
    void defById;
  }
  return { cases, docs, engagementSignoffs, views, events, undone };
}

// --- derived per-case facts -------------------------------------------------------

export interface CaseFacts {
  openQuestions: Question[];
  blockingNotes: Note[];
  pendingAdjustments: Adjustment[];
  approvedAdjustments: Adjustment[];
  currentFingerprint: string;
  staleSignoff: boolean;
  needsPartner: boolean;
}

export const PARTNER_THRESHOLD = 1000;

export function caseFacts(ix: PacketIndex, def: CaseDef, st: WorkState): CaseFacts {
  const cs = st.cases[def.id];
  const fp = fingerprint(cs, def, st.docs, ix);
  const lastSign = [...cs.signoffs].reverse().find((s) => s.level !== 'preparer');
  return {
    openQuestions: cs.questions.filter((q) => !q.answer),
    blockingNotes: cs.notes.filter((n) => n.blocking && !n.cleared),
    pendingAdjustments: cs.adjustments.filter((a) => !a.decision),
    approvedAdjustments: cs.adjustments.filter((a) => a.decision?.status === 'approved'),
    currentFingerprint: fp,
    staleSignoff: cs.status === 'resolved' && !!lastSign && lastSign.fingerprint !== fp,
    needsPartner: cs.adjustments.some((a) => Math.max(Math.abs(a.federal), Math.abs(a.california)) > PARTNER_THRESHOLD),
  };
}

// --- commands: validated before an event is appended --------------------------------

export interface Command { type: EventType; payload: any; batch?: string }

const TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  open: ['in_review', 'awaiting_client', 'blocked'],
  in_review: ['awaiting_client', 'blocked', 'open'],
  awaiting_client: ['in_review', 'blocked'],
  blocked: ['in_review', 'open'],
  ready_for_approval: [],
  resolved: [],
  reopened: ['in_review', 'awaiting_client', 'blocked'],
};
export const allowedTransitions = (s: CaseStatus) => TRANSITIONS[s];

const STAFF: Role[] = ['preparer', 'reviewer', 'partner'];

/** Returns a reason the command is refused, or null if allowed. */
export function authorize(ix: PacketIndex, defs: Map<string, CaseDef>, st: WorkState, actor: Actor, cmd: Command): string | null {
  const p = cmd.payload ?? {};
  const isStaff = STAFF.includes(actor.role);
  if (cmd.type === 'sensitive.view') return actor.clearance ? null : `${actor.name} has no sensitive-data clearance; unmasking is not permitted.`;
  if (cmd.type === 'undo') {
    const targets = st.events.filter((e) => (p.eventIds as string[]).includes(e.id));
    if (!targets.length) return 'Nothing to undo.';
    if (targets.some((e) => e.actor !== actor.id) && actor.role !== 'partner') return 'Only the person who made a change (or a partner) can undo it.';
    const caseIds = new Set(targets.map((e) => e.payload.caseId ?? e.payload.docId));
    const lastIdx = Math.max(...targets.map((e) => st.events.indexOf(e)));
    const later = st.events.slice(lastIdx + 1).filter((e) => caseIds.has(e.payload?.caseId ?? e.payload?.docId) && !targets.includes(e) && e.type !== 'sensitive.view' && e.type !== 'undo');
    if (later.length) return 'Later changes were made to the same item; undo those first.';
    return null;
  }
  if (cmd.type === 'engagement.signoff') {
    if (p.level === 'partner' && actor.role !== 'partner') return 'Only a partner can give the partner sign-off.';
    if (p.level === 'reviewer' && !['reviewer', 'partner'].includes(actor.role)) return 'Only a reviewer or partner can give the reviewer sign-off.';
    if (p.level === 'partner' && !st.engagementSignoffs.some((s) => s.level === 'reviewer')) return 'The reviewer signs off before the partner.';
    const open = [...defs.values()].filter((d) => st.cases[d.id].status !== 'resolved' || caseFacts(ix, d, st).staleSignoff);
    if (open.length) return `${open.length} case(s) are unresolved or have stale sign-offs.`;
    const unaccounted = ix.packet.documents.filter((d) => ['received', 'awaiting_review'].includes(st.docs[d.id].disposition));
    if (unaccounted.length) return `${unaccounted.length} document(s) have no reviewed disposition.`;
    return null;
  }
  if (cmd.type === 'doc.disposition') {
    if (!isStaff) return 'Only firm staff can set a document disposition.';
    if (!ix.docs.has(p.docId)) return `Unknown document ${p.docId}.`;
    return null;
  }

  const def = defs.get(p.caseId);
  const cs = st.cases[p.caseId];
  if (!def || !cs) return `Unknown case ${p.caseId}.`;

  if (actor.role === 'client') {
    if (cmd.type !== 'case.answer') return 'Clients can only answer questions sent to them.';
    const q = cs.questions.find((x) => x.id === p.qid);
    if (!q || q.to !== 'client') return 'This question was not sent to the client.';
    if (q.answer) return 'Already answered.';
    if (!String(p.text ?? '').trim()) return 'An answer is required.';
    return null;
  }
  if (actor.role === 'admin') return 'The administrator role manages firm settings and cannot change review cases.';

  const resolved = cs.status === 'resolved';
  const facts = caseFacts(ix, def, st);

  switch (cmd.type) {
    case 'case.status': {
      if (!allowedTransitions(cs.status).includes(p.to)) return `Cannot move from ${STATUS_LABEL[cs.status]} to ${STATUS_LABEL[p.to as CaseStatus] ?? p.to}.`;
      if (p.to === 'blocked' && !String(p.note ?? '').trim()) return 'Say what the case is blocked on.';
      return null;
    }
    case 'case.assign': return actor.role === 'preparer' && p.to !== actor.id && cs.owner !== actor.id ? 'Preparers can only assign cases they own (or take one).' : null;
    case 'case.note': return String(p.text ?? '').trim().length < 3 ? 'Write a note.' : p.blocking && actor.role === 'preparer' ? 'Only reviewers and partners raise blocking review notes.' : null;
    case 'case.note.clear': {
      const n = cs.notes.find((x) => x.id === p.noteId);
      if (!n) return 'Unknown note.';
      if (n.cleared) return 'Already cleared.';
      if (n.blocking && actor.role === 'preparer') return 'A review note is cleared by a reviewer or partner after the preparer responds.';
      return String(p.text ?? '').trim() ? null : 'Say how the note was addressed.';
    }
    case 'case.link': return String(p.why ?? '').trim() ? null : 'Say why this evidence is relevant.';
    case 'case.unlink': return null;
    case 'case.question': return String(p.text ?? '').trim().length < 10 ? 'Write the question.' : resolved ? 'Reopen the case before asking new questions.' : null;
    case 'case.answer': {
      const q = cs.questions.find((x) => x.id === p.qid);
      if (!q) return 'Unknown question.';
      if (q.answer) return 'Already answered (the original answer is kept; ask a follow-up).';
      if (q.to === 'client') return 'Client answers are recorded by the client (switch to the client role).';
      return String(p.text ?? '').trim() ? null : 'An answer is required.';
    }
    case 'case.recon': return resolved ? 'Reopen the case to change a reconciliation conclusion.' : String(p.note ?? '').trim().length < 5 && p.status !== 'unchecked' ? 'Record how the conclusion was reached.' : null;
    case 'case.adjust': {
      if (resolved) return 'Reopen the case before proposing an adjustment.';
      if (!line0(ix, p.lineKey)) return `Line ${p.lineKey} is not on the ${ix.current.version} return.`;
      if (!String(p.reason ?? '').trim()) return 'Give the reason for the adjustment.';
      if (!isFinite(p.to)) return 'Enter the adjusted value.';
      return null;
    }
    case 'case.adjust.decide': {
      const a = cs.adjustments.find((x) => x.id === p.adjId);
      if (!a) return 'Unknown adjustment.';
      if (a.decision) return 'Already decided.';
      if (a.by === actor.id) return 'A person may not approve their own adjustment (firm rule).';
      const big = Math.max(Math.abs(a.federal), Math.abs(a.california)) > PARTNER_THRESHOLD;
      if (big && actor.role !== 'partner') return `Tax effect over ${PARTNER_THRESHOLD.toLocaleString()} requires partner approval (firm rule).`;
      if (!big && actor.role === 'preparer') return 'Adjustments are approved by a reviewer or partner.';
      return null;
    }
    case 'case.propose': {
      if (resolved || cs.status === 'ready_for_approval') return 'A decision is already recorded; return or reopen first.';
      return closeBlockers(ix, def, st, p.outcome, p.rationale).join(' ') || null;
    }
    case 'case.resolve': {
      if (cs.status !== 'ready_for_approval' || !cs.proposal) return 'Nothing is awaiting approval.';
      if (!['reviewer', 'partner'].includes(actor.role)) return 'Approval requires a reviewer or partner.';
      if (cs.proposal.by === actor.id) return 'A person may not review or sign off on work they prepared (firm rule).';
      if (facts.needsPartner && actor.role !== 'partner' && def.allowedOutcomes.includes('corrected') && cs.proposal.outcome === 'corrected') return `An adjustment over ${PARTNER_THRESHOLD.toLocaleString()} needs partner sign-off.`;
      const blockers = closeBlockers(ix, def, st, cs.proposal.outcome, cs.proposal.rationale);
      if (blockers.length) return blockers.join(' ');
      if (cs.proposal.fingerprint !== facts.currentFingerprint) return 'The evidence changed after the decision was recorded; return it to the preparer.';
      return null;
    }
    case 'case.return': return cs.status !== 'ready_for_approval' ? 'Nothing to return.' : !['reviewer', 'partner'].includes(actor.role) ? 'Only a reviewer or partner returns a decision.' : String(p.reason ?? '').trim() ? null : 'Say why it is returned.';
    case 'case.reopen': return cs.status !== 'resolved' ? 'Only resolved cases can be reopened.' : String(p.reason ?? '').trim() ? null : 'Say why the case is reopened.';
    case 'copilot.run':
      if (!p.runId || !p.outcome) return 'Missing run details.';
      return cs.copilot.some((r) => r.runId === p.runId) ? 'This run is already recorded.' : null;
    case 'copilot.review': {
      const r = cs.copilot.find((x) => x.runId === p.runId);
      if (!r) return 'Unknown copilot run.';
      if (r.review) return 'This suggestion was already reviewed; run the copilot again for a new one.';
      if (!['accepted', 'edited', 'rejected'].includes(p.decision)) return 'Choose accept, edit or reject.';
      if (p.decision !== 'rejected' && !r.validationPassed) return 'An unverified AI report cannot be accepted. Reject it or run the investigation again.';
      if (p.decision === 'rejected' && String(p.note ?? '').trim().length < 5) return 'Say why the suggestion is rejected.';
      if (p.decision === 'edited' && String(p.editedText ?? '').trim().length < 10) return 'Write the edited next step.';
      return null;
    }
  }
  return null;
}

function line0(ix: PacketIndex, key: string) { return ix.lines.get(ix.current.version)?.get(key); }

/** What still stands between this case and a recorded decision with this outcome. */
export function closeBlockers(ix: PacketIndex, def: CaseDef, st: WorkState, outcome: Outcome | undefined, rationale: string | undefined): string[] {
  const cs = st.cases[def.id];
  const f = caseFacts(ix, def, st);
  const out: string[] = [];
  if (!outcome || !def.allowedOutcomes.includes(outcome)) out.push(`Choose an outcome (${def.allowedOutcomes.map((o) => OUTCOME_LABEL[o]).join(', ')}).`);
  if (String(rationale ?? '').trim().length < 20) out.push('Write a rationale of at least 20 characters.');
  if (f.openQuestions.length) out.push(`${f.openQuestions.length} question(s) still unanswered.`);
  if (f.blockingNotes.length) out.push(`${f.blockingNotes.length} blocking review note(s) not cleared.`);
  if (f.pendingAdjustments.length) out.push(`${f.pendingAdjustments.length} adjustment(s) awaiting approval.`);
  if (outcome && def.documentaryFor.includes(outcome)) {
    const docLinks = cs.links.filter((l) => ['ev', 'doc', 'docpage', 'agency', 'py'].includes(refKind(l.ref)));
    const backedByAdjustment = outcome === 'corrected' && f.approvedAdjustments.length > 0;
    if (!docLinks.length && !backedByAdjustment) out.push('This outcome needs documentary evidence linked to the decision (a client statement alone is not enough).');
  }
  if (outcome === 'corrected' && def.suggested && !f.approvedAdjustments.length && !cs.links.length) out.push('A correction needs an approved adjustment or linked evidence of the corrected value.');
  if (outcome === 'out_of_scope_referred' && !cs.questions.some((q) => q.to === 'client') && !cs.notes.length) out.push('Record the client communication or referral (question or note).');
  return out;
}

// --- readiness ---------------------------------------------------------------------

export type ReadinessLevel = 'blocked' | 'in_progress' | 'ready_for_reviewer' | 'ready_for_partner' | 'ready_for_client_approval';
export const READINESS_LABEL: Record<ReadinessLevel, string> = {
  blocked: 'Blocked', in_progress: 'In progress', ready_for_reviewer: 'Ready for reviewer approval',
  ready_for_partner: 'Ready for partner sign-off', ready_for_client_approval: 'Ready to present for client approval',
};

export interface Step { id: string; label: string; done: boolean; detail: string; route?: string; blocking: boolean }

export function readiness(ix: PacketIndex, defs: CaseDef[], st: WorkState, checkFails: number): { level: ReadinessLevel; steps: Step[]; blockers: string[] } {
  const facts = new Map(defs.map((d) => [d.id, caseFacts(ix, d, st)]));
  const status = (id: string) => st.cases[id]?.status;
  const resolvedIds = (pred: (d: CaseDef) => boolean) => defs.filter(pred).every((d) => status(d.id) === 'resolved' && !facts.get(d.id)!.staleSignoff);
  const unresolved = defs.filter((d) => status(d.id) !== 'resolved');
  const stale = defs.filter((d) => facts.get(d.id)!.staleSignoff);
  const openQs = defs.reduce((a, d) => a + facts.get(d.id)!.openQuestions.length, 0);
  const blockingNotes = defs.reduce((a, d) => a + facts.get(d.id)!.blockingNotes.length, 0);
  const pendingAdj = defs.reduce((a, d) => a + facts.get(d.id)!.pendingAdjustments.length, 0);
  const unaccounted = ix.packet.documents.filter((d) => ['received', 'awaiting_review'].includes(st.docs[d.id].disposition));
  const has = (ids: string[]) => ids.every((i) => ix.docs.has(i));
  const byRule = (r: string) => (d: CaseDef) => d.ruleId === r || d.id === r;

  const steps: Step[] = [
    { id: 'engagement', label: 'Engagement letter and consents signed', done: has(['D01', 'D02']), detail: 'D01, D02 in file', route: '#/doc/D01', blocking: true },
    { id: 'identity', label: 'Identity verified', done: has(['D04', 'D05']) && resolvedIds(byRule('WP-DEPENDENT-TIN')), detail: 'IDs D04/D05; dependent TIN case', route: '#/case/WP-DEPENDENT-TIN', blocking: true },
    { id: 'py-return', label: 'Prior-year return reviewed', done: resolvedIds(byRule('WP-PRIOR-OPEN-ITEMS')), detail: 'Prior preparer open items', route: '#/case/WP-PRIOR-OPEN-ITEMS', blocking: true },
    { id: 'docs', label: 'All documents accounted for', done: unaccounted.length === 0, detail: `${unaccounted.length} of ${ix.packet.documents.length} documents without a reviewed disposition`, route: '#/docs', blocking: true },
    { id: 'variance', label: 'Prior-year variances explained', done: resolvedIds(byRule('WP-PY-VARIANCE')), detail: 'Variance case', route: '#/case/WP-PY-VARIANCE', blocking: true },
    { id: 'carry', label: 'Carryovers agreed to prior year', done: true, detail: 'Independent check (passive, capital loss) passes', route: '#/checks', blocking: false },
    { id: 'payments', label: 'Estimated payments agreed to IRS and FTB records', done: resolvedIds((d) => d.ruleId === 'WP-PAYMENTS-AGENCY'), detail: 'Federal and California payment cases', route: '#/queue?area=Payments', blocking: true },
    { id: 'dd', label: 'Due diligence completed', done: resolvedIds(byRule('DUE_DILIGENCE_REQUIRED')), detail: 'Form 8867 case', route: '#/case/ENG-DUE_DILIGENCE_REQUIRED', blocking: true },
    { id: 'diag', label: 'Diagnostics resolved', done: resolvedIds((d) => d.origin === 'engine'), detail: `${defs.filter((d) => d.origin === 'engine' && status(d.id) !== 'resolved').length} engine diagnostic case(s) open`, route: '#/queue?origin=engine', blocking: true },
    { id: 'checks', label: 'Workpaper checks resolved', done: resolvedIds((d) => d.origin === 'workpaper'), detail: `${defs.filter((d) => d.origin === 'workpaper' && status(d.id) !== 'resolved').length} workpaper case(s) open; ${checkFails} independent check(s) failing`, route: '#/queue?origin=workpaper', blocking: true },
    { id: 'reviewer', label: 'Reviewer sign-off', done: st.engagementSignoffs.some((s) => s.level === 'reviewer'), detail: 'Engagement-level reviewer sign-off', route: '#/readiness', blocking: true },
    { id: 'partner', label: 'Partner sign-off', done: st.engagementSignoffs.some((s) => s.level === 'partner'), detail: 'Engagement-level partner sign-off', route: '#/readiness', blocking: true },
    { id: 'client', label: 'Client approval and e-file authorization', done: false, detail: 'Not performed in this app. The packet timeline replays a 2026-07-10 approval as scripted history only.', blocking: true },
  ];

  const blockers: string[] = [];
  if (blockingNotes) blockers.push(`${blockingNotes} blocking review note(s)`);
  if (stale.length) blockers.push(`${stale.length} sign-off(s) stale after evidence changed`);
  if (defs.some((d) => d.severity === 'blocker' && status(d.id) !== 'resolved')) blockers.push('Blocker-severity case open (e-file would reject)');
  if (openQs) blockers.push(`${openQs} unanswered question(s)`);
  if (pendingAdj) blockers.push(`${pendingAdj} adjustment(s) awaiting approval`);

  let level: ReadinessLevel = 'in_progress';
  const allDecided = unresolved.every((d) => status(d.id) === 'ready_for_approval');
  if (blockingNotes || stale.length || defs.some((d) => d.severity === 'blocker' && status(d.id) !== 'resolved' && status(d.id) !== 'ready_for_approval')) level = 'blocked';
  else if (unresolved.length === 0 && !openQs && !pendingAdj) {
    const pre = steps.filter((s) => !['reviewer', 'partner', 'client'].includes(s.id)).every((s) => s.done);
    if (pre && !st.engagementSignoffs.some((s) => s.level === 'reviewer')) level = 'ready_for_reviewer';
    else if (pre && !st.engagementSignoffs.some((s) => s.level === 'partner')) level = 'ready_for_partner';
    else if (pre) level = 'ready_for_client_approval';
  } else if (allDecided && unresolved.length && !openQs && !pendingAdj) level = 'ready_for_reviewer';
  return { level, steps, blockers };
}
