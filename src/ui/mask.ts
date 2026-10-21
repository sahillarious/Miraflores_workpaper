import type { CaseDef } from '../domain/cases';
import type { PacketIndex } from '../domain/packetIndex';
import { makeRedactor } from '../copilot/redact';

// Display masking. The app uses one masking function everywhere: the same
// redactor that masks tool output before it reaches the AI model. SSNs,
// IBANs and the refund account/routing numbers keep their last four
// characters (enough to see a transposition such as 3309 vs 3390); an IP PIN
// after the words "IP PIN" is fully masked.
//
// This is display masking only. The packet JSON served to the browser and the
// event log in localStorage still hold the identifiers.

export type Mask = (text: string) => string;

export const makeMask = (ix: PacketIndex): Mask => makeRedactor(ix);

/** Mask a value for display: strings are masked, other values are shown as they are. */
export const maskValue = (mask: Mask, v: unknown) => (typeof v === 'string' ? mask(v) : v);

/**
 * Copies of the case definitions with every display text masked. Only text
 * changes; ids, refs, amounts, outcomes and suggestions are untouched, so the
 * same authorize() and close rules apply to them.
 */
export function maskDefs(defs: CaseDef[], mask: Mask): CaseDef[] {
  const side = <T extends { value: number | string | null; note?: string }>(s: T): T => ({ ...s, value: typeof s.value === 'string' ? mask(s.value) : s.value, note: s.note === undefined ? undefined : mask(s.note) });
  return defs.map((d) => ({
    ...d,
    title: mask(d.title),
    why: mask(d.why),
    matters: mask(d.matters),
    nextAction: mask(d.nextAction),
    diagnosticMessage: d.diagnosticMessage === undefined ? undefined : mask(d.diagnosticMessage),
    requirements: d.requirements.map(mask),
    openQuestions: d.openQuestions.map(mask),
    facts: d.facts.map((f) => ({ ...f, text: mask(f.text) })),
    conflicts: d.conflicts.map((f) => ({ ...f, text: mask(f.text) })),
    reconciliations: d.reconciliations.map((r) => ({ ...r, a: side(r.a), b: side(r.b), finding: r.finding === undefined ? undefined : mask(r.finding) })),
  }));
}
