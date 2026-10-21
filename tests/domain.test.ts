import { describe, expect, it, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ix, packet, packetPath } from './load';
import { buildCases, type CaseDef } from '../src/domain/cases';
import { independentChecks, duplicateDocuments, readVsPrinted } from '../src/domain/checks';
import { resolveRef } from '../src/domain/refs';
import { LocalStorageRepository, MemoryRepository, Workpaper } from '../src/domain/store';
import { buildActors, caseFacts, readiness, type Actor } from '../src/domain/workflow';

const defs = buildCases(ix);
const byId = new Map(defs.map((d) => [d.id, d]));
const actors = buildActors(ix);
const A = (id: string) => actors.find((a) => a.id === id) as Actor;
const priya = A('st-01'), daniel = A('st-02'), helen = A('st-03'), marcus = A('st-04'), ngozi = A('cu-01');

function fresh() { return new Workpaper(ix, defs, new MemoryRepository()); }
function ok(r: { ok: boolean; error?: string }) { if (!r.ok) throw new Error((r as any).error); }

describe('data integrity', () => {
  it('serves the packet exactly as delivered', () => {
    const original = readFileSync(resolve(__dirname, '../okafor_lindqvist_2025_packet.json'));
    const served = readFileSync(packetPath);
    expect(createHash('sha256').update(served).digest('hex')).toBe(createHash('sha256').update(original).digest('hex'));
  });

  it('loads three distinct return versions with the supplied snapshot values', () => {
    expect(ix.versions.map((v) => v.version)).toEqual(['v1', 'v2', 'v3']);
    const s = Object.fromEntries(ix.versions.map((v) => [v.version, v.summary]));
    expect(s.v1.federal).toMatchObject({ agi: 428023, taxable_income: 329346, total_tax: 77200, payments: 41742, balance_due: 35458, penalty: 164 });
    expect(s.v2.federal).toMatchObject({ agi: 429820, taxable_income: 331143, total_tax: 77470, payments: 41742, balance_due: 35728 });
    expect(s.v3.federal).toMatchObject({ agi: 445590, taxable_income: 346913, total_tax: 81962, payments: 77742, balance_due: 4220 });
    expect(s.v1.california).toMatchObject({ total_agi: 463529, ca_agi: 294267, total_tax: 17845, payments: 27130, balance_due: -9285 });
    expect(s.v3.california).toMatchObject({ total_agi: 481096, ca_agi: 305349, total_tax: 18874, payments: 27130, balance_due: -8256 });
    expect(ix.current.version).toBe('v3');
  });

  it('keeps v1/v2/v3 lines distinct (no snapshot overwritten)', () => {
    expect(ix.lines.get('v1')!.get('F1040.11')!.value).toBe(428023);
    expect(ix.lines.get('v2')!.get('F1040.11')!.value).toBe(429820);
    expect(ix.lines.get('v3')!.get('F1040.11')!.value).toBe(445590);
  });

  it('has 74 documents and 3,012 extracted values with unique ids', () => {
    expect(packet.documents).toHaveLength(74);
    expect(packet.extracted_values).toHaveLength(3012);
    expect(new Set(packet.extracted_values.map((e) => e.id)).size).toBe(3012);
    expect(new Set(packet.documents.map((d) => d.id)).size).toBe(74);
  });

  it('resolves every reference cited by return lines, diagnostics and cases', () => {
    const unresolved: string[] = [];
    const check = (r: string) => { const x = resolveRef(ix, r); if (x.kind === 'unknown' || /not found|unknown document|line not in this version/.test(x.label)) unresolved.push(r); };
    for (const v of ix.versions) {
      for (const l of v.lines) { l.sources.forEach(check); l.inputs.forEach((i) => { if (!ix.lines.get(v.version)!.has(i)) unresolved.push(`${v.version}:${i}`); }); }
      for (const g of v.diagnostics) g.refs.forEach(check);
    }
    for (const d of defs) d.refs.forEach(check);
    expect(unresolved).toEqual([]);
  });

  it('keeps missing values missing', () => {
    expect(ix.evs.get('ev-0919')!.value).toBeNull();
    expect(resolveRef(ix, 'ev-0919').value).toMatch(/missing/);
  });

  it('finds exactly the two values that disagree with their printed page', () => {
    expect(readVsPrinted(ix).map((m) => m.ev.id).sort()).toEqual(['ev-1045', 'ev-1049']);
  });
});

describe('Meridian summary vs detail', () => {
  const c = byId.get('ENG-BROKER_SUMMARY_DETAIL_MISMATCH')!;
  it('shows both amounts and the 250 difference, explained by the unread page 32', () => {
    const r = c.reconciliations[0];
    expect(r.a.value).toBe(71965);
    expect(r.b.value).toBe(71715);
    expect((r.a.value as number) - (r.b.value as number)).toBe(250);
    expect(r.a.refs).toEqual(['ev-0703']);
    expect(r.finding).toMatch(/page 32/);
    expect(c.refs).toContain('doc:D31#page32');
  });
  it('stays unresolved until a documented conclusion is approved', () => {
    const wp = fresh();
    expect(wp.state.cases[c.id].status).toBe('open');
    const r = wp.dispatch(priya, { type: 'case.propose', payload: { caseId: c.id, outcome: 'explained_difference', rationale: 'short' } });
    expect(r.ok).toBe(false);
    expect(wp.state.cases[c.id].status).toBe('open');
  });
});

describe('questionnaire contradiction', () => {
  const c = byId.get('ENG-QUESTIONNAIRE_SALES_CONFLICT')!;
  it('links qa-14 and qa-15 to brokerage and digital-asset evidence', () => {
    expect(c.refs).toEqual(expect.arrayContaining(['qa-14', 'qa-15', 'D28', 'D31', 'D74', 'D34']));
    expect(c.title).toMatch(/282 brokerage sales and 12 digital-asset/);
  });
  it('keeps the original answer when a follow-up is answered', () => {
    const wp = fresh();
    ok(wp.dispatch(priya, { type: 'case.question', payload: { caseId: c.id, qid: 'q1', to: 'client', toWho: 'cu-01', text: 'Do you recognise the Brightpath direct-indexing sales?', expected: 'Yes/No with explanation' } }));
    expect(wp.state.cases[c.id].status).toBe('awaiting_client');
    ok(wp.dispatch(ngozi, { type: 'case.answer', payload: { caseId: c.id, qid: 'q1', text: 'Yes, the advisor sells automatically. I did not think of it as selling.' } }));
    expect(wp.state.cases[c.id].status).toBe('in_review');
    expect(ix.qa.get('qa-14')!.answer).toBe('No');
    const again = wp.dispatch(ngozi, { type: 'case.answer', payload: { caseId: c.id, qid: 'q1', text: 'changed my mind' } });
    expect(again.ok).toBe(false);
    expect(wp.state.cases[c.id].questions[0].answer!.text).toMatch(/advisor sells/);
  });
});

describe('duplicate W-2', () => {
  it('detects D10 as a second image of D09 and keeps both', () => {
    expect(duplicateDocuments(ix)).toContainEqual(expect.objectContaining({ a: 'D09', b: 'D10' }));
    expect(ix.docs.has('D09') && ix.docs.has('D10')).toBe(true);
  });
  it('records the relationship as dispositions', () => {
    const wp = fresh();
    ok(wp.dispatch(priya, [
      { type: 'doc.disposition', payload: { docId: 'D09', disposition: 'primary', note: 'Issuer PDF' } },
      { type: 'doc.disposition', payload: { docId: 'D10', disposition: 'duplicate', note: 'Phone photo of D09 (msg-02)', relatedDoc: 'D09' } },
    ]));
    expect(wp.state.docs.D10.disposition).toBe('duplicate');
  });
  it('does not double count in the independent wage aggregation', () => {
    const w = independentChecks(ix, new Set()).find((r) => r.id === 'w2-box1')!;
    expect(w.a.value).toBe(212400);
    expect(w.pass).toBe(true);
  });
});

describe('crypto basis', () => {
  const c = byId.get('ENG-DIGITAL_ASSET_BASIS_MISSING')!;
  it('keeps the missing basis visible and shows 3,050 only as a lead', () => {
    expect(c.reconciliations[0].a.value).toBe(0);
    expect(c.reconciliations[0].b.value).toBe(3050);
    expect(c.reconciliations[0].b.note).toMatch(/not in file/);
    expect(ix.lines.get('v3')!.get('F8949.H.C6')!.value).toBe(5325);
    expect(c.suggested).toBeUndefined();
  });
  it('cannot be closed as substantiated on the client message alone', () => {
    const wp = fresh();
    ok(wp.dispatch(priya, { type: 'case.link', payload: { caseId: c.id, ref: 'msg-07', why: 'Client account of purchase' } }));
    const r = wp.dispatch(priya, { type: 'case.propose', payload: { caseId: c.id, outcome: 'substantiated', rationale: 'Client says it cost about 3,050 in 2021.' } });
    expect(r.ok).toBe(false);
    expect((r as any).error).toMatch(/documentary evidence/);
  });
});

describe('workflow', () => {
  let store: Record<string, string>;
  const ls = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; } };
  beforeEach(() => { store = {}; });

  it('persists a review note across a refresh', () => {
    const wp = new Workpaper(ix, defs, new LocalStorageRepository('k', ls));
    ok(wp.dispatch(daniel, { type: 'case.note', payload: { caseId: 'WP-RSU-BASIS', noteId: 'n1', text: 'Agree basis to D11 before approval.', blocking: true } }));
    const reloaded = new Workpaper(ix, defs, new LocalStorageRepository('k', ls));
    expect(reloaded.state.cases['WP-RSU-BASIS'].notes[0].text).toMatch(/Agree basis/);
  });

  it('records status transitions in history and enforces the state machine', () => {
    const wp = fresh();
    ok(wp.dispatch(priya, { type: 'case.status', payload: { caseId: 'WP-HVAC', to: 'in_review' } }));
    expect(wp.state.cases['WP-HVAC'].history.map((e) => e.type)).toContain('case.status');
    expect(wp.dispatch(priya, { type: 'case.status', payload: { caseId: 'WP-HVAC', to: 'resolved' } }).ok).toBe(false);
  });

  it('enforces rationale, segregation of duties and partner threshold, then reopens', () => {
    const wp = fresh();
    const id = 'WP-MILEAGE-DUP';
    const def = byId.get(id)!;
    expect(wp.dispatch(priya, { type: 'case.propose', payload: { caseId: id, outcome: 'corrected', rationale: 'x' } }).ok).toBe(false);
    ok(wp.dispatch(priya, { type: 'case.adjust', payload: { caseId: id, adjId: 'a1', lineKey: 'SchC.9', from: 8260, to: 5670, reason: 'Exclude page 3', federal: def.effect!.federal, california: def.effect!.california } }));
    expect(wp.dispatch(priya, { type: 'case.adjust.decide', payload: { caseId: id, adjId: 'a1', decision: 'approved', note: 'ok' } }).ok).toBe(false); // own work
    expect(def.effect!.federal).toBeLessThan(1000);
    ok(wp.dispatch(daniel, { type: 'case.adjust.decide', payload: { caseId: id, adjId: 'a1', decision: 'approved', note: 'Agreed to D23 pages' } }));
    ok(wp.dispatch(priya, { type: 'case.propose', payload: { caseId: id, outcome: 'corrected', rationale: 'Page 3 is a second scan of page 2; excluded from miles.' } }));
    expect(wp.dispatch(priya, { type: 'case.resolve', payload: { caseId: id } }).ok).toBe(false); // preparer cannot approve own
    ok(wp.dispatch(daniel, { type: 'case.resolve', payload: { caseId: id } }));
    expect(wp.state.cases[id].status).toBe('resolved');
    ok(wp.dispatch(daniel, { type: 'case.reopen', payload: { caseId: id, reason: 'Client sent a fifth page' } }));
    expect(wp.state.cases[id].status).toBe('reopened');
  });

  it('requires a partner for adjustments over 1,000', () => {
    const wp = fresh();
    const def = byId.get('WP-RSU-BASIS')!;
    ok(wp.dispatch(priya, { type: 'case.adjust', payload: { caseId: def.id, adjId: 'a1', lineKey: 'F8949.B.N1', from: 19240, to: 140, reason: 'Supplemental basis', federal: def.effect!.federal, california: def.effect!.california } }));
    expect((wp.dispatch(daniel, { type: 'case.adjust.decide', payload: { caseId: def.id, adjId: 'a1', decision: 'approved', note: 'ok' } }) as any).error).toMatch(/partner/);
    ok(wp.dispatch(helen, { type: 'case.adjust.decide', payload: { caseId: def.id, adjId: 'a1', decision: 'approved', note: 'Agreed to D11' } }));
  });

  it('marks a sign-off stale when evidence changes after resolution', () => {
    const wp = fresh();
    const id = 'WP-DUP-W2';
    const def = byId.get(id) as CaseDef;
    ok(wp.dispatch(priya, [
      { type: 'doc.disposition', payload: { docId: 'D09', disposition: 'primary', note: 'Issuer PDF' } },
      { type: 'doc.disposition', payload: { docId: 'D10', disposition: 'duplicate', note: 'Phone photo of D09' } },
    ]));
    ok(wp.dispatch(priya, { type: 'case.propose', payload: { caseId: id, outcome: 'explained_difference', rationale: 'Same W-2 photographed; F1040.1a uses D09 only.' } }));
    ok(wp.dispatch(daniel, { type: 'case.resolve', payload: { caseId: id } }));
    expect(caseFacts(ix, def, wp.state).staleSignoff).toBe(false);
    ok(wp.dispatch(priya, { type: 'doc.disposition', payload: { docId: 'D10', disposition: 'supplemental', note: 'Photo shows a box the PDF lacks' } }));
    expect(caseFacts(ix, def, wp.state).staleSignoff).toBe(true);
  });

  it('undo hides an event without deleting it', () => {
    const wp = fresh();
    const r = wp.dispatch(priya, { type: 'case.assign', payload: { caseId: 'WP-HVAC', to: 'st-04' } });
    ok(r);
    expect(wp.state.cases['WP-HVAC'].owner).toBe('st-04');
    ok(wp.undo(priya, (r as any).events[0].id));
    expect(wp.state.cases['WP-HVAC'].owner).toBe('st-01');
    expect(wp.log).toHaveLength(2);
  });

  it('blocks unmasking for staff without clearance', () => {
    const wp = fresh();
    expect(wp.dispatch(marcus, { type: 'sensitive.view', payload: { what: 'household:ngozi.ssn' } }).ok).toBe(false);
    ok(wp.dispatch(daniel, { type: 'sensitive.view', payload: { what: 'household:ngozi.ssn' } }));
    expect(wp.state.views).toHaveLength(1);
  });

  it('readiness does not report completion while blockers remain', () => {
    const wp = fresh();
    const r = readiness(ix, defs, wp.state, 4);
    expect(r.level).toBe('blocked');
    expect(r.steps.find((s) => s.id === 'client')!.done).toBe(false);
  });
});

describe('workpaper findings (computed from packet)', () => {
  it('finds the confident mistakes', () => {
    const ids = defs.map((d) => d.id);
    for (const id of ['WP-RSU-BASIS', 'WP-MILEAGE-DUP', 'WP-1099K-DOUBLE', 'WP-EST-FED', 'WP-EST-CA', 'WP-SEHI', 'WP-CA-WAGES', 'WP-INTEREST-DUP', 'WP-FX-YEAR', 'WP-VEHICLE-GIFT', 'WP-PROPTAX-PRORATION', 'WP-MORTGAGE-DUP', 'WP-HVAC', 'WP-MIXED-USE', 'WP-DEPENDENT-TIN', 'WP-READ-VS-PRINTED', 'WP-DUP-W2']) {
      expect(ids).toContain(id);
    }
    expect(byId.get('WP-RSU-BASIS')!.reconciliations.map((r) => r.b.value)).toEqual([19100, 19100, 9420]);
    expect(byId.get('WP-MILEAGE-DUP')!.reconciliations[0]).toMatchObject({ a: { value: 11800 }, b: { value: 8100 } });
    expect(byId.get('WP-EST-FED')!.reconciliations[0]).toMatchObject({ a: { value: 13000 }, b: { value: 12000 } });
    expect(byId.get('WP-EST-CA')!.reconciliations[0]).toMatchObject({ a: { value: 14000 }, b: { value: 10500 } });
    expect(byId.get('WP-CA-WAGES')!.reconciliations[0].comparable).toBe(false);
  });
  it('independent checks pass where the engine is right and fail where it is not', () => {
    const res = Object.fromEntries(independentChecks(ix, new Set(defs.map((d) => d.id))).map((r) => [r.id, r.pass]));
    expect(res).toMatchObject({ 'w2-box1': true, 'excess-ss': true, agi: true, 'bsum-D74': true, 'bsum-D28': true, scorp: true, 'irs-est': false, 'ftb-est': false, 'bsum-D31': false, 'read-vs-printed': false });
  });
});

describe('per-lot suggestions and duplicate adjustments', () => {
  const rsu = () => byId.get('WP-RSU-BASIS')!;

  it('suggests one adjustment per RSU lot: the gain drops by the D11 basis', () => {
    expect(rsu().suggestions.map((s) => [s.lineKey, s.from, s.to, s.effect.federal, s.effect.california])).toEqual([
      ['F8949.B.N1', 19240, 140, -6647, -1222],
      ['F8949.B.N3', 18480, -620, -6647, -1222],
      ['F8949.E.N4', 15300, 5880, -2242, -320],
    ]);
    // The single suggestion and the case-level estimate are unchanged.
    expect(rsu().suggested).toMatchObject({ lineKey: 'F8949.B.N1', from: 19240, to: 140, effect: { federal: -6647, california: -1222 } });
    expect(rsu().effect).toMatchObject({ federal: -15536, california: -2765 });
  });

  it('defaults suggestions to the single suggested adjustment for other cases', () => {
    for (const d of defs) {
      if (d.id === 'WP-RSU-BASIS') continue;
      expect(d.suggestions).toEqual(d.suggested ? [d.suggested] : []);
    }
  });

  it('refuses an identical pending or approved adjustment, but allows one after a rejection', () => {
    const wp = fresh();
    const s = rsu().suggestions[0];
    const adj = (adjId: string) => ({ type: 'case.adjust' as const, payload: { caseId: rsu().id, adjId, lineKey: s.lineKey, from: s.from, to: s.to, reason: s.reason, federal: s.effect.federal, california: s.effect.california } });
    ok(wp.dispatch(priya, adj('a1')));
    expect((wp.dispatch(priya, adj('a2')) as any).error).toMatch(/identical adjustment.*awaiting approval/);
    ok(wp.dispatch(helen, { type: 'case.adjust.decide', payload: { caseId: rsu().id, adjId: 'a1', decision: 'approved', note: 'Agreed to D11' } }));
    expect((wp.dispatch(priya, adj('a3')) as any).error).toMatch(/identical adjustment.*already approved/);
    // A different value on the same line is not a duplicate.
    ok(wp.dispatch(priya, { ...adj('a4'), payload: { ...adj('a4').payload, to: 141 } }));
    ok(wp.dispatch(helen, { type: 'case.adjust.decide', payload: { caseId: rsu().id, adjId: 'a4', decision: 'rejected', note: 'Typo' } }));
    ok(wp.dispatch(priya, { ...adj('a5'), payload: { ...adj('a5').payload, to: 141 } }));
  });

  it('proposes all three lots as one batch that a single undo removes', () => {
    const wp = fresh();
    const r = wp.dispatch(priya, rsu().suggestions.map((s, i) => ({ type: 'case.adjust' as const, payload: { caseId: rsu().id, adjId: `lot-${i}`, lineKey: s.lineKey, from: s.from, to: s.to, reason: s.reason, federal: s.effect.federal, california: s.effect.california } })));
    ok(r);
    expect(wp.state.cases[rsu().id].adjustments).toHaveLength(3);
    expect(caseFacts(ix, rsu(), wp.state).needsPartner).toBe(true);
    ok(wp.undo(priya, (r as any).events[0].id));
    expect(wp.state.cases[rsu().id].adjustments).toHaveLength(0);
  });
});
