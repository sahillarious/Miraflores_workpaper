import type { CaseDef } from '../domain/cases';
import type { PacketIndex } from '../domain/packetIndex';
import { landing } from '../views/Documents';

/** One return that belongs to someone related to this household, with what this packet can say about it. */
export interface RelatedReturn {
  key: string;
  who: string;
  description: string;
  preparedBy: string;
  /** What the packet holds of that return, in the packet's own words ("false" becomes "nothing"). */
  inPacket: string;
  docIds: string[];
  personId: string | null;
  lines: string[];
  cases: CaseDef[];
}

/** Built only from household.related_returns plus existing reverse indexes; nothing is stored. */
export function relatedReturns(ix: PacketIndex, defs: CaseDef[]): RelatedReturn[] {
  const hh = ix.packet.household;
  const cites = (d: CaseDef, ids: string[]) => ids.some((id) => d.refs.includes(id) || d.facts.some((f) => f.refs.includes(id)) || d.conflicts.some((f) => f.refs.includes(id)));
  return (hh.related_returns as any[]).map((r, i) => {
    const person = hh.people.find((p: any) => String(r.who).includes(p.name));
    const inPacket = typeof r.in_this_packet === 'string' ? r.in_this_packet : 'nothing';
    const docIds = [...new Set(typeof r.in_this_packet === 'string' ? [...r.in_this_packet.matchAll(/\bD\d\d\b/g)].map((m) => m[0]) : [])].filter((id) => ix.docs.has(id));
    const lines = [...new Set(docIds.flatMap((id) => { const L = landing(ix, id); return [...L.landed.flatMap((u) => u.lines), ...L.direct]; }))];
    const ids = [...docIds, ...(person ? [`household:${person.id}`] : [])];
    return { key: `rr${i}`, who: r.who, description: r.return, preparedBy: r.prepared_by, inPacket, docIds, personId: person?.id ?? null, lines, cases: defs.filter((d) => cites(d, ids)) };
  });
}

/** The related return a document is part of, if any (used on the document page). */
export function relatedReturnOf(ix: PacketIndex, defs: CaseDef[], docId: string): RelatedReturn | undefined {
  return relatedReturns(ix, defs).find((r) => r.docIds.includes(docId));
}
