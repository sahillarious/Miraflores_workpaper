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
cp .env.example .env # optional: set ANTHROPIC_API_KEY and COPILOT_ACCESS_CODE to enable the copilot
npm run dev          # http://localhost:5173 (app + copilot API)
```

Production:

```bash
npm run build        # typecheck + build to dist/
npm start            # http://localhost:8787 (serves dist/ and the copilot API; reads .env)
```

Without a key or an access code everything except the copilot works, and the copilot says it is off and why. `.env` is server-side only: no variable is exposed to the browser bundle (none uses the `VITE_` prefix), and `.env` is gitignored.

## AI copilot: access code, limits and cache

| Setting (server env) | Default | What it does |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Without it the copilot is off. |
| `COPILOT_ACCESS_CODE` | none | Shared demo code. **Without it the copilot is off**, even with a key. Every investigate request must send it in the `x-access-code` header; it is compared with `crypto.timingSafeEqual` on SHA-256 digests. |
| `COPILOT_DAILY_CAP` | `60` | Investigations per UTC day (resets at 00:00 UTC). |
| `COPILOT_TRUST_PROXY` | off | Set to `1` behind exactly one reverse proxy (e.g. Render): the client IP is then the right-most `X-Forwarded-For` entry, the one the proxy added. |
| `COPILOT_MODEL` / `COPILOT_EFFORT` | `claude-sonnet-5-5` / `high` | Model and effort. |

**Spend.** One RSU investigation on 2026-10-21 cost about **$0.09** at list prices (40 s, 5 turns, 13 tool calls). The default cap of 60 investigations a day is therefore about **$5.40 a day** at that rate; set a matching spend limit on the API key. Cases differ, so treat this as an estimate.

**Limits.** 3 investigations a minute per IP; 10 wrong access codes a minute per IP (then 429; wrong codes do not use the daily budget); at most 2 investigations running at once; concurrent requests for the same report share one run. A run counts towards the daily cap only if the model was actually called, including a call that failed. After the cap, requests get "Demo limit reached for today" and the rest of the workpaper keeps working. **All of these limits are kept in memory: they hold for a single server process and reset when it restarts.**

**What the access code is not.** It is a shared gate for paid AI calls, not user authentication. The role switcher is a simulation, not a login. The access code does not protect the packet data or the workpaper: both are served to anyone who can open the page. In the browser the code is kept in `sessionStorage` only, and a rejected code is cleared.

**Cache.** A report is cached in the browser's `localStorage` under a key made of the case id, the packet's SHA-256, a hash of the case definition, a hash of the copilot's prompt, tools and verifier version, and the model. Only verified reports are cached; failed, unverified, unauthorized and rate-limited results never are. The first verified report per key is reused (report wording varies between runs), shown as "cached · made <time>"; a new run shows "fresh". "Run again" replaces the cached report. If the key changes (new packet, case definition, copilot code or model), the old report is shown as "made before the code or packet changed" and a new one is requested. The copilot reads only the packet, so workpaper changes it cannot see never make a report stale.

**Auto-investigate.** Opening a case starts an investigation automatically only for staff, with the copilot on, the access code entered in this browser session, and no cached report for the current key, at most once per key per session.

## Tests

```bash
npm test             # 93 tests: domain rules, guided flow, masking, copilot tools, loop, verifier, permissions, API security and cache (no model calls)
npm run build && npx vite preview --port 4173   # in one terminal
npm run test:e2e     # 24-step browser journey (uses local Chrome or Edge via playwright-core)
npm run test:e2e:flow              # 18 journeys: guided flow, help panel, masking, AI summary/cache/link bridge (no model calls)
WIDTH=390 npm run test:e2e:flow    # the same at phone width
npm run eval:copilot -- --dry       # check the copilot eval definitions (free)
npm run eval:copilot -- --repeat 2  # live eval: real model calls, costs money (about $0.07 per run)
npx tsx eval/rescore.ts eval/results/<file>.json   # re-verify saved runs with the current verifier (free)
```

`node scripts/e2e.mjs <dir>` also saves screenshots of each step.

## Deploy

**Not deployed.** `dist/` includes the original packet (`data/okafor_lindqvist_2025_packet.json`) because the workpaper runs in the browser. The packet data is invented, but it should not be put on a public URL as-is: public hosting needs a sanitized packet, which is not built. Without the copilot, `dist/` works on any static host; routing is hash-based. With the copilot, run `npm start` on a server that holds the key and an access code (see "AI copilot: access code, limits and cache"). For Render, see "Deploy to Render" below.

## Deploy to Render

The app is one Node web service: `npm start` serves the built app, the packet and the copilot API on `PORT`, listening on all interfaces. [render.yaml](render.yaml) holds these settings; entering them by hand works the same.

1. Push the repo to GitHub, then in Render choose **New → Blueprint** and pick the repo (or **New → Web Service** and enter the values below).
2. **Runtime** Node · **Build command** `npm ci --include=dev && npm run build` · **Start command** `npm start` · **Health check path** `/healthz`.
3. **Environment** (names only; values are entered in the dashboard, never in a file):
   - `ANTHROPIC_API_KEY` — secret. Without it the copilot is off.
   - `COPILOT_ACCESS_CODE` — secret. A passphrase you share with people who may use the AI. Without it the copilot is off.
   - `COPILOT_TRUST_PROXY` = `1` — Render is one proxy in front of the app.
   - `COPILOT_DAILY_CAP` = `60` — optional, investigations per UTC day.
   - `NODE_VERSION` = `22` — optional; Node 20.12 or newer is required.
4. Deploy. The free plan sleeps when idle, so the first request after a pause is slow, and the rate limits and the daily cap are in memory and **reset when the service restarts**. Set a spend limit on the Anthropic key as the real backstop.

Post-deploy checklist:
- `/healthz` shows `ok`; the home page loads and Overview shows the figures.
- `/api/copilot/status` says `"configured": true` (or tells you which variable is missing).
- A case's step 1 asks for the access code; a wrong code is refused with a friendly message; the right one produces a summary (about 9 cents, once per case, then cached in the browser).
- `/robots.txt` disallows everything and the page carries a noindex tag.
- The packet is public. It is served to anyone who opens the site (`/data/okafor_lindqvist_2025_packet.json`), identifiers included, although the data is invented. Masking in the screens is display-only.

## Saving

Every change is an event in an append-only log, saved to the browser's `localStorage` (key `mf-workpaper:CL-20417:1.0`). Work survives a refresh in that browser. Activity → **Export log** / **Import log** moves a session between machines; **Reset demo** clears it. The storage sits behind a three-method `Repository` interface, so a shared server store can replace it without UI changes (see ARCHITECTURE.md).

## How AI is used

**During development:** the app was built with Claude Code (Anthropic's coding agent), directed and reviewed by me. The agent read the brief and the packet, wrote Python scripts to profile the data, and hunted for the planted errors by comparing extractions with printed pages, documents with each other, and the return with agency records. It then designed and wrote the code, tests and docs, and drove the app in a headless browser to check the journeys and layout.

**At runtime:** the 34 findings, the independent checks, the workflow, permissions and readiness are deterministic code, with no model involved. The only runtime model use is the optional investigation copilot. It calls Claude Sonnet 5.5 from the server with read-only tools. Its output is validated and shown as a suggestion that a person must accept or reject.
