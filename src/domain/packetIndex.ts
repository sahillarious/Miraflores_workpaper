import type { CallNote, ExtractedValue, Message, Packet, PacketDocument, QA, ReturnLine, ReturnVersion, Staff } from './types';

// A read-only index over the packet. Nothing here mutates the packet: every
// map points at the original record so the UI always shows source data as
// delivered, and reverse indexes ("where did this land?") are derived.

export interface PacketIndex {
  packet: Packet;
  docs: Map<string, PacketDocument>;
  evs: Map<string, ExtractedValue>;
  evsByDoc: Map<string, ExtractedValue[]>;
  versions: ReturnVersion[];
  versionById: Map<string, ReturnVersion>;
  current: ReturnVersion;
  lines: Map<string, Map<string, ReturnLine>>; // version -> key -> line
  dependents: Map<string, Map<string, string[]>>; // version -> key -> keys that use it as input
  refToLines: Map<string, Map<string, string[]>>; // version -> source ref -> line keys citing it
  qa: Map<string, QA>;
  msgs: Map<string, Message>;
  calls: Map<string, CallNote>;
  staff: Map<string, Staff>;
  docUse: Map<string, Map<string, string[]>>; // version -> doc id -> line keys sourced from it
}

export function buildIndex(packet: Packet): PacketIndex {
  const docs = new Map(packet.documents.map((d) => [d.id, d]));
  const evs = new Map(packet.extracted_values.map((e) => [e.id, e]));
  const evsByDoc = new Map<string, ExtractedValue[]>();
  for (const e of packet.extracted_values) {
    const list = evsByDoc.get(e.document_id) ?? [];
    list.push(e);
    evsByDoc.set(e.document_id, list);
  }
  const versions = packet.return_versions;
  const versionById = new Map(versions.map((v) => [v.version, v]));
  const lines = new Map<string, Map<string, ReturnLine>>();
  const dependents = new Map<string, Map<string, string[]>>();
  const refToLines = new Map<string, Map<string, string[]>>();
  const docUse = new Map<string, Map<string, string[]>>();

  for (const v of versions) {
    const lm = new Map(v.lines.map((l) => [l.key, l]));
    lines.set(v.version, lm);
    const dep = new Map<string, string[]>();
    const r2l = new Map<string, string[]>();
    const du = new Map<string, string[]>();
    for (const l of v.lines) {
      for (const i of l.inputs) push(dep, i, l.key);
      for (const s of l.sources) {
        push(r2l, s, l.key);
        const ev = evs.get(s);
        const docId = ev ? ev.document_id : /^D\d\d$/.test(s) ? s : undefined;
        if (docId) pushUnique(du, docId, l.key);
      }
    }
    dependents.set(v.version, dep);
    refToLines.set(v.version, r2l);
    docUse.set(v.version, du);
  }

  return {
    packet,
    docs,
    evs,
    evsByDoc,
    versions,
    versionById,
    current: versions[versions.length - 1],
    lines,
    dependents,
    refToLines,
    qa: new Map(packet.client.questionnaire.map((q) => [q.id, q])),
    msgs: new Map(packet.client.messages.map((m) => [m.id, m])),
    calls: new Map(packet.client.call_notes.map((c) => [c.id, c])),
    staff: new Map((packet.firm.staff as Staff[]).map((s) => [s.id, s])),
    docUse,
  };
}

function push(m: Map<string, string[]>, k: string, v: string) {
  const list = m.get(k) ?? [];
  list.push(v);
  m.set(k, list);
}
function pushUnique(m: Map<string, string[]>, k: string, v: string) {
  const list = m.get(k) ?? [];
  if (!list.includes(v)) list.push(v);
  m.set(k, list);
}

export function line(ix: PacketIndex, key: string, version = ix.current.version): ReturnLine | undefined {
  return ix.lines.get(version)?.get(key);
}

export function lineValue(ix: PacketIndex, key: string, version = ix.current.version): number | string | null | undefined {
  return line(ix, key, version)?.value;
}

export function num(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) return Number(v);
  return NaN;
}

export function evNum(ix: PacketIndex, id: string): number {
  return num(ix.evs.get(id)?.value);
}

/** Resolve an RFC 6901 JSON pointer against an object. */
export function resolvePointer(root: any, pointer: string): any {
  if (pointer === '' || pointer === '/') return root;
  const parts = pointer.replace(/^\//, '').split('/').map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  let cur = root;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = Array.isArray(cur) ? cur[Number(p)] : cur[p];
  }
  return cur;
}

/** Pages of a document that contain printed amounts but no extracted values. */
export function unreadPages(ix: PacketIndex, docId: string): number[] {
  const doc = ix.docs.get(docId);
  if (!doc) return [];
  const read = new Set((ix.evsByDoc.get(docId) ?? []).map((e) => e.page));
  return doc.pages
    .filter((p) => !read.has(p.page) && /\d{1,3}(,\d{3})*\.\d\d/.test(p.printed_content))
    .map((p) => p.page);
}
