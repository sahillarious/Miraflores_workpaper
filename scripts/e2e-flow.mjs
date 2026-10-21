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

async function newPage(width = Number(process.env.WIDTH ?? 1440)) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 950 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE);
  return page;
}
const see = (page, t) => page.getByText(t, { exact: false }).first().waitFor({ timeout: 5000 });
const as = (page, id) => page.getByLabel('Act as').selectOption(id);
const open = async (page, hash) => { await page.goto(BASE + hash); await page.waitForTimeout(150); };
const shot = async (page, name) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); };
const checklist = (page, label) => page.locator('.flow-checklist li', { hasText: label });

async function journey(name, fn) {
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
  await see(p, 'Adjustments approved');
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

await browser.close();
for (const r of results) console.log(r.join(' | '));
console.log(errors.length ? `CONSOLE ERRORS (${errors.length}):\n${errors.slice(0, 10).join('\n')}` : 'No console errors');
process.exit(results.some((r) => r[0] !== 'PASS') || errors.length ? 1 : 0);
