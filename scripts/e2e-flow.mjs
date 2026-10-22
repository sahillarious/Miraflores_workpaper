// Small diagnostic journeys for the guided case flow, each in a fresh browser
// context (empty localStorage) unless it continues the previous journey.
// Usage: start the app (npm run dev, or npm run build && npx vite preview --port 4173), then
//   BASE_URL=http://localhost:4173/ node scripts/e2e-flow.mjs [screenshotDir]
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:4173/';
const OUT = process.argv[2];
if (OUT && !existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const exe = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find((p) => existsSync(p));
const browser = await chromium.launch({ executablePath: exe, headless: true });
const results = [];
const errors = [];

async function newPage(width = Number(process.env.WIDTH ?? 1440), opts = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 950 }, ...opts });
  const page = await ctx.newPage();
  // The browser logs the 401 that journey (p2-b) provokes on purpose with a wrong access code; that one line is expected.
  page.on('console', (m) => { if (m.type() === 'error' && !/^Failed to load resource: the server responded with a status of 401 /.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE);
  return page;
}
const see = (page, t) => page.getByText(t, { exact: false }).first().waitFor({ timeout: 5000 });
const as = (page, id) => page.getByLabel('Act as').selectOption(id);
const open = async (page, hash) => { await page.goto(BASE + hash); await page.waitForTimeout(150); };
const shot = async (page, name) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); };
const checklist = (page, label) => page.locator('.flow-side .flow-checklist li', { hasText: label });

async function journey(name, fn) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return false; // ONLY=r-a runs a single journey
  try { await fn(); results.push(['PASS', name]); return true; } catch (e) { results.push(['FAIL', name, String(e).split('\n')[0]]); return false; }
}
const skip = (name) => results.push(['SKIP', name, 'depends on an earlier journey that failed']);

// (a)-(c) continue one session: preparer -> partner -> preparer -> partner.
const p = await newPage();
const a = await journey('(a) preparer completes steps 1-3 on the RSU case and sees "Waiting for partner approval"', async () => {
  await open(p, '#/case/WP-RSU-BASIS');
  await see(p, 'Step 1 of 4');
  await see(p, 'Fed −15,536');
  await shot(p, 'flow-1');
  await p.getByRole('button', { name: 'Yes, that’s right' }).click();
  await see(p, 'Step 2 of 4');
  await see(p, '19,100');
  await shot(p, 'flow-2');
  await p.getByRole('button', { name: 'The proof checks out' }).click();
  await see(p, 'Step 3 of 4');
  await see(p, 'the gain of 18,480 becomes a loss of 620');
  await p.getByRole('button', { name: 'Propose all' }).click();
  await see(p, 'Proposed 3 adjustment(s)');
  await see(p, 'Waiting for partner approval');
  if (!(await checklist(p, 'Adjustments approved').textContent()).includes('3 waiting for partner approval')) throw new Error('checklist does not show 3 waiting');
  // "Yes, that's right" recorded nothing: the only events are the three adjustments, in one batch.
  const log = await p.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('mf-workpaper:')) ?? 'mf-workpaper:') ?? '[]'));
  if (log.length !== 3 || !log.every((e) => e.type === 'case.adjust') || new Set(log.map((e) => e.batch)).size !== 1) throw new Error(`unexpected log: ${log.map((e) => e.type).join(',')}`);
  await shot(p, 'flow-3-waiting');
});
const b = a ? await journey('(b) partner approves the three adjustments', async () => {
  await as(p, 'st-03');
  await open(p, '#/case/WP-RSU-BASIS?step=3');
  await p.getByRole('button', { name: 'Approve all' }).click();
  await checklist(p, 'Adjustments approved').filter({ hasText: '3 approved' }).waitFor({ timeout: 5000 });
  if (!(await checklist(p, 'Adjustments approved').textContent()).includes('3 approved')) throw new Error('checklist does not show 3 approved');
}) : (skip('(b) partner approves'), false);
if (b) await journey('(c) preparer submits, a partner resolves, the checklist follows', async () => {
  await as(p, 'st-01');
  await open(p, '#/case/WP-RSU-BASIS?step=4');
  await p.getByLabel('Why (at least 20 characters').fill('D11 gives the basis for all three lots; the partner approved the adjustments.');
  await see(p, 'Nothing is missing');
  await shot(p, 'flow-4-send');
  await p.getByRole('button', { name: 'Submit for approval' }).click();
  await see(p, 'Decision submitted for approval');
  if (!(await checklist(p, 'Decision submitted').textContent()).includes('Waiting for partner approval')) throw new Error('decision not waiting for partner');
  await as(p, 'st-02');
  await open(p, '#/case/WP-RSU-BASIS');
  await see(p, 'Review and approve');
  await p.getByRole('button', { name: 'Approve & sign off' }).click();
  await see(p, 'needs partner sign-off');
  await as(p, 'st-03');
  await open(p, '#/case/WP-RSU-BASIS');
  await shot(p, 'flow-4-review');
  await p.getByRole('button', { name: 'Approve & sign off' }).click();
  await see(p, 'Approved and resolved');
  if (!(await checklist(p, 'Decision submitted').textContent()).includes('Approved and signed off')) throw new Error('decision not shown as signed off');
}); else skip('(c) preparer submits, partner resolves');

await journey('(d) client sees only the portal and answers a question', async () => {
  const c = await newPage();
  await open(c, '#/case/ENG-DIGITAL_ASSET_BASIS_MISSING?view=full');
  await c.getByPlaceholder('Add a note').fill('INTERNAL staff note: do not show the client.');
  await c.getByRole('button', { name: 'Add', exact: true }).click();
  await open(c, '#/case/ENG-DIGITAL_ASSET_BASIS_MISSING?step=4');
  await c.getByRole('button', { name: 'Ask the client' }).first().click();
  await see(c, 'Question sent to client');
  await as(c, 'cu-01');
  await open(c, '#/case/ENG-DIGITAL_ASSET_BASIS_MISSING');
  await see(c, 'Your preparer has 1 question');
  const body = await c.locator('body').innerText();
  for (const leak of ['INTERNAL staff note', 'Review queue', 'Blocked ·', 'Rationale', 'Fed −']) if (body.includes(leak)) throw new Error(`client view shows "${leak}"`);
  if (await c.locator('.sidenav').count()) throw new Error('client sees the staff navigation');
  await shot(c, 'portal-question');
  await c.getByLabel('Your answer').fill('Uploading the March 2021 bank statement today.');
  await c.getByRole('button', { name: 'Send answer' }).click();
  await see(c, 'answer sent');
  await as(c, 'st-01');
  await open(c, '#/case/ENG-DIGITAL_ASSET_BASIS_MISSING');
  if (!(await checklist(c, 'Client answered').textContent()).includes('answered')) throw new Error('checklist does not show the answer');
});

await journey('(e) a duplicate adjustment is refused (UI and domain)', async () => {
  const d = await newPage();
  await open(d, '#/case/WP-RSU-BASIS?step=3');
  await d.getByRole('button', { name: 'Propose', exact: true }).first().click();
  await see(d, 'Proposed F8949.B.N1');
  await see(d, 'Proposed, waiting for partner');
  await see(d, 'Propose remaining (2)');
  // The full view's manual form is prefilled with the same N1 suggestion; the domain refuses it.
  await open(d, '#/case/WP-RSU-BASIS?view=full');
  await d.getByRole('button', { name: 'Propose adjustment' }).click();
  await see(d, 'An identical adjustment (F8949.B.N1 to 140) is already awaiting approval');
});

await journey('(f) a reviewer signs off, a disposition change makes it stale, the checklist shows it', async () => {
  const f = await newPage();
  await open(f, '#/case/WP-DUP-W2?step=4');
  await f.getByLabel('Decision outcome').selectOption('explained_difference');
  await f.getByLabel('Why (at least 20 characters').fill('Same W-2 photographed; F1040.1a uses D09 only.');
  await f.getByRole('button', { name: 'Submit for approval' }).click();
  await see(f, 'Decision submitted for approval');
  await as(f, 'st-02');
  await open(f, '#/case/WP-DUP-W2');
  await f.getByRole('button', { name: 'Approve & sign off' }).click();
  await see(f, 'Approved and resolved');
  await open(f, '#/docs');
  await f.getByLabel('Select D10').check();
  await f.getByLabel('Set disposition').selectOption('supplemental');
  await see(f, '1 document(s) marked');
  await open(f, '#/case/WP-DUP-W2');
  await see(f, 'the evidence it covers changed afterwards');
  const txt = await checklist(f, 'Decision submitted').textContent();
  if (!txt.includes('changed afterwards') || txt.includes('Approved and signed off')) throw new Error(`checklist: ${txt}`);
  await shot(f, 'flow-stale');
});

await journey('(g) nobody approves their own work', async () => {
  const g = await newPage();
  // Preparer submits, then tries to approve the decision.
  await open(g, '#/case/WP-DUP-W2?step=4');
  await g.getByLabel('Decision outcome').selectOption('explained_difference');
  await g.getByLabel('Why (at least 20 characters').fill('Same W-2 photographed; F1040.1a uses D09 only.');
  await g.getByRole('button', { name: 'Submit for approval' }).click();
  await open(g, '#/case/WP-DUP-W2?view=full');
  await g.getByRole('button', { name: 'Approve & sign off' }).click();
  await see(g, 'Approval requires a reviewer or partner');
  // A reviewer proposes a reviewer-level adjustment and cannot approve it.
  await as(g, 'st-02');
  await open(g, '#/case/WP-MILEAGE-DUP?step=3');
  await g.getByRole('button', { name: 'Propose all' }).click();
  await see(g, 'Proposed 1 adjustment(s)');
  if (await g.getByRole('button', { name: /^Approve/ }).count()) throw new Error('the flow offers approval of own adjustment');
  await open(g, '#/case/WP-MILEAGE-DUP?view=full');
  await g.getByRole('button', { name: 'Approve', exact: true }).first().click();
  await see(g, 'may not approve their own adjustment');
});

// ---- help panel ----------------------------------------------------------------
const W = Number(process.env.WIDTH ?? 1440);
const panelOpen = (pg) => pg.locator('.help-root.open').count();
const focusedText = (pg) => pg.evaluate(() => document.activeElement?.textContent?.trim() ?? '');

await journey('(h-a) the help panel opens from each of the four steps, Esc closes it and focus returns', async () => {
  const h = await newPage();
  const configured = await h.evaluate(async () => (await (await fetch('./api/copilot/status')).json()).configured).catch(() => false);
  for (const step of [1, 2, 3, 4]) {
    await open(h, `#/case/WP-DEPENDENT-TIN?step=${step}`);
    await see(h, `Step ${step} of 4`);
    const trigger = step === 1 ? h.getByRole('button', { name: 'I need help' }) : h.getByRole('button', { name: 'Need help?' });
    await trigger.click();
    await h.getByRole('dialog', { name: 'How can we help with this case?' }).waitFor({ timeout: 3000 });
    await h.waitForFunction(() => document.activeElement?.textContent?.trim().startsWith('How can we help'), null, { timeout: 2000 }).catch(() => { throw new Error(`step ${step}: focus not on the panel title`); });
    if (step === 1) {
      // Tab stays inside the panel.
      for (let i = 0; i < 25; i++) await h.keyboard.press('Tab');
      if (!(await h.evaluate(() => !!document.activeElement?.closest('.help-drawer')))) throw new Error('focus escaped the panel');
      // Without an access code in this browser session the AI card never runs, configured or not.
      const ai = h.getByRole('button', { name: 'Get an AI second look' });
      if (!(await ai.isDisabled())) throw new Error('AI card is enabled without an access code');
      const inPanel = h.locator('.help-drawer');
      if (configured) { if (!(await inPanel.getByLabel('Enter access code').count())) throw new Error('no access code field in the AI card'); }
      else if (!(await inPanel.getByText('Not available right now: COPILOT_ACCESS_CODE', { exact: false }).count() + await inPanel.getByText('Not available right now: ANTHROPIC_API_KEY', { exact: false }).count())) throw new Error('AI card does not say why it is off');
      await h.getByText('What do these words mean?').click();
      await see(h, 'A Social Security number (SSN)');
      await shot(h, 'help-ssn-glossary');
      await h.getByText('What do these words mean?').click();
      await shot(h, 'help-ssn');
    }
    await h.keyboard.press('Escape');
    await h.waitForTimeout(250);
    if (await panelOpen(h)) throw new Error(`step ${step}: panel still open after Esc`);
    const f = await focusedText(h);
    if (f !== (step === 1 ? 'I need help' : 'Need help?')) throw new Error(`step ${step}: focus returned to "${f}"`);
  }
  // Backdrop click also closes (desktop only; on phones the sheet covers the backdrop).
  if (W > 900) {
    await h.getByRole('button', { name: 'Need help?' }).click();
    await h.mouse.click(40, 400);
    await h.waitForTimeout(250);
    if (await panelOpen(h)) throw new Error('backdrop click did not close the panel');
  }
});

await journey('(h-b) a client question sent from the panel appears in history; status follows the existing command', async () => {
  const h = await newPage();
  await open(h, '#/case/ENG-DIGITAL_ASSET_BASIS_MISSING');
  await h.getByRole('button', { name: 'Need help?' }).click();
  const box = h.getByLabel('Question', { exact: true });
  const pre = await box.inputValue();
  if (!pre.startsWith('Can the client upload the bank statement')) throw new Error(`not prefilled from the open question: "${pre}"`);
  await h.getByRole('button', { name: 'Send to the client' }).click();
  await see(h, 'Sent. The case is now waiting for the client.');
  await shot(h, 'help-confirmation');
  await h.getByRole('button', { name: 'Back to the steps' }).click();
  await see(h, 'Awaiting client');
  if (!(await checklist(h, 'Client answered').textContent()).includes('waiting for the client')) throw new Error('checklist not updated');
  const log = await h.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('mf-workpaper:'))) ?? '[]'));
  if (log.length !== 1 || log[0].type !== 'case.question' || log[0].payload.to !== 'client') throw new Error(`unexpected log ${JSON.stringify(log.map((e) => e.type))}`);
  await open(h, '#/case/ENG-DIGITAL_ASSET_BASIS_MISSING?view=full');
  await see(h, 'case.question');
});

await journey('(h-c) ask a colleague sends a staff question and leaves the status alone', async () => {
  const h = await newPage();
  await open(h, '#/case/WP-HVAC');
  await h.getByRole('button', { name: 'Need help?' }).click();
  await h.getByLabel('Who').selectOption('st-02');
  await h.getByLabel('Your question').fill('Is the HVAC a repair or an improvement in your view?');
  await h.getByRole('button', { name: 'Send to Daniel' }).click();
  await see(h, 'Sent to Daniel Ortiz');
  await h.getByRole('button', { name: 'Back to the steps' }).click();
  if (!(await h.locator('.flow-head .pill').first().textContent()).includes('Open')) throw new Error('status changed');
  await open(h, '#/case/WP-HVAC?view=full');
  await see(h, 'To Daniel Ortiz');
});

await journey('(h-d) mark as blocked requires a reason', async () => {
  const h = await newPage();
  await open(h, '#/case/WP-HVAC');
  await h.getByRole('button', { name: 'Need help?' }).click();
  await h.getByRole('button', { name: 'Mark as blocked' }).click();
  await see(h, 'Say what the case is blocked on.');
  const keys = await h.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('mf-workpaper:')).map((k) => JSON.parse(localStorage.getItem(k) ?? '[]').length));
  if (keys.some((n) => n > 0)) throw new Error('an event was recorded without a reason');
  await h.getByLabel('What is it blocked on? (required)').fill('Waiting for the contractor invoice detail');
  await h.getByRole('button', { name: 'Mark as blocked' }).click();
  await see(h, 'Marked as blocked');
  await h.getByRole('button', { name: 'Back to the steps' }).click();
  if (!(await h.locator('.flow-head .pill').first().textContent()).includes('Blocked')) throw new Error('status is not Blocked');
  await h.getByRole('button', { name: 'Need help?' }).click();
  await see(h, 'Not available right now: Cannot move from Blocked to Blocked');
});

await journey('(h-e) the client role never sees the help panel', async () => {
  const h = await newPage();
  await as(h, 'cu-01');
  await open(h, '#/case/WP-DEPENDENT-TIN');
  await see(h, 'Hello Ngozi');
  if (await h.getByRole('button', { name: 'Need help?' }).count()) throw new Error('client sees "Need help?"');
  if (await h.locator('.help-root').count()) throw new Error('help panel is in the client DOM');
});

await journey('(h-f) with prefers-reduced-motion, no transitions run', async () => {
  const still = await newPage(W, { reducedMotion: 'reduce' });
  const moving = await newPage(W);
  const probe = async (pg) => {
    await open(pg, '#/case/WP-RSU-BASIS?step=1');
    await pg.getByRole('button', { name: 'Yes, that’s right' }).click();
    return pg.evaluate(() => ({
      step: getComputedStyle(document.querySelector('.step-anim')).animationName,
      drawer: getComputedStyle(document.querySelector('.help-drawer')).transitionDuration,
      fill: getComputedStyle(document.querySelector('.progress-fill')).transitionDuration,
    }));
  };
  const r = await probe(still), m = await probe(moving);
  if (r.step !== 'none' || r.drawer !== '0s' || r.fill !== '0s') throw new Error(`reduced motion still animates: ${JSON.stringify(r)}`);
  if (m.step !== 'step-in-fwd' || m.drawer === '0s') throw new Error(`control run did not animate: ${JSON.stringify(m)}`);
  // A mid-transition frame for the screenshot set.
  await open(moving, '#/case/WP-RSU-BASIS?step=1');
  await moving.getByRole('button', { name: 'Yes, that’s right' }).click();
  await moving.waitForTimeout(60);
  if (OUT) await moving.screenshot({ path: `${OUT}/transition-mid.png` });
});

await journey('(h-g) Deep dive opens full details and "Back to guided steps" returns to the same step', async () => {
  const h = await newPage();
  await open(h, '#/case/WP-RSU-BASIS?step=3');
  await h.getByRole('button', { name: 'Need help?' }).click();
  await shot(h, 'help-rsu');
  await h.getByText('Deep dive: see the whole case').click();
  await see(h, 'Back to guided steps (step 3)');
  if (!h.url().includes('view=full&from=3')) throw new Error(`url ${h.url()}`);
  await h.getByRole('link', { name: '← Back to guided steps (step 3)' }).click();
  await see(h, 'Step 3 of 4');
});

// ---- identifier masking -----------------------------------------------------------
await journey('(m) identifiers are masked for every role; unmask is refused without clearance and logged with it', async () => {
  const pk = await (await fetch(new URL('./data/okafor_lindqvist_2025_packet.json', BASE))).json();
  const hh = pk.household;
  const secrets = [...hh.people.map((x) => x.ssn), ...pk.prior_years.return_2024.dependents.map((x) => x.ssn), ...hh.people.map((x) => x.ip_pin), String(hh.bank_account_for_refund_or_payment.account), String(hh.bank_account_for_refund_or_payment.routing)].filter(Boolean);
  const pages = ['#/case/WP-DEPENDENT-TIN', '#/case/WP-DEPENDENT-TIN?step=2', '#/case/WP-DEPENDENT-TIN?view=full', '#/doc/D06?page=1', '#/doc/D08', '#/client', '#/prior?ptr=%2Freturn_2024%2Fdependents', '#/case/WP-READ-VS-PRINTED?view=full'];
  const noLeak = async (pg, where) => {
    const html = await pg.content();
    for (const x of secrets) if (html.includes(x)) throw new Error(`${where}: full identifier ending ${String(x).slice(-4)} is in the DOM`);
    if (/\b\d{3}-\d{2}-\d{4}\b/.test(html)) throw new Error(`${where}: an SSN-shaped number is in the DOM`);
    if (/\b[A-Z]{2}\d{2}(?: ?\d{4}){3,7}\b/.test(html)) throw new Error(`${where}: an IBAN is in the DOM`);
  };
  for (const role of ['st-01', 'st-02', 'st-03', 'st-04']) {
    const h = await newPage();
    await as(h, role);
    for (const hash of pages) { await open(h, hash); await h.waitForTimeout(150); await noLeak(h, `${role} ${hash}`); }
    if (role === 'st-01') await shot(h, 'masked-full');
  }
  // The no-clearance preparer cannot reveal; the button says why.
  const m = await newPage();
  await as(m, 'st-04');
  await open(m, '#/case/WP-DEPENDENT-TIN');
  const btn = m.getByRole('button', { name: 'Identifiers masked' });
  if (!(await btn.isDisabled())) throw new Error('no-clearance preparer can press reveal');
  await see(m, '***-**-3390');
  await shot(m, 'masked-no-clearance');
  // The client never gets a reveal control and sees no identifiers.
  const c = await newPage();
  await as(c, 'cu-01');
  for (const hash of ['#/', '#/case/WP-DEPENDENT-TIN', '#/doc/D06?page=1']) { await open(c, hash); await noLeak(c, `client ${hash}`); }
  if (await c.getByRole('button', { name: /Show identifiers|Identifiers masked/ }).count()) throw new Error('client sees a reveal control');
  // A cleared preparer reveals; it is logged as sensitive.view and can be hidden again.
  const r = await newPage();
  await open(r, '#/case/WP-DEPENDENT-TIN');
  await r.getByRole('button', { name: 'Show identifiers (logged)' }).click();
  await see(r, 'Identifiers shown (logged)');
  if (!(await r.content()).includes('666-74-3390')) throw new Error('reveal did not show the identifier');
  const log = await r.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('mf-workpaper:'))) ?? '[]'));
  if (!log.some((e) => e.type === 'sensitive.view' && e.payload.what === 'doc:D06#page1' && e.actor === 'st-01')) throw new Error('reveal not logged');
  await r.getByRole('button', { name: 'Hide identifiers' }).click();
  await noLeak(r, 'after hide');
  await open(r, '#/activity');
  await see(r, 'doc:D06#page1');
});

// ---- Phase 2: AI summary, cache, access code, link bridge, rationale draft (no live model calls) ----
const status = await (await fetch(new URL('./api/copilot/status', BASE))).json().catch(() => ({ configured: false }));
const investigateCalls = (pg) => { const calls = []; pg.on('request', (r) => { if (r.url().includes('/api/copilot/investigate')) calls.push({ code: r.headers()['x-access-code'] }); }); return calls; };

await journey('(p2-a) with the copilot off, step 1 says so and everything else works', async () => {
  if (status.configured) return; // covered by the unconfigured run
  const h = await newPage();
  const calls = investigateCalls(h);
  await open(h, '#/case/WP-RSU-BASIS');
  await see(h, 'AI summary is off');
  await see(h, 'Step 1 of 4');
  if (calls.length) throw new Error('an investigation was requested while the copilot is off');
});

await journey('(p2-b) a wrong access code gets a friendly 401, no model call and no budget used', async () => {
  if (!status.configured) return;
  const h = await newPage();
  const calls = investigateCalls(h);
  await open(h, '#/case/WP-HVAC');
  await h.getByLabel('Enter access code').first().fill('definitely-wrong');
  await h.getByRole('button', { name: 'Use code' }).first().click();
  await see(h, 'That access code was not accepted');
  if (calls.length !== 1 || calls[0].code !== 'definitely-wrong') throw new Error(`expected one request with the typed code, got ${JSON.stringify(calls)}`);
  if (await h.evaluate(() => sessionStorage.getItem('mf-copilot-code'))) throw new Error('the rejected code was kept');
  if (await h.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('mf-copilot-cache:')))) throw new Error('a failed request was cached');
  const after = await (await fetch(new URL('./api/copilot/status', BASE))).json();
  if (after.usedToday !== status.usedToday) throw new Error(`401 consumed budget: ${status.usedToday} -> ${after.usedToday}`);
  await h.getByLabel('Enter access code').first().waitFor();
});

await journey('(p2-c) a cached verified report: three plain lines, ids only in the full analysis, link bridge and rationale draft', async () => {
  if (!status.configured) return;
  const CASE = 'ENG-BROKER_SUMMARY_DETAIL_MISMATCH';
  const key = status.cacheKeys[CASE];
  const madeAt = '2026-10-21T09:15:00.000Z';
  const run = {
    runId: 'run-e2e-fixture', caseId: CASE, outcome: 'validated', model: 'fixture', startedAt: madeAt, latencyMs: 1, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    modelTurns: 4, toolCalls: 3, schemaFailures: 0, trace: [], retrievedIds: ['ev-0703', 'doc:D31#page32'],
    report: {
      case_id: CASE, status: 'likely_issue',
      summary: 'The corrected Meridian 1099 summary (ev-0703) shows proceeds of 71,965.00 while the extracted lots total 71,715. The 250 difference matches a lot printed on an unextracted page (doc:D31#page32).',
      facts: [
        { statement: 'Summary proceeds on the corrected 1099 are 71,965.00.', evidence_ids: ['ev-0703'], quantities: [{ label: 'summary proceeds', value: 71965, evidence_id: 'ev-0703' }] },
        { statement: 'Page 32 prints lot M18 with proceeds 250.00; nothing was extracted from that page.', evidence_ids: ['doc:D31#page32'], quantities: [] },
        { statement: 'Summary minus extracted lots is 250.', evidence_ids: ['calc-1'], quantities: [{ label: 'difference', value: 250, evidence_id: 'calc-1' }] },
      ],
      hypotheses: [], missing_information: [],
      recommended_next_steps: [{ action: 'Add lot M18 from page 32 of D31 to Form 8949 or document why it is excluded.', rationale: 'It accounts for the difference.' }],
      client_question_draft: null, resolution_criteria: 'Close once the lot is on Form 8949.', requires_human_review: true,
    },
    validation: { passed: true, issues: [], citedIds: ['ev-0703', 'doc:D31#page32', 'calc-1'], existingCited: 3, retrievedCited: 3, quantitiesChecked: 2, quantitiesVerified: 2, textNumbersChecked: 4, textNumbersFound: 4 },
  };
  const h = await newPage();
  const calls = investigateCalls(h);
  await h.evaluate(({ key, run, madeAt, CASE }) => {
    localStorage.setItem(`mf-copilot-cache:${key}`, JSON.stringify({ cacheKey: key, madeAt, run }));
    localStorage.setItem(`mf-copilot-latest:${CASE}`, JSON.stringify({ cacheKey: key, madeAt }));
    sessionStorage.setItem('mf-copilot-code', 'not-the-real-code');
  }, { key, run, madeAt, CASE });
  await open(h, `#/case/${CASE}`);
  const box = h.locator('.flow-main .ai-summary').first();
  await box.waitFor({ timeout: 5000 });
  const text = await box.innerText();
  if (!/AI suggestion/.test(text) || !/cached · made/.test(text)) throw new Error(`summary header: ${text.slice(0, 120)}`);
  const lines = await box.locator('.ai-lines li').allInnerTexts();
  if (lines.length !== 3) throw new Error(`expected 3 lines, got ${lines.length}`);
  if (lines.some((l) => /\bev-\d|doc:D\d|\bD\d\d\b|\bR-|\bWP-|calc-/.test(l))) throw new Error(`ids in the visible summary: ${lines.join(' | ')}`);
  await shot(h, 'p2-summary');
  await box.getByText('Show full analysis').click();
  await box.locator('.ai-full').getByText('ev-0703').first().waitFor({ timeout: 3000 });
  if (calls.length) throw new Error('a cached report triggered a new investigation');
  // Step 2: link bridge, nothing linked until the click.
  await open(h, `#/case/${CASE}?step=2`);
  await see(h, 'Link these records as evidence?');
  if ((await h.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('mf-workpaper:')) ?? '') ?? '[]'))).some((e) => e.type === 'case.link')) throw new Error('linked before the click');
  await see(h, 'counts as documentary evidence');
  await shot(h, 'p2-link-bridge');
  if (!(await h.getByRole('button', { name: 'Select records to link' }).isDisabled())) throw new Error('link button enabled with nothing selected');
  await h.getByRole('button', { name: 'Select the documentary ones (2)' }).click();
  await h.getByRole('button', { name: 'Link 2 records' }).click();
  await see(h, 'Linked 2 record(s)');
  const links = (await h.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('mf-workpaper:'))) ?? '[]'))).filter((e) => e.type === 'case.link');
  if (links.map((e) => e.payload.ref).join(',') !== 'ev-0703,doc:D31#page32' || !links.every((e) => e.payload.why.startsWith('Cited by AI analysis run-e2e-fixture'))) throw new Error(`links: ${JSON.stringify(links.map((e) => e.payload))}`);
  // Step 4: rationale draft fills the box, labelled, never submitted.
  await open(h, `#/case/${CASE}?step=4`);
  await h.getByRole('button', { name: 'Draft from the AI analysis' }).click();
  const rationale = h.getByLabel('Why (at least 20 characters');
  if (!(await rationale.inputValue()).startsWith('The corrected Meridian 1099 summary')) throw new Error('draft not filled');
  await see(h, 'AI draft: check and edit it before you submit');
  await shot(h, 'p2-rationale-draft');
  await rationale.fill((await rationale.inputValue()) + ' Checked against page 32.');
  await see(h, 'Edited from an AI draft');
  const log = await h.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('mf-workpaper:'))) ?? '[]'));
  if (log.some((e) => e.type === 'case.propose')) throw new Error('the draft was submitted automatically');
  if (calls.length) throw new Error('an investigation was requested during the cached-report journey');
});

// (r) the reviewer's approve button survives navigating away and back (bug report: it vanished after Documents).
const spa = async (page, hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(250); };
await journey('(r-a) Theo SSN case: submit as Priya, Daniel sees Approve & sign off, still there after Documents and back via the queue', async () => {
  const r = await newPage();
  await open(r, '#/case/WP-DEPENDENT-TIN?view=full');
  await r.getByLabel('Reference to link').fill('doc:D06#page1');
  await r.getByLabel('Why').fill('2024 return as filed shows the SSN ending 3390');
  await r.getByRole('button', { name: 'Link', exact: true }).click();
  await see(r, 'linked to decision');
  await open(r, '#/case/WP-DEPENDENT-TIN?step=4');
  await r.getByLabel('Decision outcome').selectOption({ index: 0 });
  await r.getByLabel('Why (at least 20 characters').fill('Organizer typo; the 2024 return and the IRS letter agree on 3390.');
  await r.getByRole('button', { name: 'Submit for approval' }).click();
  await see(r, 'Decision submitted for approval');
  await as(r, 'st-02');
  const approve = r.getByRole('button', { name: 'Approve & sign off' });
  await approve.waitFor({ timeout: 3000 });
  await spa(r, '#/docs');
  await r.waitForTimeout(300);
  await spa(r, '#/queue');
  await r.locator('a.issue-title', { hasText: 'differs from the 2024 return' }).first().click();
  await r.waitForTimeout(300);
  const diag = await r.evaluate(() => ({ hash: location.hash, status: document.querySelector('.flow-head .pill')?.textContent, buttons: [...document.querySelectorAll('main button')].map((b) => b.textContent.trim()).slice(0, 12) }));
  if (!(await approve.isVisible())) throw new Error(`Approve & sign off is missing after navigating back: ${JSON.stringify(diag)}`);
  await shot(r, 'r-a');
  // Same state in the full-details view.
  await open(r, '#/case/WP-DEPENDENT-TIN?view=full');
  await r.getByRole('button', { name: /Approve & sign off/ }).first().waitFor({ timeout: 3000 });
  // A reload keeps the role and the button.
  await r.reload(); await r.waitForTimeout(300);
  await open(r, '#/case/WP-DEPENDENT-TIN');
  await approve.waitFor({ timeout: 3000 });
});

// (rr) related returns: the packet's three related returns, what we hold of each, and links in both directions.
await journey('(rr-a) Related returns page: three cards, documents and cases linked, reachable from Client records and from a K-1', async () => {
  const q = await newPage();
  await open(q, '#/client');
  await q.getByRole('link', { name: /See what each one touches/ }).click();
  await q.getByRole('heading', { name: 'Related returns' }).waitFor({ timeout: 5000 });
  const titles = await q.locator('.related-grid h3').allInnerTexts();
  const cards = await q.locator('.related-card').count();
  if (cards !== 3) throw new Error(`expected 3 related-return cards, found ${cards} (${titles.join(' | ')})`);
  const rid = q.locator('.related-grid section', { hasText: 'Ridgeline' });
  for (const d of ['D37', 'D38']) if (!(await rid.getByText(d, { exact: true }).count())) throw new Error(`Ridgeline card is missing ${d}`);
  const wood = q.locator('.related-grid section', { hasText: 'Woodworks' });
  for (const d of ['D39', 'D40']) if (!(await wood.getByText(d, { exact: true }).count())) throw new Error(`Woodworks card is missing ${d}`);
  const ada = q.locator('.related-grid section', { hasText: 'Ada' });
  if (!(await ada.getByText('nothing. We only know it exists.').count())) throw new Error('Ada card should say nothing is held');
  if (!(await ada.locator('a[href^="#/case/"]').count())) throw new Error('Ada card lists no case');
  await shot(q, 'related-returns');
  // From a K-1 document back to its return.
  await open(q, '#/doc/D39');
  await q.getByRole('link', { name: /Lindqvist Family Woodworks/ }).first().click();
  await q.getByRole('heading', { name: 'Related returns' }).waitFor({ timeout: 5000 });
  if (!(await q.locator('.related-grid section', { hasText: 'Woodworks' }).locator('.related-card.focus').count())) throw new Error('the K-1\'s return was not highlighted');
  // A document that is in no related return has no such line.
  await open(q, '#/doc/D31');
  if (await q.getByText('Part of a related return').count()) throw new Error('D31 should not claim a related return');
  if (Number(process.env.WIDTH ?? 1440) < 600) { await open(q, '#/related'); if ((await q.evaluate(() => document.documentElement.scrollWidth - innerWidth)) > 1) throw new Error('horizontal scroll on the related-returns page'); }
});

await browser.close();
for (const r of results) console.log(r.join(' | '));
console.log(errors.length ? `CONSOLE ERRORS (${errors.length}):\n${errors.slice(0, 10).join('\n')}` : 'No console errors');
process.exit(results.some((r) => r[0] !== 'PASS') || errors.length ? 1 : 0);
