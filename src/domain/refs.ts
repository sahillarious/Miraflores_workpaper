import { resolvePointer, type PacketIndex } from './packetIndex';

// Every reference format in the packet README resolves to one of these. A
// resolved ref says what it is, a short label, a value or excerpt, and the
// route that opens it, so any number can be traced from any screen.

export type RefKind =
  | 'ev' | 'doc' | 'docpage' | 'qa' | 'msg' | 'call' | 'py' | 'agency'
  | 'asset' | 'param' | 'fx' | 'timeline' | 'line' | 'version' | 'household' | 'case' | 'unknown';

export interface ResolvedRef {
  ref: string;
  kind: RefKind;
  label: string;
  detail?: string;
  value?: string;
  route?: string;
  /** Third-party or firm document evidence, as opposed to a client statement or engine output. */
  documentary: boolean;
  confidence?: number;
}

const kindLabel: Record<RefKind, string> = {
  ev: 'Extracted value', doc: 'Document', docpage: 'Document page', qa: 'Questionnaire',
  msg: 'Client message', call: 'Call note', py: 'Prior-year record', agency: 'Agency record',
  asset: 'Asset', param: 'Engine parameter', fx: 'FX rate', timeline: 'Timeline event',
  line: 'Return line', version: 'Return version', household: 'Household', case: 'Review case', unknown: 'Reference',
};
export const refKindLabel = (k: RefKind) => kindLabel[k];

export function refKind(ref: string): RefKind {
  if (/^ev-\d+$/.test(ref)) return 'ev';
  if (/^D\d\d$/.test(ref)) return 'doc';
  if (/^doc:D\d\d#page\d+$/.test(ref)) return 'docpage';
  if (/^qa-\d+$/.test(ref)) return 'qa';
  if (/^msg-\d+$/.test(ref)) return 'msg';
  if (/^call-\d+$/.test(ref)) return 'call';
  if (ref.startsWith('py:/')) return 'py';
  if (ref.startsWith('agency:/')) return 'agency';
  if (ref.startsWith('asset:')) return 'asset';
  if (ref.startsWith('ref:param.')) return 'param';
  if (ref.startsWith('ref:fx.')) return 'fx';
  if (ref.startsWith('timeline:') || /^tl-\d+$/.test(ref) || ref.startsWith('extension-')) return 'timeline';
  if (/^v\d$/.test(ref)) return 'version';
  if (ref.startsWith('household:')) return 'household';
  if (ref.startsWith('case:')) return 'case';
  if (/^[A-Za-z0-9-]+\.[A-Za-z0-9.]+$/.test(ref)) return 'line';
  return 'unknown';
}

function short(v: unknown, n = 160): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (s === undefined) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export function fmtValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

export function resolveRef(ix: PacketIndex, ref: string, version = ix.current.version): ResolvedRef {
  const kind = refKind(ref);
  const base = { ref, kind, documentary: false } as ResolvedRef;
  switch (kind) {
    case 'ev': {
      const e = ix.evs.get(ref);
      if (!e) return { ...base, label: `${ref} (not found)` };
      const d = ix.docs.get(e.document_id);
      return {
        ...base,
        label: `${e.document_id} p${e.page} · ${e.label}`,
        detail: d?.title,
        value: e.value === null ? 'missing (nothing printed)' : fmtValue(e.value),
        route: `#/doc/${e.document_id}?ev=${e.id}`,
        documentary: true,
        confidence: e.confidence,
      };
    }
    case 'doc': {
      const d = ix.docs.get(ref);
      return { ...base, label: `${ref} · ${d?.title ?? 'unknown document'}`, route: `#/doc/${ref}`, documentary: true };
    }
    case 'docpage': {
      const m = /^doc:(D\d\d)#page(\d+)$/.exec(ref)!;
      const d = ix.docs.get(m[1]);
      const p = d?.pages.find((x) => x.page === Number(m[2]));
      return { ...base, label: `${m[1]} page ${m[2]} (not extracted)`, detail: d?.title, value: short(p?.printed_content), route: `#/doc/${m[1]}?page=${m[2]}`, documentary: true };
    }
    case 'qa': {
      const q = ix.qa.get(ref);
      return { ...base, label: `${ref} · ${q?.question ?? ''}`, value: q?.answer, detail: q ? `Answered by ${q.answered_by}` : undefined, route: `#/client?focus=${ref}` };
    }
    case 'msg': {
      const m = ix.msgs.get(ref);
      return { ...base, label: `${ref} · ${m?.from ?? ''} ${m ? m.sent_at.slice(0, 10) : ''}`, value: m?.text, route: `#/client?focus=${ref}` };
    }
    case 'call': {
      const c = ix.calls.get(ref);
      return { ...base, label: `${ref} · call ${c?.date.slice(0, 10) ?? ''}`, value: c?.notes.join(' / '), route: `#/client?focus=${ref}` };
    }
    case 'py': {
      const ptr = ref.slice(3);
      const v = resolvePointer(ix.packet.prior_years, ptr);
      return { ...base, label: `Prior year ${ptr}`, value: short(v), route: `#/prior?ptr=${encodeURIComponent(ptr)}`, documentary: true };
    }
    case 'agency': {
      const ptr = ref.slice(7);
      const v = resolvePointer(ix.packet.tax_agency_records, ptr);
      return { ...base, label: `Agency ${ptr}`, value: short(v), route: `#/prior?agency=${encodeURIComponent(ptr)}`, documentary: true };
    }
    case 'asset': {
      const id = ref.slice(6);
      const a = ix.versionById.get(version)?.assets.find((x: any) => x.asset_id === id) ??
        ix.packet.prior_years.asset_records.find((x: any) => x.asset_id === id);
      return { ...base, label: `Asset ${id}`, value: a?.description, route: `#/assets?focus=${id}` };
    }
    case 'param': {
      const name = ref.slice('ref:param.'.length);
      return { ...base, label: `Engine parameter ${name}`, value: short(ix.packet.engine_reference.parameters[name]) };
    }
    case 'fx': {
      const name = ref.slice('ref:fx.'.length);
      const [cur, rate] = name.split('.');
      return { ...base, label: `FX ${cur} ${rate}`, value: `${fmtValue(ix.packet.engine_reference.parameters.fx?.[cur]?.[rate])} ${cur}/USD` };
    }
    case 'timeline': {
      const id = ref.replace(/^timeline:/, '');
      const t = ix.packet.timeline.find((x) => x.id === id);
      return { ...base, label: `Timeline ${id} · ${t?.event ?? ''}`, value: t?.detail ?? t?.at, route: `#/activity?focus=${id}` };
    }
    case 'version': {
      const v = ix.versionById.get(ref);
      return { ...base, label: `Return ${ref}`, value: v?.trigger, route: `#/versions?v=${ref}` };
    }
    case 'line': {
      const l = ix.lines.get(version)?.get(ref);
      return { ...base, label: `${ref} · ${l?.label ?? 'line not in this version'}`, value: fmtValue(l?.value), route: `#/line/${encodeURIComponent(ref)}` };
    }
    case 'household': {
      const id = ref.slice(10);
      const p = ix.packet.household.people.find((x: any) => x.id === id);
      return { ...base, label: `Household · ${p?.name ?? id}`, route: '#/client' };
    }
    case 'case':
      return { ...base, label: ref.slice(5), route: `#/case/${encodeURIComponent(ref.slice(5))}` };
    default:
      return { ...base, label: ref };
  }
}
