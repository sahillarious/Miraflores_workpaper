# Miraflores workpaper — Okafor-Lindqvist 2025

A web-native tax workpaper for one complex household's return. Reviewers work from a prioritized queue of cases, trace every number to the exact field on a source page, record decisions with evidence, and see what still blocks the return. The case packet (`okafor_lindqvist_2025_packet.json`) is loaded exactly as delivered.

> All data is invented (see the packet README). This is a review and evidence tool, not a tax engine. Return figures are the engine's snapshots; estimates of tax effects use the packet's `tax_effect_rates` and are labelled as estimates.

- **Core idea, data model and what is not built:** [PRODUCT_WRITEUP.md](PRODUCT_WRITEUP.md) · **The 18 errors found:** [ERRORS_FOUND.md](ERRORS_FOUND.md)
- **Architecture:** [ARCHITECTURE.md](ARCHITECTURE.md) · **Validation:** [VALIDATION_REPORT.md](VALIDATION_REPORT.md) · **Demo path:** [DEMO_SCRIPT.md](DEMO_SCRIPT.md) · **Plan and status:** [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)

## Live demo

**https://miraflores-workpaper-up2n.onrender.com**

- The service runs on a free plan, so the **first load after a pause can take about a minute**. Reload if the page is slow to appear.
- The workpaper needs nothing else. The optional AI features need an **access code**, which the author shares separately. Without it, everything else works and the AI says it is off.
- Your work is saved in your own browser only. It is not shared with anyone else and is not sent to a server. "Activity > Reset demo" starts over.

## What works

- **Overview:** a "Your next case" card for the current role, the v3 federal and California figures with deltas against 2024 (balance due vs refund labelled correctly), the readiness level and its blockers, the packet's deadlines, and the latest activity.
- **Review queue:** 34 cases from 13 engine diagnostics and 21 workpaper checks. Filter by status, priority, area, origin, jurisdiction and owner; search by text, code, `D##`, `ev-####` or line; sort by priority, tax effect, recency or status; bulk assign or move with undo.
- **Guided case flow (the default page for a case):** four steps, **What's wrong → Check the proof → Fix it → Send** (for a reviewer or partner whose approval is pending, step 4 is **Review and approve**). A checklist beside the steps shows what is done, waiting or stale, and "Need help?" opens a panel that offers only the actions the current role may take. It is a view over the same workflow and rules as the full view.
- **Full details ("Show full details" on any case):** the original three-pane workspace: source evidence on a simulated page with the field highlighted, the reconciliation inspector (A vs B, difference only when comparable, expected relationship, what the evidence shows, recorded conclusion), and decision and workflow (status, owner, adjustments with tax effect, questions, **notes** (the guided steps have no notes box), review notes that block filing, decision → approval, reopen, history with undo).
- **Documents:** each document's disposition (bulk, with undo), where each extracted value landed or why it didn't, unread pages, low-confidence values, and the cases that cite it.
- **Return and versions:** v1/v2/v3 compared with 2024, change log by form, documents added or superseded, diagnostics raised or cleared, engine what-ifs, and an explorer for all 627 lines (Form 8949's 295 lots grouped by box).
- **Line trace:** for any line, its rule, input tree, sources, value per version and in 2024, the lines that use it, related cases and overlay adjustments.
- **Independent checks:** 16 recomputations that don't trust the engine; 4 disagree with the return.
- **Readiness:** a checklist of the steps a return needs. Most are worked out from the cases, documents and sign-offs in this workpaper. Three are shown as **"Not tracked in this demo"** because the app does not really derive them (engagement letter signed, carryovers agreed, client approval and e-file) and they never block readiness. It never claims the return was filed. The top bar shows **Blocked** while a blocker-severity case is open; by my reading of the code it changes to **In progress** once the dependent SSN case is submitted for approval or resolved (the author observed the change after resolving it).
- **Related returns:** the household's three related returns (Ada's own 1040, the S corporation's 1120-S, the real estate fund's 1065), what this packet holds of each (only K-1s for two, nothing for Ada), the return lines those K-1s feed, and the cases that cite them. K-1 document pages link back to it.
- **Client portal:** a client role sees only the questions sent to them; their answers are recorded as evidence. The separation is in the interface; see "Known weaknesses and tradeoffs".
- **Activity:** a log of every action (who, what, when) with undo (your own changes; a partner can undo anyone's), the sensitive-data view log, and the packet's own season timeline (a scripted replay, not actions taken here). An unread-changes indicator exists in the code but did not show up in the author's test, so it is not claimed (see "Known weaknesses and tradeoffs").
- **Investigation copilot (AI, optional):** on any case, a bounded tool-calling agent (Claude Sonnet 5.5) retrieves the case's records with read-only tools, compares values with deterministic arithmetic, and submits a structured report: facts, hypotheses, missing information, next steps and an optional draft client question. Every cited id and every amount is checked against the packet before the report is shown. Reports are labelled as suggestions; a reviewer accepts, edits or rejects them, and nothing changes the case on its own. The author has run it once on the deployed site (a three-line summary appeared); there is no broader testing in the deployed environment. Details: ARCHITECTURE.md → Investigation copilot; results: VALIDATION_REPORT.md.
- **Roles (demo switcher):** preparer, preparer without clearance (SSNs masked, unmasking refused), reviewer, partner, administrator, client. Permissions are enforced in the command layer, not just hidden in the buttons, but that layer runs in the browser (see "Known weaknesses and tradeoffs"). A reviewer can open a case that needs a partner and press Approve; the app then refuses with a "needs partner approval" warning. The banner "This case is waiting for your approval" (Steps 1-3) appears only when the real approve command would succeed for that person.

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
npm test             # 101 tests: domain rules, guided flow, readiness, masking, copilot tools, loop, verifier, permissions, API security, cache and the static server (no model calls)
npm run build && npx vite preview --port 4173   # in one terminal
npm run test:e2e     # 24-step browser journey (uses local Chrome or Edge via playwright-core)
npm run test:e2e:flow              # 22 journeys: guided flow, help panel, masking, related returns, reviewer banner, readiness, AI summary/cache/link bridge (no model calls)
WIDTH=390 npm run test:e2e:flow    # the same at phone width
npm run eval:copilot -- --dry       # check the copilot eval definitions (free)
npm run eval:copilot -- --repeat 2  # live eval: real model calls, costs money (about $0.07 per run)
npx tsx eval/rescore.ts eval/results/<file>.json   # re-verify saved runs with the current verifier (free)
```

`node scripts/e2e.mjs <dir>` also saves screenshots of each step.

## Deploy

**Deployed on Render** (see "Live demo"). `dist/` includes the original packet (`data/okafor_lindqvist_2025_packet.json`) because the workpaper runs in the browser, so the packet is public, identifiers included. The data is invented, but real client data should never be hosted this way: that would need a sanitized packet, which is not built. Without the copilot, `dist/` works on any static host; routing is hash-based. With the copilot, run `npm start` on a server that holds the key and an access code (see "AI copilot: access code, limits and cache"). For Render, see "Deploy to Render" below.

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

## Known weaknesses and tradeoffs

Stated plainly, so nothing here is a surprise:

- **Work is not shared between browsers.** Each browser keeps its own history in `localStorage`. There is no live sharing and no server copy of the workpaper.
- **The unread-changes indicator did not appear in the author's test.** An unread count on Activity and a marker on a case exist in the code, but they only count changes made by *another* role after that role has pressed Activity → "Mark all seen" once in the same browser. Without that baseline nothing shows, and the author saw nothing after switching roles and reloading. Treat it as not demonstrated.
- **`authorize()` trusts the effects sent with a command.** A tax effect typed into an adjustment is checked against the partner threshold, not recomputed.
- **The manual adjustment form ignores the California-source rule.** An adjustment entered by hand for a line the rule splits by state gets the wrong California effect (for example, N3 by hand gives California −649 instead of −1,222). The suggested adjustments are correct.
- **`needsPartner` counts rejected adjustments**, so a rejected large adjustment can still make a case need a partner.
- **Client-portal separation is UI-only.** The client role is not shown staff screens, but the rules run in the browser and the data is in the same browser.
- **Roles are enforced in the browser.** The role switcher is not authentication. Someone with developer tools can bypass it.
- **The limiter, daily cap and report cache are in memory** (the cache is in each browser) and reset on a restart. On the free Render plan the service sleeps, which resets the limiter and the cap. Set a spend limit on the Anthropic key.
- **The access code is not user authentication.** It gates paid AI calls only; it does not protect the packet or the workpaper.
- **Masking is display-only.** Identifiers are still in the packet file and in the browser's saved log.
- **The packet is served publicly** to anyone who opens the site.
- **The exported audit log is unmasked.** It is written verbatim as the record.
- **Some pages scroll sideways at phone width** (step 2 and full details of three cases, and one Prior-year page).
- **The AI copilot was run on the deployed site once** by the author (a three-line summary appeared). There is no broader testing in the deployed environment; the live evaluation (18 runs) was done locally in October.
- **No accessibility audit** has been done.

## Saving

Every change is an event in an append-only log, saved to the browser's `localStorage` (key `mf-workpaper:CL-20417:1.0`). Work survives a refresh in that browser. **Each browser keeps its own history: two people, or a normal and a private window, do not see each other's work** (tested by the author). Activity → **Export log** / **Import log** moves a session between machines by hand; **Reset demo** clears it. The storage sits behind a three-method `Repository` interface, so a shared server store can replace it without UI changes (see ARCHITECTURE.md).

## How AI is used

**During development:** the app was built with Claude Code (Anthropic's coding agent), directed and reviewed by me. The agent read the brief and the packet, wrote Python scripts to profile the data, and hunted for the planted errors by comparing extractions with printed pages, documents with each other, and the return with agency records. It then designed and wrote the code, tests and docs, and drove the app in a headless browser to check the journeys and layout.

**At runtime:** the 34 findings, the independent checks, the workflow, permissions and readiness are deterministic code, with no model involved. The only runtime model use is the optional investigation copilot. It calls Claude Sonnet 5.5 from the server with read-only tools. Its output is validated and shown as a suggestion that a person must accept or reject.
