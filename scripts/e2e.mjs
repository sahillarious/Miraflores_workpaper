// End-to-end smoke test of the primary journey in a real browser.
// Usage: npm run build && npx vite preview --port 4173 &  then  node scripts/e2e.mjs [screenshotDir]
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
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

let step = 0;
async function shot(name) { if (OUT) await page.screenshot({ path: `${OUT}/${String(++step).padStart(2, '0')}-${name}.png`, fullPage: false }); }
async function expectText(t) { await page.getByText(t, { exact: false }).first().waitFor({ timeout: 5000 }); }
const results = [];
async function check(name, fn) {
  try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, String(e).split('\n')[0]]); }
}

await page.goto(BASE);
await page.evaluate(() => localStorage.clear());
await page.goto(BASE);
await check('overview shows v3 snapshot', async () => { await expectText('445,590'); await expectText('Balance due'); await expectText('Overpayment (refund)'); });
await shot('overview');

await page.goto(BASE + '#/queue');
await check('queue lists cases with priorities', async () => { await expectText('Corvane RSU sales reported with $0 basis'); await expectText('Meridian 1099-B summary proceeds'); });
await check('queue search by evidence id', async () => {
  await page.getByPlaceholder('Search title').fill('ev-0703');
  await expectText('Meridian 1099-B summary proceeds 71,965');
});
await shot('queue');

await page.goto(BASE + '#/case/ENG-BROKER_SUMMARY_DETAIL_MISMATCH?view=full');
await check('copilot panel shows its state without breaking the case', async () => {
  await expectText('Investigation copilot');
  await expectText('AI · suggestions only');
  if (process.env.EXPECT_COPILOT !== 'configured') await expectText('AI copilot is off');
});
await check('Meridian case shows both amounts and difference', async () => { await expectText('71,965.00'); await expectText('71,715.00'); await expectText('page 32'); });
await shot('case-meridian');

await check('add a note persists after reload', async () => {
  await page.getByPlaceholder('Add a note').fill('Page 32 lot M18 explains the 250; propose adding it to 8949.');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expectText('Note added');
  await page.reload();
  await expectText('Page 32 lot M18 explains');
});
await check('status transition appears in history', async () => {
  await page.getByRole('button', { name: 'In review', exact: true }).click();
  await expectText('Moved to In review');
  await expectText('case.status');
});
await check('link evidence and record reconciliation', async () => {
  await page.getByPlaceholder('e.g. D11 or ev-0066').fill('doc:D31#page32');
  await page.getByPlaceholder('Why it supports the conclusion').fill('Unread page with lot M18 (proceeds 250)');
  await page.getByRole('button', { name: 'Link', exact: true }).click();
  await expectText('linked to decision');
  await page.getByLabel('Evidence check result').first().selectOption('explained');
  await page.getByPlaceholder('How was this concluded?').first().fill('Difference equals page-32 proceeds');
  await page.getByRole('button', { name: 'Record', exact: true }).first().click();
  await expectText('Evidence check recorded');
});
await check('preparer cannot approve a decision', async () => {
  await page.getByLabel('Outcome', { exact: true }).selectOption('explained_difference');
  await page.getByPlaceholder('Rationale and authority').fill('Summary includes lot M18 printed on page 32, which the pipeline did not read. Proceeds 250, basis 310.');
  await page.getByRole('button', { name: 'Submit for approval' }).click();
  await expectText('Decision submitted for approval');
  await page.getByRole('button', { name: 'Approve & sign off' }).click();
  await expectText('Approval requires a reviewer or partner');
});
await check('reviewer approves', async () => {
  await page.getByLabel('Act as').selectOption('st-02');
  await page.getByRole('button', { name: 'Approve & sign off' }).click();
  await expectText('Approved and resolved');
});
await shot('case-resolved');

await page.getByLabel('Act as').selectOption('st-01');
await page.goto(BASE + '#/case/ENG-DIGITAL_ASSET_BASIS_MISSING?view=full');
await check('crypto case keeps uncertainty; client message alone insufficient', async () => {
  await expectText('Client-reported purchase (lead, unverified)');
  await page.getByLabel('Outcome', { exact: true }).selectOption('substantiated');
  await page.getByPlaceholder('Rationale and authority').fill('Client says it cost about 3,050 in March 2021.');
  await expectText('needs documentary evidence');
});
await check('ask client a question', async () => {
  await page.getByRole('button', { name: 'ask client' }).first().click();
  await expectText('Question sent to client');
});
await shot('case-crypto');

await page.getByLabel('Act as').selectOption('cu-01');
await check('client portal shows question and records answer', async () => {
  await expectText('Your preparer has 1 question');
  await page.getByLabel('Your answer').fill('Uploading the March 2021 bank statement today.');
  await page.getByRole('button', { name: 'Send answer' }).click();
  await expectText('answer sent');
});
await shot('client-portal');
await page.getByLabel('Act as').selectOption('st-01');

await page.goto(BASE + '#/doc/D23?page=3');
await check('mileage page 3 shows the second-scan note', async () => { await expectText('Second scan of the May-Aug sheet'); });
await page.goto(BASE + '#/doc/D62?ev=ev-1045');
await check('document view focuses a value', async () => { await expectText('not found in printed text'); });
await shot('doc-ein');

await page.goto(BASE + '#/docs');
await check('documents list and bulk disposition with undo', async () => {
  await page.getByLabel('Select D09').check();
  await page.getByLabel('Select D10').check();
  await page.getByLabel('Set disposition').selectOption('reviewed');
  await expectText('2 document(s) marked');
  await page.getByRole('button', { name: 'Undo last bulk change' }).click();
  await expectText('Undone');
});
await shot('documents');

await page.goto(BASE + '#/line/F1040.11');
await check('line trace shows inputs and versions', async () => { await expectText('Adjusted gross income'); await expectText('F1040.9'); await expectText('428,023'); });
await shot('line-trace');

await page.goto(BASE + '#/versions');
await check('versions compare', async () => { await expectText('Line changes'); await expectText('Engine what-ifs'); });
await shot('versions');

await page.goto(BASE + '#/checks');
await check('independent checks', async () => { await expectText('differs'); await expectText('Brightpath'); });
await shot('checks');

await page.goto(BASE + '#/readiness');
await check('readiness blocked', async () => { await expectText('Blocked'); await expectText('Client approval and e-file authorization'); });
await shot('readiness');

await page.goto(BASE + '#/activity');
await check('activity log lists events', async () => { await expectText('case.note'); await expectText('Season timeline'); });
await shot('activity');

await page.getByLabel('Act as').selectOption('st-04');
await page.goto(BASE + '#/client');
await check('restricted staff sees masked SSNs', async () => { await expectText('masked'); });

await page.setViewportSize({ width: 390, height: 844 });
await page.getByLabel('Act as').selectOption('st-01');
await page.goto(BASE + '#/case/WP-RSU-BASIS?view=full');
await check('narrow layout renders case', async () => { await expectText('Supplemental adjusted basis'); });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
results.push([overflow ? 'FAIL' : 'PASS', 'no horizontal scroll at 390px']);
await shot('mobile-case');

await browser.close();
for (const r of results) console.log(r.join(' | '));
console.log(errors.length ? `CONSOLE ERRORS (${errors.length}):\n${errors.slice(0, 10).join('\n')}` : 'No console errors');
process.exit(results.some((r) => r[0] === 'FAIL') || errors.length ? 1 : 0);
