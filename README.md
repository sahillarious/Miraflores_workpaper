# Miraflores workpaper — Okafor-Lindqvist 2025

A web-native tax workpaper for one complex household's return. Reviewers work from a prioritized queue of cases, trace every number to the exact field on a source page, record decisions with evidence, and see what still blocks the return. The case packet (`okafor_lindqvist_2025_packet.json`) is loaded exactly as delivered.

> All data is invented (see the packet README). This is a review and evidence tool, not a tax engine. Return figures are the engine's snapshots; estimates of tax effects use the packet's `tax_effect_rates` and are labelled as estimates.

- **Core idea, data model and errors found:** [PRODUCT_WRITEUP.md](PRODUCT_WRITEUP.md)
- **Architecture:** [ARCHITECTURE.md](ARCHITECTURE.md) · **Validation:** [VALIDATION_REPORT.md](VALIDATION_REPORT.md) · **Demo path:** [DEMO_SCRIPT.md](DEMO_SCRIPT.md) · **Plan and status:** [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)

## What works

- **Overview:** v3 federal and California figures with deltas (balance due vs refund labelled correctly), readiness, P1 issues, your assignments, deadlines.
- **Review queue:** 34 cases from 13 engine diagnostics and 21 workpaper checks. Filter by status, priority, area, origin, jurisdiction and owner; search by text, code, `D##`, `ev-####` or line; sort by priority, tax effect, recency or status; bulk assign or move with undo.
- **Investigation workspace (three panes):** source evidence on a simulated page with the field highlighted, the reconciliation inspector (A vs B, difference only when comparable, expected relationship, what the evidence shows, recorded conclusion), and decision and workflow (status, owner, adjustments with tax effect, questions to the client or colleagues, review notes that block filing, decision → approval, reopen, history with undo).
- **Documents:** each document's disposition (bulk, with undo), where each extracted value landed or why it didn't, unread pages, low-confidence values, and the cases that cite it.
- **Return and versions:** v1/v2/v3 compared with 2024, change log by form, documents added or superseded, diagnostics raised or cleared, engine what-ifs, and an explorer for all 627 lines (Form 8949's 295 lots grouped by box).
- **Line trace:** for any line, its rule, input tree, sources, value per version and in 2024, the lines that use it, related cases and overlay adjustments.
- **Independent checks:** 16 recomputations that don't trust the engine; 4 disagree with the return.
- **Readiness:** the firm's required steps computed from real state. It never claims the return was filed.
- **Client portal:** a client role sees only the questions sent to them; their answers are recorded as evidence.
- **Investigation copilot (AI, optional):** on any case, a bounded tool-calling agent (Claude Sonnet 5.5) retrieves the case's records with read-only tools, compares values with deterministic arithmetic, and submits a structured report: facts, hypotheses, missing information, next steps and an optional draft client question. Every cited id and every amount is checked against the packet before the report is shown. Reports are labelled as suggestions; a reviewer accepts, edits or rejects them, and nothing changes the case on its own. Details: ARCHITECTURE.md → Investigation copilot; results: VALIDATION_REPORT.md.
- **Roles (demo switcher):** preparer, preparer without clearance (SSNs masked, unmasking refused), reviewer, partner, administrator, client. Permissions are enforced in the command layer, not just hidden in the UI.

## Identifier masking (display only)

SSNs, IBANs, IP PINs and the refund bank account and routing numbers are masked everywhere they are displayed, for every role, keeping the last four characters (`***-**-3390`; an IP PIN after the words "IP PIN" is fully masked). Masking covers the simulated document pages, evidence and value cards, reference chips, case text, history and activity, the copilot's report and trace, the prior-year JSON views and the client portal. One function does it: the same redactor that masks tool output before it reaches the AI model (`src/copilot/redact.ts`, used through `src/ui/mask.ts`).

Staff with clearance can reveal a document page's identifiers ("Show identifiers"), or a household value on Client records. Both use the existing `sensitive.view` command: the reveal is logged (Activity → sensitive data views), refused for staff without clearance, and never offered to the client.

**This is display masking, not data protection.** The identifiers are still present, unmasked, in the packet JSON that the browser downloads (`data/okafor_lindqvist_2025_packet.json`) and in anything typed into the event log in `localStorage`; anyone with the browser's developer tools can read both. The exported audit log is written verbatim (it is the record), so an identifier someone types into a note would appear there. EINs and preparer numbers (business identifiers) are not masked.

## Run it

Requires Node 20.12+ (developed on Node 24).

```bash
npm install
cp .env.example .env # optional: add ANTHROPIC_API_KEY to enable the copilot
npm run dev          # http://localhost:5173 (app + copilot API)
```

Production:

```bash
npm run build        # typecheck + build to dist/
npm start            # http://localhost:8787 (serves dist/ and the copilot API; reads .env)
```

Without a key everything except the copilot works, and the copilot panel says it is not configured. `.env` is server-side only: no variable is exposed to the browser bundle (none uses the `VITE_` prefix), and `.env` is gitignored. Optional settings: `COPILOT_MODEL` (default `claude-sonnet-5-5`) and `COPILOT_EFFORT` (default `high`).

## Tests

```bash
npm test             # 54 tests: domain rules + copilot tools, loop, verifier, permissions, API (no model calls)
npm run build && npx vite preview --port 4173   # in one terminal
npm run test:e2e     # 24-step browser journey (uses local Chrome or Edge via playwright-core)
npm run eval:copilot -- --dry       # check the copilot eval definitions (free)
npm run eval:copilot -- --repeat 2  # live eval: real model calls, costs money (about $0.07 per run)
npx tsx eval/rescore.ts eval/results/<file>.json   # re-verify saved runs with the current verifier (free)
```

`node scripts/e2e.mjs <dir>` also saves screenshots of each step.

## Deploy

**Not deployed.** `dist/` includes the original packet (`data/okafor_lindqvist_2025_packet.json`) because the workpaper runs in the browser. The packet data is invented, but it should not be put on a public URL as-is: public hosting needs a sanitized packet, which is not built. Without the copilot, `dist/` works on any static host; routing is hash-based. With the copilot, run `npm start` on a server that holds the key. The copilot endpoint has no authentication, so keep it on localhost or behind the host's access control.

## Saving

Every change is an event in an append-only log, saved to the browser's `localStorage` (key `mf-workpaper:CL-20417:1.0`). Work survives a refresh in that browser. Activity → **Export log** / **Import log** moves a session between machines; **Reset demo** clears it. The storage sits behind a three-method `Repository` interface, so a shared server store can replace it without UI changes (see ARCHITECTURE.md).

## How AI is used

**During development:** the app was built with Claude Code (Anthropic's coding agent), directed and reviewed by me. The agent read the brief and the packet, wrote Python scripts to profile the data, and hunted for the planted errors by comparing extractions with printed pages, documents with each other, and the return with agency records. It then designed and wrote the code, tests and docs, and drove the app in a headless browser to check the journeys and layout.

**At runtime:** the 34 findings, the independent checks, the workflow, permissions and readiness are deterministic code, with no model involved. The only runtime model use is the optional investigation copilot. It calls Claude Sonnet 5.5 from the server with read-only tools. Its output is validated and shown as a suggestion that a person must accept or reject.
