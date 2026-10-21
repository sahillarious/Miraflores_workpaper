# Validation report

## Update 2026-10-19: investigation copilot

Run on Node 24.13, Windows 11, Chrome headless. Model: `claude-sonnet-5-5` (Sonnet was chosen by the project owner instead of the Opus default), effort `high`.

### Commands actually run

| Command | Result |
|---|---|
| `npm run build` | Pass (343 KB JS, 105 KB gzip) |
| `npm test` | **54 / 54 pass**: 26 earlier domain tests unchanged, plus 28 copilot tests covering tools, redaction, loop, budget, tool and provider errors, deadline, schema retry, citation and amount verification, regression cases, review permissions and the API |
| `node scripts/e2e.mjs` (preview, copilot unconfigured) | **24 / 24 pass**, no console errors |
| `EXPECT_COPILOT=configured node scripts/e2e.mjs` (preview, copilot configured) | **24 / 24 pass**, no console errors |
| Live UI check (headless Chrome, real model) | WP-RSU-BASIS: report validated → Accept recorded → case status still **Open** → `copilot.run` and `copilot.review` in Activity; no console errors |
| `npm run eval:copilot -- --dry` | Eval definitions OK (9 cases, 18 expected-retrieval groups, all ids exist) |
| `npm run eval:copilot -- --repeat 2` | 18 live runs, results below (`eval/results/run-2026-10-19T21-45-57-821Z.json`) |
| `npx tsx eval/rescore.ts <that file>` | Saved reports re-verified after verifier fixes: 15/18 validated (below) |
| Leak checks | No `sk-ant` pattern and no SDK in `dist/`. `.env` is gitignored. The packet is byte-identical in the original, `public/` and `dist/` (sha256 ee01f850…) |

### Evaluation method

Nine real cases (`eval/cases.ts`), each run twice. Expectations were written from the packet:
- **Grounded:** Meridian $250 gap; RSU zero basis; questionnaire vs sales; federal estimates vs transcript; California wage sourcing.
- **Duplicate:** W-2 D09/D10.
- **Abstention:** crypto C6 basis (client claim only); St. Brigid handwritten amount.
- **Negative:** an informational diagnostic (AOTC) that must not be called an error.

Every metric is computed by code:

| Metric | How |
|---|---|
| Retrieval recall | Share of expected id groups retrieved by tool calls |
| Citation validity | Cited ids exist in the packet |
| Citation support | Cited ids were retrieved in the run, and each quantity matches its cited record |
| Numerical correctness | Quantities match records; prose amounts appear in retrieved data; expected amounts (250; 19,100 and 9,420; 1,000) appear as verified quantities |
| Status | In the case's acceptable set |
| Uncertainty and abstention | Missing information present where expected; abstention cases not "confirmed" and no client-only amount stated as fact |
| Usefulness | **Keyword proxies** on mentions and next steps. These are a weak signal, not a judgment of quality |
| Reliability and cost | Schema failures, outcome, latency, tokens; cost at list price |

### Results (18 runs, 9 cases × 2)

| Metric | Result |
|---|---|
| Usable report returned | 18/18 |
| Schema failures | 1 (rejected in-run, model resubmitted a valid report) |
| Retrieval recall | 100% (every expected group, every run) |
| Citations exist / cited ids were retrieved | 100% / 100% |
| Prose amounts found in retrieved data | 99.7% (the one miss was a form name, now fixed) |
| Expected amounts stated and verified | 100% |
| Status acceptable | **17/18**: the W-2 run 2 said `confirmed_discrepancy` while its own summary says the W-2 is counted once |
| Abstention (crypto ×2, St. Brigid ×2, AOTC ×2) | 6/6; crypto never stated 3,050 as fact |
| Missing information where expected | 6/6 |
| Client question drafted where expected | 2/2 |
| Keyword proxies (mentions, next step) | 100% / 100% |
| **Passed verification, verifier as run** | **10/18** |
| **Passed verification after verifier fixes (re-scored, no new model calls)** | **15/18** |
| Latency | median 29.4 s (20.7–41.1 s); 4–7 model turns, 7–14 tool calls |
| Tokens | 796,218 input (631,028 cache reads, 164,794 cache writes) + 69,871 output |
| Cost | $1.24 total at list price, about $0.069 per investigation |

**The 13 verification issues, classified by hand:**
- **3 were genuine model errors, correctly caught.** In each, the model cited the wrong record for a correct amount:
  - 1,290 cited to ev-0708 (an unrelated lot);
  - 8,400 cited to ev-0532 (the sale-date field; proceeds are ev-0533);
  - 25,400 cited to F1040.1a (wages) instead of line 25a.
- **10 were verifier false positives, now fixed:**
  - 6: line values from v1/v2 or 2024 were compared only against v3;
  - 3: amounts printed in a line's label, note or rule text, which the tools return to the model;
  - 1: the form name "F8863" was read as an amount.

Regression tests assert that the 10 now pass and that the 3 genuine errors still fail.

**Other defects found by live runs and fixed:**
- Strict tool schemas rejected `minimum`. The first live call returned a 400; there is now a test that bans unsupported keywords.
- No tool exposed household facts. The model correctly reported it could not verify "Ada files her own return"; `get_evidence` now returns household members without identity numbers.
- The UI token count showed only uncached input (displayed "24 in"); it now shows total input and cache reads.

**Not done.** The 15/18 figure is a re-score of saved reports. The full eval was **not re-run** after the fixes, to save cost. A fresh run would also exercise the new household retrieval.

### Limitations of this evaluation

- 9 cases × 2 runs is a small sample, and the usefulness metrics are keyword proxies.
- The expectations were written by the same person who built the copilot, so treat these results as a regression baseline, not an accuracy claim.
- Citation "support" is checked for ids and amounts, not for whether a sentence's meaning is entailed by the record.
- One model, one effort level, no comparison with Haiku.
- The endpoint has no authentication, and copilot permission checks run in the client-side command layer like the rest of the demo.

---

## Original validation (2026-10-18)

Run on 2026-10-18, Node 24.13, Windows 11, Chrome (headless, via playwright-core).

## Commands actually run

| Command | Result |
|---|---|
| `npm run build` (tsc --noEmit + vite build) | Pass. Bundle 330 KB JS (101 KB gzip), 18 KB CSS |
| `npm test` (vitest, `tests/domain.test.ts`) | **26 / 26 pass** |
| `node scripts/e2e.mjs` against `vite preview` | **23 / 23 pass, no console errors** |

## Automated domain tests (real packet)

| Area | Tests |
|---|---|
| Data integrity | The served packet is byte-identical to the delivered file (sha256). v1/v2/v3 summaries match the supplied values exactly. v1/v2/v3 lines stay distinct. 74 documents and 3,012 values have unique ids. Every reference cited by lines, diagnostics and cases resolves (inputs included). Missing values stay missing (ev-0919 is null). Exactly two values disagree with their printed page (ev-1045, ev-1049). |
| Meridian | 71,965 vs 71,715, difference 250, explained by page 32. It cannot close on a short rationale. |
| Questionnaire | qa-14 and qa-15 are linked to D28/D31/D74/D34. A follow-up answer is recorded, qa-14 is unchanged, and a second answer is refused. |
| Duplicate W-2 | D09/D10 are detected. Dispositions primary and duplicate can be recorded. The independent wage sum is 212,400 (not double-counted). |
| Crypto basis | 0 vs 3,050 is shown as a lead with "not in file". No suggested adjustment. "Substantiated" is refused with only msg-07 linked. |
| Workflow | A note persists across a new store instance on the same storage. Status changes are in history and invalid transitions are refused. Rationale, segregation of duties, the partner threshold and reopen are enforced. A sign-off goes stale when a disposition changes after resolution. Undo hides without deleting. Unmasking without clearance is refused and with clearance is logged. Readiness is "blocked" at the start. |
| Findings | All 17 workpaper findings are present. RSU basis 19,100 / 19,100 / 9,420. Miles 11,800 vs 8,100. Federal estimates 13,000 vs 12,000. California estimates 14,000 vs 10,500. CA wages flagged as not comparable. Independent checks pass where the engine is right and fail where it is not. |

## Browser journey (scripts/e2e.mjs)

Overview figures → queue → search `ev-0703` → Meridian amounts → note persists after reload → status in history → link evidence and record reconciliation → preparer refused approval → reviewer approves → crypto blocked without documentary evidence → ask client → client portal answers → D23 page 3 → D62 EIN highlighted as not found → documents bulk disposition and undo → line trace → versions → checks → readiness blocked → activity → masked SSNs for a restricted user → narrow (390 px) case view with no horizontal scroll.

## Data findings

**Confirmed discrepancies** (the evidence settles it): RSU zero basis; 1099-K counted twice; federal Q4 estimate; California 2024-designated payment; mileage duplicate page; vehicle donation over the 1098-C proceeds; Northlake interest twice; payoff interest twice; personal share of phone, internet and Spotify; Little Sprouts EIN misread; Swedish FX year; Meridian unread page; dependent SSN typo.

**Need judgment or more evidence** (kept open with the missing evidence named): California wage sourcing (payroll coding and residency do not settle it); HVAC repair vs improvement; SE health insurance eligibility by month; home property-tax proration; crypto C6 basis (the client's figure only, and no bank statement in the packet); St. Brigid amount (a client phone confirmation; no bank record in the packet); California AMT (not computed by the engine).

**Formatting-only differences ignored by design:** percent values stored as fractions (0.22 vs "22%"), dates as ISO vs MM/DD/YYYY, money with and without separators. The read-vs-printed check normalises these and flags only real mismatches.

**Correction to the task brief:** it says "a bank statement includes a $3,050 CryptoNorth transaction". The packet has no bank statement. Only msg-07 describes one. The app treats it as unverified.

## Manual checks

- Screenshots of every view at 1500 px and 390 px reviewed for layout, overflow and readability.
- Overview figures checked against `return_versions[2].summary`; the California −8,256 is labelled "Overpayment (refund)" with the packet value shown.

## Known limitations

- **Single-browser persistence.** The static demo saves to localStorage. Export/Import moves a session, but people do not see each other's changes live.
- **Demo roles.** The role switcher simulates users; it is not authentication. Rules are enforced in the client-side command layer.
- **Estimates.** Tax effects are rate × change estimates (README rule); only HVAC uses an engine what-if. Approved adjustments are an overlay and do not recompute the return.
- **Rule specificity.** Some rules read specific packet fields (D15 deposit note, call-01 percentages, D11 lot matching by date). Each states its source.
- **Not built:** e-file, extension and notice workflows beyond tracking; time against budget; firm-wide standards editing; next-year roll-forward beyond the carryover display; per-lot tools for hundreds of sales (Form 8949 is grouped by box with drill-down).
