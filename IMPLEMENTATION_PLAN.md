# Implementation plan and status

## Repository findings

- `D:\Miraflores` is a separate, earlier assignment: a Python/Streamlit "tax-season tracker assistant". It shares nothing with this case study, so it was left untouched.
- `new_assmt/` held only the brief (PDF) and `okafor_lindqvist_2025_packet.json` (1.9 MB). There was no frontend, backend, tests or deployment to extend, so this is a new app in `new_assmt/`.
- Packet profile, from scripts before any code: 74 documents (4 not extracted, 2 partial), 3,012 values (2 below 0.9 confidence), 3 versions (625/625/627 lines), 13 diagnostic codes (11 in v3), 45 questionnaire answers, 10 messages, 1 call, 29 timeline events, prior-year and agency records, 5 engine what-ifs.

## Architecture decisions

| Decision | Why |
|---|---|
| Vite + React + TypeScript static SPA | The brief needs the app to run from a link. A static site has no infrastructure and loads the packet as delivered. |
| Pure `domain/` layer, tested in Node | Rules and workflow are testable on the real packet without a browser. |
| Append-only event log + projection | One mechanism for history, undo, "since I last looked", stale sign-offs and the audit trail. No event-sourcing framework needed. |
| localStorage behind a `Repository` interface | The smallest reliable persistence for a static deployment; replaceable by a server store. |
| Deterministic checks, no LLM at runtime | Reproducible findings; nothing confident and unverified enters the workpaper. |
| Hash routing | Deep links to cases, values and lines on any static host. |

## Milestones

| # | Milestone | Status |
|---|---|---|
| 1 | Packet profiling, schema mapping, index, references, validation tests | Done |
| 2 | Overview, review queue, investigation workspace, document viewer, reconciliation inspector, line trace | Done |
| 3 | Event log, state machine, notes, questions and answers, adjustments, decisions and approval, dispositions, stale sign-offs, persistence, undo, bulk actions | Done |
| 4 | Version comparison, change log, what-ifs, readiness, independent checks | Done |
| 5 | Breadth (21 workpaper rules), client portal, masking and view log, assets, prior-year browser, narrow layout, dark mode | Done |
| 6 | Build, 26 domain tests, 23-step browser journey, docs | Done |

## Risks and tradeoffs

- **Shared state:** not available in the static demo (see ARCHITECTURE.md → Persistence).
- **Rule overfitting:** a few rules are shaped by this packet. In production, each should be a configurable firm standard.
- **Tax-effect estimates:** linear rates can mislead across thresholds; this is stated wherever an estimate appears.

## Next improvements

1. A server `Repository` (append endpoint with sequence numbers) for real multi-user use and server-side authorization.
2. Apply approved adjustments to a "workpaper view" of the return with the deltas propagated through the line dependency graph, still labelled as estimates.
3. Notice-response packages assembled from linked cases (the Letter 566 items map to two existing cases).
4. A next-year roll-forward: carryovers, basis, open items and the minimum tax credit into a 2026 file.
5. Time against budget per area (the packet has budget hours) using the actors and timestamps already in the event log.

## Phase 2: investigation copilot (2026-10-19)

**Before changing anything, I checked the current state.** The app was a static SPA with no server, so a model key could not be kept off the client. Workflow rules (segregation of duties, the partner threshold over 1,000, documentary evidence for "substantiated", undo) live in `workflow.authorize`. 26 domain tests and a 23-step browser journey were green.

**Minimal plan, as built:**
1. Add a small server layer: Vite middleware in dev and preview, and `npm start` in production, so the key stays server-side. This was the only architectural change.
2. Read-only tools over the existing `PacketIndex`, reusing `resolveRef`, `unreadPages` and `line`, with redaction and output caps.
3. A bounded manual tool-calling loop with a terminal `submit_report` tool, a zod schema, and a provider interface so tests can use a scripted double.
4. A deterministic verifier that checks citations exist, were retrieved, and that amounts match.
5. Two new event types, `copilot.run` and `copilot.review`, through the existing `authorize`, with no effect on status, adjustments or sign-offs.
6. A panel in the existing Investigation pane.
7. An eval harness, a re-scorer and docs.

**Status:** done. See VALIDATION_REPORT.md for the actual test, browser and eval results, including the failures.

**Remaining risks and next steps:**
- Re-run the live eval after the verifier and household fixes; the 15/18 figure is a re-score.
- Add an entailment check for claim text (for example, a second model as judge, validated against a hand-labelled set). Today's checks cover ids and amounts only.
- Move copilot authorization and the workpaper event log to the server before any multi-user use, and add authentication to the endpoint.
- Build a sanitized packet before any public deployment.
- Calibrate statuses: one run labelled a counted-once duplicate as `confirmed_discrepancy`. A prompt example or a rule-layer cross-check could address it; measure before changing.
