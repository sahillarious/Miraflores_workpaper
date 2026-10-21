import { describe, expect, it } from 'vitest';
import { ix } from './load';
import { buildCases } from '../src/domain/cases';
import { MemoryRepository, Workpaper } from '../src/domain/store';
import { buildActors, type Actor } from '../src/domain/workflow';
import { explainSuggestion, existingAdjustment, flowState } from '../src/ui/flowState';

const defs = buildCases(ix);
const byId = new Map(defs.map((d) => [d.id, d]));
const actors = buildActors(ix);
const A = (id: string) => actors.find((a) => a.id === id) as Actor;
const priya = A('st-01'), daniel = A('st-02'), helen = A('st-03');
const fresh = () => new Workpaper(ix, defs, new MemoryRepository());
function ok(r: { ok: boolean; error?: string }) { if (!r.ok) throw new Error((r as any).error); }
const item = (wp: Workpaper, id: string, which: string) => flowState(ix, byId.get(id)!, wp.state).items.find((i) => i.id === which)!;

describe('guided flow state (derived from the event log)', () => {
  it('walks the RSU case: propose all lots, wait for the partner, submit, resolve', () => {
    const wp = fresh();
    const def = byId.get('WP-RSU-BASIS')!;
    expect(flowState(ix, def, wp.state).defaultStep).toBe(1);
    expect(item(wp, def.id, 'adjustments').state).toBe('na');

    const r = wp.dispatch(priya, def.suggestions.map((s, i) => ({ type: 'case.adjust' as const, payload: { caseId: def.id, adjId: `lot-${i}`, lineKey: s.lineKey, from: s.from, to: s.to, reason: s.reason, federal: s.effect.federal, california: s.effect.california } })));
    ok(r);
    let fs = flowState(ix, def, wp.state);
    expect(fs.defaultStep).toBe(3);
    expect(fs.pendingApprover).toBe('partner');
    expect(item(wp, def.id, 'adjustments')).toMatchObject({ state: 'waiting', detail: '3 waiting for partner approval' });
    expect(def.suggestions.every((s) => existingAdjustment(wp.state, def, s))).toBe(true);
    // Submission is refused while adjustments are pending (closeBlockers).
    expect((wp.dispatch(priya, { type: 'case.propose', payload: { caseId: def.id, outcome: 'corrected', rationale: 'Supplemental basis from D11 applied to all three lots.' } }) as any).error).toMatch(/awaiting approval/);

    for (const a of wp.state.cases[def.id].adjustments) ok(wp.dispatch(helen, { type: 'case.adjust.decide', payload: { caseId: def.id, adjId: a.id, decision: 'approved', note: 'Agreed to D11' } }));
    expect(item(wp, def.id, 'adjustments').state).toBe('done');

    ok(wp.dispatch(priya, { type: 'case.propose', payload: { caseId: def.id, outcome: 'corrected', rationale: 'Supplemental basis from D11 applied to all three lots.' } }));
    expect(item(wp, def.id, 'decision')).toMatchObject({ state: 'waiting', detail: 'Waiting for partner approval' });
    // A reviewer cannot resolve a corrected outcome with adjustments over the threshold.
    expect((wp.dispatch(daniel, { type: 'case.resolve', payload: { caseId: def.id } }) as any).error).toMatch(/partner/);
    ok(wp.dispatch(helen, { type: 'case.resolve', payload: { caseId: def.id } }));
    fs = flowState(ix, def, wp.state);
    expect(fs.defaultStep).toBe(4);
    expect(item(wp, def.id, 'decision').state).toBe('done');
  });

  it('shows a stale proposal (evidence changed after submission) and never "waiting" or "done"', () => {
    const wp = fresh();
    const id = 'WP-DUP-W2';
    ok(wp.dispatch(priya, { type: 'case.propose', payload: { caseId: id, outcome: 'explained_difference', rationale: 'Same W-2 photographed; F1040.1a uses D09 only.' } }));
    expect(item(wp, id, 'decision').state).toBe('waiting');
    ok(wp.dispatch(priya, { type: 'doc.disposition', payload: { docId: 'D10', disposition: 'duplicate', note: 'Phone photo of D09' } }));
    expect(flowState(ix, byId.get(id)!, wp.state).staleProposal).toBe(true);
    expect(item(wp, id, 'decision').state).toBe('stale');
    expect((wp.dispatch(daniel, { type: 'case.resolve', payload: { caseId: id } }) as any).error).toMatch(/evidence changed/);
  });

  it('shows a stale sign-off after resolution when a document disposition changes', () => {
    const wp = fresh();
    const id = 'WP-DUP-W2';
    ok(wp.dispatch(priya, { type: 'case.propose', payload: { caseId: id, outcome: 'explained_difference', rationale: 'Same W-2 photographed; F1040.1a uses D09 only.' } }));
    ok(wp.dispatch(daniel, { type: 'case.resolve', payload: { caseId: id } }));
    expect(item(wp, id, 'decision').state).toBe('done');
    ok(wp.dispatch(priya, { type: 'doc.disposition', payload: { docId: 'D10', disposition: 'supplemental', note: 'Photo shows a box the PDF lacks' } }));
    expect(flowState(ix, byId.get(id)!, wp.state).staleSignoff).toBe(true);
    expect(item(wp, id, 'decision').state).toBe('stale');
  });

  it('tracks client questions from the log', () => {
    const wp = fresh();
    const id = 'ENG-DIGITAL_ASSET_BASIS_MISSING';
    expect(item(wp, id, 'client').state).toBe('na');
    ok(wp.dispatch(priya, { type: 'case.question', payload: { caseId: id, qid: 'q1', to: 'client', toWho: 'cu-01', text: 'Please send the March 2021 bank statement.', expected: 'Statement' } }));
    expect(item(wp, id, 'client').state).toBe('waiting');
    ok(wp.dispatch(A('cu-01'), { type: 'case.answer', payload: { caseId: id, qid: 'q1', text: 'Uploading it today.' } }));
    expect(item(wp, id, 'client').state).toBe('done');
  });

  it('explains each RSU lot in plain words from the case numbers', () => {
    const def = byId.get('WP-RSU-BASIS')!;
    expect(def.suggestions.map((s) => explainSuggestion(def, s))).toEqual([
      'The broker reported zero cost for lot N1. The company statement (D11) gives a cost of 19,100, so the taxable gain drops from 19,240 to 140.',
      'The broker reported zero cost for lot N3. The company statement (D11) gives a cost of 19,100, so the gain of 18,480 becomes a loss of 620.',
      'The broker reported zero cost for lot N4. The company statement (D11) gives a cost of 9,420, so the taxable gain drops from 15,300 to 5,880.',
    ]);
  });
});

describe('work list for the home page', () => {
  it('puts approvals first for a partner and never the partner\'s own work', async () => {
    const { workList } = await import('../src/ui/flowState');
    const wp = fresh();
    // Preparer: same order as the queue (score, then severity), so the Blocker SSN case ties with RSU and sorts first.
    const { comparePriority } = await import('../src/ui/labels');
    const queueOrder = [...defs].sort(comparePriority).map((d) => d.id);
    expect(queueOrder.slice(0, 2)).toEqual(['WP-DEPENDENT-TIN', 'WP-RSU-BASIS']);
    expect(byId.get('WP-DEPENDENT-TIN')!.priorityScore).toBe(byId.get('WP-RSU-BASIS')!.priorityScore); // the score itself is unchanged
    expect(workList(ix, defs, wp.state, priya)[0].id).toBe(queueOrder[0]);
    // Propose the 1099-K correction (third by priority; its effect needs a partner).
    const def = byId.get('WP-1099K-DOUBLE')!;
    expect(queueOrder.indexOf(def.id)).toBeGreaterThan(0);
    const s0 = def.suggestions[0];
    ok(wp.dispatch(priya, { type: 'case.adjust', payload: { caseId: def.id, adjId: 'k1', lineKey: s0.lineKey, from: s0.from, to: s0.to, reason: s0.reason, federal: s0.effect.federal, california: s0.effect.california } }));
    expect(workList(ix, defs, wp.state, helen)[0].id).toBe(def.id);
    // A reviewer cannot approve partner-level adjustments, so it does not jump the reviewer's list.
    const forDaniel = workList(ix, defs, wp.state, daniel);
    expect(forDaniel[0].id).not.toBe(def.id);
    expect(wp.state.cases[forDaniel[0].id].owner).toBe(daniel.id); // his own case (Letter 566) comes first
    expect(workList(ix, defs, wp.state, helen)).toHaveLength(defs.length);
  });
});

describe('plain-language case summaries', () => {
  it('gives every case one plain sentence with no ids, rule codes or line keys', async () => {
    const { plainSummary, TECHNICAL, PLAIN_WRITTEN } = await import('../src/domain/plain');
    for (const d of defs) {
      const s = plainSummary(d);
      expect(s, d.id).not.toMatch(TECHNICAL);
      expect(s, d.id).not.toMatch(/NaN|undefined/);
    }
    expect(PLAIN_WRITTEN).toHaveLength(defs.length);
    expect(plainSummary(byId.get('WP-RSU-BASIS')!)).toContain('47,620');
    expect(plainSummary(byId.get('WP-DEPENDENT-TIN')!)).toMatch(/ending 3309.*ending 3390.*e-file would be rejected/);
  });
});

describe('no-estimate sentence', () => {
  it('says the SSN case blocks e-file and never claims "no tax change"', async () => {
    const { noEstimateSentence } = await import('../src/ui/flowState');
    expect(noEstimateSentence(byId.get('WP-DEPENDENT-TIN')!)).toBe('No dollar estimate. This blocks e-file until it is resolved.');
    for (const d of defs.filter((x) => !x.effect)) expect(noEstimateSentence(d), d.id).not.toMatch(/no (tax )?change/i);
  });
});
