import { describe, expect, it } from 'vitest';
import { ix, packet } from './load';
import { buildCases } from '../src/domain/cases';
import { MemoryRepository, Workpaper } from '../src/domain/store';
import { buildActors, type Actor } from '../src/domain/workflow';
import { makeMask, maskDefs } from '../src/ui/mask';
import { GLOSSARY } from '../src/ui/glossary';

const defs = buildCases(ix);
const mask = makeMask(ix);
const actors = buildActors(ix);
const A = (id: string) => actors.find((a) => a.id === id) as Actor;

// Every identifier in the packet that the display must not show in full.
const hh = packet.household as any;
const SSNS: string[] = [...hh.people.map((p: any) => p.ssn), ...(packet.prior_years as any).return_2024.dependents.map((d: any) => d.ssn)].filter(Boolean);
const SECRETS: string[] = [...SSNS, ...hh.people.map((p: any) => p.ip_pin).filter(Boolean), String(hh.bank_account_for_refund_or_payment.account), String(hh.bank_account_for_refund_or_payment.routing)];
const IBAN = /\b[A-Z]{2}\d{2}(?: ?\d{4}){3,7}\b/;
const SSN = /\b\d{3}-\d{2}-\d{4}\b/;

describe('display masking (one shared function)', () => {
  it('masks every document page: no full SSN, IBAN, IP PIN or refund account, last four kept', () => {
    let pagesWithIds = 0;
    for (const d of packet.documents) for (const p of d.pages) {
      const m = mask(p.printed_content);
      if (m !== p.printed_content) pagesWithIds++;
      expect(m, `${d.id} p${p.page}`).not.toMatch(SSN);
      expect(m, `${d.id} p${p.page}`).not.toMatch(IBAN);
      for (const s of SECRETS) expect(m.includes(s), `${d.id} p${p.page} shows ${s.slice(-4)}`).toBe(false);
    }
    expect(pagesWithIds).toBeGreaterThan(0);
    const d06 = packet.documents.find((d) => d.id === 'D06')!.pages[0].printed_content;
    expect(mask(d06)).toContain('***-**-3390');
  });

  it('masks every extracted value of a sensitive type', () => {
    for (const e of packet.extracted_values) {
      if (typeof e.value !== 'string') continue;
      expect(mask(e.value), e.id).not.toMatch(SSN);
      expect(mask(e.text_as_read ?? ''), e.id).not.toMatch(SSN);
      for (const s of SECRETS) expect(mask(e.value).includes(s), e.id).toBe(false);
    }
  });

  it('masks the case text shown in the UI, keeping the last four so 3309 vs 3390 stays visible', () => {
    const shown = JSON.stringify(maskDefs(defs, mask));
    for (const s of SECRETS) expect(shown.includes(s), `case text shows ${s.slice(-4)}`).toBe(false);
    expect(shown).not.toMatch(SSN);
    const tin = maskDefs(defs, mask).find((d) => d.id === 'WP-DEPENDENT-TIN')!;
    expect([tin.reconciliations[0].a.value, tin.reconciliations[0].b.value]).toEqual(['***-**-3309', '***-**-3390']);
    // Only text changes: ids, refs, amounts and suggestions are identical.
    const raw = defs.find((d) => d.id === 'WP-RSU-BASIS')!, m = maskDefs(defs, mask).find((d) => d.id === 'WP-RSU-BASIS')!;
    expect(m.refs).toEqual(raw.refs);
    expect(m.suggestions).toEqual(raw.suggestions);
    expect(m.reconciliations.map((r) => r.b.value)).toEqual(raw.reconciliations.map((r) => r.b.value));
  });

  it('has no identifiers in the glossary', () => {
    for (const g of GLOSSARY) {
      expect(mask(g.definition), g.id).toBe(g.definition);
      expect(g.definition, g.id).not.toMatch(SSN);
    }
  });
});

describe('unmasking uses the existing sensitive.view command', () => {
  const fresh = () => new Workpaper(ix, defs, new MemoryRepository());
  const view = { type: 'sensitive.view' as const, payload: { what: 'doc:D06#page1' } };

  it('is refused for staff without clearance and for the client', () => {
    const wp = fresh();
    expect((wp.dispatch(A('st-04'), view) as any).error).toMatch(/no sensitive-data clearance/);
    expect((wp.dispatch(A('cu-01'), view) as any).error).toMatch(/no sensitive-data clearance/);
    expect(wp.state.views).toHaveLength(0);
  });

  it('is allowed for cleared staff and logged', () => {
    const wp = fresh();
    expect(wp.dispatch(A('st-01'), view).ok).toBe(true);
    expect(wp.state.views.map((v) => [v.actor, v.payload.what])).toEqual([['st-01', 'doc:D06#page1']]);
    expect(wp.log.at(-1)!.type).toBe('sensitive.view');
  });

  it('keeps packet identifiers out of the exported log after normal work', () => {
    const wp = fresh();
    wp.dispatch(A('st-01'), view);
    wp.dispatch(A('st-01'), { type: 'case.question', payload: { caseId: 'WP-DEPENDENT-TIN', qid: 'q1', to: 'client', toWho: 'cu-01', text: mask(defs.find((d) => d.id === 'WP-DEPENDENT-TIN')!.why).slice(0, 120), expected: '' } });
    const exported = wp.exportLog();
    for (const s of SECRETS) expect(exported.includes(s)).toBe(false);
  });
});
