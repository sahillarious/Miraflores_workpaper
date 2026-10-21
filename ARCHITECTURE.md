# Architecture

## Shape

```
public/data/okafor_lindqvist_2025_packet.json      (served unchanged; test asserts byte equality)
        │ fetch
        ▼
domain/packetIndex.ts   read-only index + reverse indexes (doc → lines, line → dependents, ref → lines)
domain/refs.ts          resolves every packet reference format to {kind, label, value, route}
domain/checks.ts        detectors (duplicate pages/documents, read-vs-printed) + 16 independent recomputations
domain/cases.ts         13 engine diagnostics + 21 workpaper rules → CaseDef[] (computed from packet ids)
domain/effects.ts       tax-effect estimates from tax_effect_rates (engine cannot be rerun)
domain/workflow.ts      events, projection, state machine, authorization, close rules, readiness
domain/store.ts         Workpaper (dispatch/undo/export) over a Repository (localStorage | memory)
        │
ui/ (context, router, components, DocPage)  →  views/ (Overview, Queue, CaseView, Documents, Versions, LineTrace, …)
```

Everything under `domain/` is plain TypeScript with no React, which is why the 26 tests run on the real packet in Node.

## Data model

**Source layer (immutable).** The packet's own types (`types.ts`). Ids are the packet's ids: `D##`, `ev-####`, `qa-NN`, `msg-NN`, `call-NN`, line keys and version ids. Prior-year and agency records are addressed by the packet's JSON-pointer references (`py:/…`, `agency:/…`). Nothing gets a synthetic id.

**Derived layer (pure).**
- `CaseDef`: id (`ENG-<code>` or `WP-<name>`), origin, rule id, classification (confirmed discrepancy, potential, missing evidence, contradiction, judgment, informational, out of scope, duplicate), why, why it matters, supporting and conflicting facts with refs, open questions, close requirements, affected lines, reconciliations, an optional suggested adjustment, an effect estimate, allowed outcomes, the outcomes that need documentary evidence, and a priority with its stated basis.
- `CheckResult`: method, side A, side B, pass, linked case.

**Workpaper layer (event log).** `WEvent {id, seq, at, actor, role, type, payload, batch?}`. Types: `case.status|assign|note|note.clear|link|unlink|question|answer|recon|adjust|adjust.decide|propose|resolve|return|reopen`, `doc.disposition`, `sensitive.view`, `engagement.signoff`, `undo`. `project()` folds the log into `CaseState`, `DocState`, engagement sign-offs and the view log. `undo` hides earlier events (or a whole batch) without deleting them.

## Key rules (workflow.ts)

- **State machine:** the free transitions are open ⇄ in review / awaiting client / blocked. "Ready for approval" is reached only by `case.propose` (decision + rationale), "resolved" only by `case.resolve`, and "reopened" only by `case.reopen` with a reason.
- **Closing a case:** an allowed outcome and a rationale of 20 or more characters, plus none of the following outstanding: unanswered questions, review notes not cleared, pending adjustments. "Substantiated" (and "corrected" without an approved adjustment) needs linked documentary evidence; a client message does not count. "Out of scope – referred" needs a recorded communication.
- **Firm rules from the packet:** nobody approves or signs off their own work. An adjustment with a tax effect over 1,000 needs a partner. Review notes are raised and cleared by a reviewer or partner. Staff without clearance cannot unmask SSNs, IP PINs or bank accounts, and every unmask is logged.
- **Stale sign-offs:** a sign-off stores a fingerprint of the case's links, adjustments, answers, reconciliation conclusions and the dispositions of the documents it cites. When the fingerprint changes after resolution, the sign-off shows as stale and readiness is blocked.
- **Readiness:** the firm's `required_steps`, computed from state. Levels: blocked → in progress → ready for reviewer → ready for partner → ready to present for client approval. Client approval and filing are never claimed.

## Source rendering

`ui/DocPage.tsx` takes `(document, page, focusEv)`. Today it renders the page's `printed_content` as a simulated document and highlights each extracted value where its text appears, placing them in the order of the synthetic `position` boxes. A real-PDF renderer needs only the same inputs: draw `ev.position` over the page image. No caller changes.

## Persistence and multi-user

The demo is a static site, so the log is saved to `localStorage` through `LocalStorageRepository`. It survives refresh, and Export/Import moves it between machines. `Repository` has three methods (`load`, `save`, `clear`). A server version (a `POST /events` append with optimistic `seq` and a `GET /events?since=`) would give shared, concurrent state. Because the log is append-only with sequence numbers, merging concurrent edits is a matter of ordering, not a schema change.

**Limitation (stated plainly):** with the static deployment, each browser has its own log. The role switcher simulates people; it is not authentication. Authorization runs in the client-side command layer, which is the same function a server would call.

## Tradeoffs

- **Static SPA instead of a backend.** It loads from a link with no infrastructure and no secrets, but there is no shared state across people (see above).
- **Rules over AI.** Every finding is reproducible and testable. The cost is that some rules are packet-specific (the 1099-K-in-books and call-note percentage rules read specific fields); each cites its sources and states its rule id.
- **Estimates from rates, not recomputation.** The packet forbids rerunning the engine. Effects are labelled estimates, and the one case with an engine what-if (HVAC) uses the engine's number.
- **Hash routing.** Every case, document value and line has a shareable URL on any static host.
- **No component library.** About 18 KB of CSS gives a dense, consistent workbench look with light and dark themes, without the weight of a framework.

## Investigation copilot (runtime AI)

### Why it exists

The rules layer finds and classifies 34 cases, but a reviewer still has to open the records, check what they actually show and decide what to do next. The copilot does that first pass for one case at a time. It retrieves the records, compares values and drafts an evidence-cited report with a next step and, where useful, a client question. The reviewer judges the report. It stays inside the brief's scope: no OCR, no re-extraction, no tax computation.

### Data flow

```
CaseView (browser) ── POST /api/copilot/investigate {caseId} ──▶ server/api.ts (Vite middleware in dev/preview, server/index.ts in production)
                                                                    │ loads the packet from disk, builds the same PacketIndex + cases
                                                                    ▼
                                                     src/copilot/agent.ts  runInvestigation()
                                ┌──────────── loop (≤10 model turns, ≤18 tool calls, 240 s deadline) ────────────┐
                                │ server/anthropic.ts → Claude Sonnet 5.5 (adaptive thinking, effort high,        │
                                │   strict tool schemas, prompt caching, server-side refusal fallback)            │
                                │ model picks tools → src/copilot/tools.ts executes (read-only, redacted, capped)  │
                                └──────── ends when the model calls submit_report with a schema-valid report ─────┘
                                                                    ▼
                                         src/copilot/verify.ts  deterministic verification → InvestigationRun
CopilotPanel ◀── run (report + validation + trace + usage) ──────────┘
   └─ reviewer: Accept / Edit & accept / Reject / "Send to client as my question" → events through workflow.authorize()
```

### Tools (read-only)

| Tool | Returns |
|---|---|
| `get_case` | The case question, both sides of each comparison, affected lines, close requirements and evidence ids. It does **not** return the rule layer's conclusion, so the model must read the records itself. |
| `get_evidence` | Up to 15 records by id: extracted values with provenance and confidence, documents, unextracted pages, questionnaire answers, messages, call notes, prior-year and agency records, household facts, return lines with rule text. |
| `search_evidence` | Lexical (IDF-weighted) search over 3,012 values, every printed page, 45 answers, 10 messages and the call note, with kind and document filters. |
| `get_document_context` | One printed page, the values extracted from it, unextracted pages, and the document's status per version. |
| `compare_return_versions` | Line values in 2024, v1, v2 and v3, with the trigger for each version that changed them. |
| `calculate_difference` | A − B, reading values from record ids. Returns a `calc-N` id the report must cite. A literal that contradicts the cited record is refused. |
| `submit_report` | Terminal tool. Its input is the report, validated with zod. A failing report is returned to the model with the errors and counted as a schema failure. |

Every tool reports the ids whose content it returned. Those form the run's **retrieved** set.

**Why there is no vector database or embeddings.** The narrative corpus is tiny: 45 answers, 10 messages, one call and 74 documents' page text. Most records have exact ids, which the case already points to. Lexical search the model can steer (it chooses the query terms and filters) found every expected record in the eval (retrieval recall 100%). Embeddings would add a second provider and an index lifecycle for no measured gain. Revisit if the corpus becomes thousands of free-text pages.

### Structured output and verification

The report schema (`src/copilot/schema.ts`) has:
- an enumerated `status`: confirmed discrepancy, likely issue, unresolved discrepancy, judgment required, insufficient evidence;
- facts, each with `evidence_ids` and typed `quantities`;
- hypotheses with how to test them, missing information, next steps, an optional client question draft, resolution criteria, and `requires_human_review: true`.

`verify.ts` never edits a report. Every problem becomes an issue, and the run is marked **unverified**. The checks:
- every cited id exists in the packet (or is a `calc-N` from this run) **and** was retrieved in this run;
- every quantity equals the value of the record it cites (any version of a line, the 2024 value, or text printed in the cited page, answer or line note), or one side or the result of the cited calculation;
- every amount stated in prose appears in something retrieved or computed in this run;
- "confirmed" needs supporting facts and must not contradict an informational or out-of-scope classification.

### Deterministic vs probabilistic

| Deterministic (code) | Probabilistic (model) |
|---|---|
| Case detection and classification, arithmetic, tax-effect estimates, return values, evidence existence and provenance, citation and amount verification, permissions, approval thresholds, state transitions, audit log | Which records to read, how to describe what they show, which hypotheses to raise, what is missing, the next step, the wording of a client question |

### Human boundaries (enforced in `workflow.authorize`)

- A run is recorded as a `copilot.run` event. The reviewer's decision is a `copilot.review` event: accepted, edited (with the edited text) or rejected (with a reason).
- **An unverified report cannot be accepted.** It can only be rejected.
- Copilot events do not change status, adjustments, links or sign-offs, and are excluded from the sign-off fingerprint. Accepting a suggestion satisfies no close rule (tested: a "substantiated" decision still needs documentary evidence).
- Draft client questions are never sent automatically. "Send to client as my question" dispatches a normal `case.question` by the reviewer, tagged with the run id.
- Clients and the administrator cannot record copilot decisions.

### Privacy

- Only one case's retrieved records go to the model, never the packet. Tool output is redacted first: SSNs, the refund account, the IBAN and IP PINs are masked to their last four characters, enough to see a transposition such as 3309 vs 3390. Each tool result is capped at 12,000 characters.
- The server logs only run metadata (case, outcome, turns, tool calls, tokens, latency), never prompts, evidence or report text.
- In the browser, the full report is cached in localStorage for that browser only; the event log holds a summary (status, cited ids, first next step, usage).
- Prompts and responses are processed by Anthropic under the API account's data-retention terms. Check the account's settings before using real client data.
- The API key lives only in the server environment (`.env`, gitignored). The build was checked to contain neither the key nor the SDK.

### Limits

- The endpoint has no authentication: localhost demo only.
- One investigation per case at a time, and two concurrently.
- The loop is a manual tool-calling loop, not a framework. A single bounded investigation needs no graph, multi-agent or resumable state, and the manual loop keeps the step budget, trace and test double explicit.
