# Miraflores workpaper — core idea, data model, and the errors it found

## Core idea

A workpaper should answer one question about any number: where did it come from, can I trust it, and what did we decide? So this one is not a set of schedules. It is a **review queue of cases over an evidence graph**:

- **The packet is the read-only base layer.** All 74 documents, 3,012 extracted values, the v1/v2/v3 returns and the client's answers are shown exactly as delivered and are never edited. Each `py:/`, `agency:/`, `ev-`, `D##` or `qa-` reference opens the record it points to.
- **Checks that don't trust the engine** run over the packet. Along with the engine's 13 diagnostics, 21 workpaper rules compare the extraction with the printed page, documents with each other, the return with the IRS/FTB records and the client's answers with the documents. Each finding becomes a **case** with both sides of the disagreement, the evidence and an estimated tax effect.
- **Everything people do is an append-only event.** Notes, questions, adjustments, decisions, sign-offs, document dispositions and undo are all events. State is a fold over the log, so the log also gives history, "changed since I last looked", undo, stale sign-offs and the audit trail.

**Optional AI layer.** An investigation copilot (Claude Sonnet 5.5) works one case at a time with read-only tools. It submits a structured report whose every cited id and amount is checked against the packet, and a reviewer must accept or reject it. It never changes the case. In 18 live eval runs it retrieved every expected record, cited only real, retrieved ids, and abstained on all six cases where the evidence is insufficient. Its main failure mode is citing the wrong record for a correct amount, which the verifier catches (see VALIDATION_REPORT.md).

## Data model

| Layer | Entities | Notes |
|---|---|---|
| Source (immutable) | Document → pages → ExtractedValue; ReturnVersion → ReturnLine (inputs, sources); client QA / messages / calls; prior-year and agency records | Indexed by the packet's own ids. Reverse indexes answer "where did this document land?" and "what uses this line?" |
| Derived (pure functions) | CaseDef (finding, reconciliations, suggested adjustment, close rules, priority); CheckResult (independent recomputation) | Every amount is computed from packet records by id, never typed in. |
| Workpaper (event log) | `WEvent {id, seq, at, actor, role, type, payload, batch}` → projected CaseState, DocState, sign-offs, view log | Commands are authorized before they are appended. |

Cases move `open → in review / awaiting client / blocked → ready for approval → resolved → reopened`. A decision needs an outcome and a rationale. "Substantiated" also needs linked documentary evidence; a client statement alone does not count. A case cannot close with unanswered questions, review notes that block filing, or pending adjustments. Segregation of duties is enforced (nobody approves their own work), and adjustments with a tax effect over 1,000 need a partner. Each sign-off stores a fingerprint of the evidence it covered. If links, answers, adjustments or document dispositions change afterwards, the sign-off shows as stale and readiness becomes blocked.

## Errors found, and how the design surfaced them

Effects are estimates (change × v3 `tax_effect_rates`; positive = more tax), except HVAC, which is the engine's own what-if result.

| # | Finding | How it surfaced | Est. effect (Fed / CA) |
|---|---|---|---|
| 1 | **RSU lots N1, N3, N4 on Form 8949 with $0 basis.** The supplemental statement D11 gives 47,620 of basis, and the RSU income is already in W-2 wages, so it is taxed twice. No engine diagnostic flags it. | Supplement-basis rule: matches 8949 lots to D11 by acquisition date | −15,536 / −2,765 |
| 2 | **Dependent SSN typo.** The organizer has 666-74-3309; the 2024 return (and later the SS card) has …3390. This is the e-file rejection the timeline replays. | Identity cross-check of the organizer against the prior-year return, possible before filing | blocks e-file |
| 3 | **1099-K counted twice.** Books revenue already includes the 12,400 of Paywell deposits (D15 p3); the engine added the 1099-K again. This is also an item in the 2028 Letter 566. | Reconciling books to SchC.1 | −4,402 / −384 |
| 4 | **SE health insurance 14,400 deducted** although qa-25 says Erik was eligible for employer family coverage (the 2024 return took none). | Questionnaire-vs-line rule | +4,464 / +605 |
| 5 | **California wages = all Halvorsen box 16 (111,300).** Payroll kept CA as the work state until 30 September by mistake; the July paystub shows CA wages of 22,469 at the move. | State-sourcing rule. Treated as judgment: payroll coding and residence dates alone don't decide it | ~ 0 / −5,685 if adopted |
| 6 | **CA estimated payments 14,000 vs FTB 10,500.** The 9/15/2025 payment was designated tax year 2024. | Agency agreement check | CA refund −3,500 |
| 7 | **HVAC system replacement (11,000) expensed as a repair.** | Repair-vs-improvement rule, plus the prior-year swing (3,900 → 13,300) | +3,633 / +896 (engine what-if) |
| 8 | **Mileage page 3 is a second scan of page 2.** 3,700 miles counted twice (11,800 vs 8,100). | Duplicate-page detector, plus the prior-year swing (7,400 → 11,800) | +919 / +80 |
| 9 | **Federal Q4 estimate taken from the client's "4,000 I think".** The IRS transcript shows 3,000. | Agency agreement check | balance due +1,000 |
| 10 | **Car donation claimed at 6,000** (Kelley Blue Book estimate). The 1098-C shows it was sold for 2,900. | 1098-C limit rule (also Letter 566 item) | +806 / +149 |
| 11 | **Northlake sweep interest 1,840 on two lines** (the composite 1099 and the sweep bank's 1099-INT for the same account). | Duplicate-payer rule | −640 / −127 |
| 12 | **Home property tax 13,420 deducted in full.** The seller's 6,912 share was credited at closing. | Closing-statement proration | +1,462 / +270 |
| 13 | **Payoff-statement interest 2,150 added** although D56 says it is already on the 1098. | Duplicate-source rule | +559 / +103 |
| 14 | **Family phone, home internet and Spotify at 100%.** The call notes give 70% and 50% business use, and Spotify as personal. | Call notes vs books | +541 / +47 |
| 15 | **Little Sprouts EIN read as 74-3829516** (confidence 0.97); the page prints 74-3829156. The 2441 provider name is also wrong. | Read-vs-printed scan of all 3,012 values (2 mismatches) | correctness |
| 16 | **Meridian summary 71,965 vs lots 71,715.** The 250 is lot M18 on page 32, which was never extracted. | Unread-page detector explains the engine diagnostic | −21 / −2 |
| 17 | **Swedish interest converted at the 2024 average FX rate.** | FX-year rule | +43 / +9 |
| 18 | Client said "no prior IRA basis" and "no investments sold"; the documents show 7,000 of basis and 294 dispositions. | Contradiction cases (the documents control; the client's answers are kept verbatim) | — |

The engine's own flags are kept as cases too, including two it stopped raising in v3. A cleared flag is not a review, so a reviewer still has to confirm the new inputs: D40 for the S corporation basis, which this app recomputes independently and agrees, and D37/D38 for Ridgeline.

**A correction to the brief I was given:** the $3,050 CryptoNorth "bank statement" exists only in the client's message (msg-07). No bank statement is in the packet. The crypto case therefore treats 3,050 as a lead and blocks a "substantiated" outcome until documentary evidence is linked.
