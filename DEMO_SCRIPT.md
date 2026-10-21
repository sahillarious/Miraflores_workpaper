# Seven-minute demo

Start with `npm run build && npm run preview`, open http://localhost:4173. To start clean: Activity → Reset demo. The role switcher (top right) starts as **Priya Raman — preparer**.

**0:00–0:40 · The problem.** Overview. One household: a California → Texas move, 74 documents, 3,012 extracted values and three engine versions. The v3 figures (AGI 445,590; balance due 4,220; California overpayment 8,256, packet value −8,256) are engine snapshots, not verified. The top bar shows **Blocked · 34 open**.

**0:40–1:35 · Review queue.** Review queue. The default order is priority; hover "P1" on the RSU row to see its basis: high severity, estimated effect, confirmed discrepancy. Each row says what is wrong, why it matters and what to do next, plus owner, status and estimated effect. Point out *engine* vs *workpaper* origin: 13 engine diagnostics, 21 checks that don't trust the engine. Search `ev-0703` to show search by evidence id.

**1:35–2:45 · Meridian ($250).** Open the Meridian case.
- Pane A: D31 page 1 with **71,965.00** highlighted (ev-0703, confidence 0.99).
- Pane B, reconciliation: A 71,965 vs B 71,715 (17 lots), A − B = **250**. "What the evidence shows": the 250 is the proceeds printed on **page 32**, which was never extracted. Click `doc:D31#page32` under Supporting facts to see lot M18 (proceeds 250, basis 310).
- Supporting facts: D31 is the CORRECTED form and supersedes D30 (msg-05).

**2:45–3:40 · Versions.** Return & versions. v1→v2: the corrected Meridian 1099 (63 line changes). v2→v3: K-1s, SEP, 5498 and the extension payment (89 line changes; payments +36,000). Diagnostics *cleared* in v3: SCORP_BASIS_INCOMPLETE and K1_EXPECTED_NOT_RECEIVED. These stay open as cases because a version change is not a verified adjustment. Click `F1040.11` → line trace: input tree, 2024 value 228,409, and its value in each version.

**3:40–4:45 · Workflow.** Back in Meridian:
1. Add a note: "Page 32 lot M18 explains the 250."
2. Click **In review**.
3. Link `doc:D31#page32` with a reason.
4. Reconciliation → **Explained difference**, "Difference equals page-32 proceeds" → Record.
5. Decision: Explained difference + rationale → **Submit for approval**.
6. Click **Approve & sign off** as Priya: refused (approval needs a reviewer).
7. Switch role to **Daniel Ortiz — reviewer** → Approve. Status: Resolved.
8. History lists every step with undo. Activity shows the same events log-wide.

**4:45–5:40 · Uncertainty and evidence quality.**
- **Crypto (Coinhaven C6):** basis 0 (engine) vs 3,050 (client lead; *bank statement not in file*). Choose "Substantiated" with a rationale: blocked, because documentary evidence is required. Click "ask client" on the bank-statement question, then switch to **Ngozi Okafor — client**. The portal shows only that question; answer it. Back as Priya, the answer is recorded and the original msg-07 is untouched.
- **Duplicate W-2:** open `WP-DUP-W2` → D09/D10; F1040.1a counts D09 only. Independent checks: wages 212,400 agree.
- **A confident mistake:** Documents → D62 → ev-1045. The EIN was read as 74-3829**516** at confidence 0.97; the page prints 74-3829**156** ("not found in printed text").
- **Mileage:** Documents → D23 page 3: "Second scan of the May-Aug sheet", so 3,700 miles were counted twice.

**Optional, about 1 min · Investigation copilot (needs `ANTHROPIC_API_KEY` in `.env`).** Open WP-RSU-BASIS → **Investigate with copilot** (about 30 s). Point out:
- the purple "AI suggestion — not a verified finding" banner and the validation line (citations exist and were retrieved; amounts match records);
- facts with clickable evidence chips, versus hypotheses and missing information;
- the trace of tool calls the model chose.
Click **Accept**: the case is still **Open**, with no adjustment and no sign-off, and Activity shows `copilot.run` and `copilot.review`. Then open the crypto case to show the copilot answering "insufficient evidence" and drafting a document request that is not sent until you click "Send to client as my question".

**5:40–6:25 · Architecture.** The packet is the immutable base; reverse indexes answer "where did this land?". Cases are computed from packet ids. Every human action is an append-only event: state = fold(log). That one log gives history, undo, "changed since I last looked" (the Activity badge) and stale sign-offs: set D10 to "Supplemental" after resolving the W-2 case and its sign-off goes stale. Persistence sits behind a three-method repository (localStorage today, a server tomorrow).

**6:25–7:00 · Close.** Readiness: required steps computed from state. It says **Blocked** (the dependent SSN typo would reject the e-file, which is exactly what the packet's July replay shows) and never claims filing. Independent checks: 4 of 16 disagree with the engine. Summary: every finding is actionable (next action and owner), traceable (one click to the printed field) and auditable (an append-only log with segregation of duties).
