# Demo script: a 12-minute click path

This is a click path, not words to read out. Each section has a time budget, the role to select, what to click, and what you should see. The route was walked through on the deployed site (https://miraflores-workpaper-up2n.onrender.com) before this was written; the quoted on-screen text is what appeared.

Roles are chosen with the **Demo role** box at the top right ("Act as"). Names: **Priya Raman** (preparer), **Daniel Ortiz** (reviewer), **Helen Strand** (partner), **Marcus Bell** (preparer without sensitive-data clearance), **Ngozi Okafor** (client).

## Before recording (checklist)

- [ ] **Wake the service.** Open https://miraflores-workpaper-up2n.onrender.com/healthz a few minutes before. The free plan sleeps, and the first load can take about a minute. It should show `ok`.
- [ ] **Check the access code works,** by typing it on a case's Step 1 box once (see section 7). A wrong code shows "That access code was not accepted" and is not kept. The code is kept for the browser tab only.
- [ ] **Check the AI summary is cached** for the case you will use in section 7: open the case; Step 1 should show the three AI lines marked **cached**. If not, run it once now (about 40 seconds, about 9 cents; the daily cap is 60). "Reset demo" does **not** remove cached AI reports or the code.
- [ ] **Zoom:** browser at 110 to 125 percent, window about 1440 px wide, one tab, bookmarks bar hidden.
- [ ] **Keep keys off screen:** never open `.env`, the Render dashboard's environment values or the Anthropic console while recording. Type the access code only when the field is the only thing in frame, or have the tab already unlocked.
- [ ] **Start state last:** do **Activity > Reset demo** (confirm the dialog) right before you start, then select **Priya Raman, preparer**. Everything below assumes a clean start. Work is saved in this browser only.

## Starting state

After the reset: top bar shows **Blocked · 34 open**. Role: Priya Raman, preparer. Nothing has been proposed, approved or signed off.

## 1. Home and the unverified banner (0:00 to 1:30)

**Role:** Priya.

1. Open the site (Overview). **See:** "Your next case: 1 of 34", a **Blocker**, "Theo Lindqvist-Okafor: SSN in the organizer differs from the 2024 return", with the plain sentence "…(ending 3309) does not match last year's return (ending 3390), so the e-file would be rejected." There is no dollar estimate, and the card says so.
2. Scroll to **Return figures**. **See:** a yellow banner "**Unverified.** These are the tax software's v3 snapshot figures … not checked numbers. Open cases may change them." Say: the figures are the engine's snapshots, never the app's own.
3. Click **Review queue**. **See:** 34 cases, from 13 of the tax software's own flags and 21 checks this app runs. Point at the Origin chips and the priority labels.

## 2. The RSU case with role switches (1:30 to 5:30)

1. **Role: Priya.** Review queue, search `RSU`, open "Corvane RSU sales reported with $0 basis; supplemental statement gives 47,620 of basis". **See:** Step 1 of 4 ("What's wrong"): "3 company stock (RSU) sales were reported with zero cost, but the company's own statement gives 47,620 of cost…", an estimated effect (Fed −15,536, CA −2,765, marked **est.**), and the source page (D11, page 2) with the values highlighted. A box asks for the AI access code; ignore it for now. Click **Yes, that's right**.
2. **Step 2, "Check the proof":** the two sides side by side. Click **The proof checks out**.
3. **Step 3, "Fix it":** click **Propose all**. **See:** three adjustments, one per lot (gain 19,240 → 140; 18,480 → −620; 15,300 → 5,880), and in the checklist "Adjustments approved: Waiting, 3 waiting for partner approval".
4. **Role: Helen Strand.** Same case, Step 3. Click **Approve all**. **See:** "3 approved".
5. **Role: Priya.** Step 4 ("Send"): type a reason of at least 20 characters, for example "D11 gives the basis for all three lots; the partner approved the adjustments." The box says "Nothing is missing. You can submit." Click **Submit for approval**. **See:** "Decision submitted for approval"; the checklist shows "Waiting for partner approval". Say: Priya cannot approve her own work.
6. **Role: Daniel Ortiz.** Open the case from the Review queue. **See:** it opens on Step 4, now called **Review and approve**. Click **Approve & sign off**. **See it refused:** "An adjustment over 1,000 needs partner sign-off." Say: a reviewer sees the button, and the rule (over 1,000 needs a partner) refuses it. Also open Step 1 as Daniel: there is **no** "waiting for your approval" banner, because the real approve would fail for him.
7. **Role: Helen Strand.** Open the case, Step 1 or 2. **See:** a blue banner "**This case is waiting for your approval.** Go to Step 4". Click the link, then **Approve & sign off**. **See:** "Approved and resolved", the status **Resolved**, and the checklist "Approved and signed off".

The top bar still says **Blocked** (the Theo SSN blocker is open). By my reading of the code it changes to **In progress** once that case is submitted for approval or resolved.

## 3. One confident mistake (5:30 to 6:45)

**Role:** any.

1. Open **Documents**, then **D62** (Little Sprouts Learning Center statement), then click the value **ev-1045** (or open `#/doc/D62?ev=ev-1045`).
2. **See:** the page prints "Tax ID **74-3829156**". The extracted value is **74-3829516** at confidence **0.97**, marked "**not found in printed text**". Say: the tax software was confident and wrong; every extracted value was checked against its printed page, and this was one of two mismatches.
3. Backup if time allows: Meridian case, page 32 (`doc:D31#page32`): lot M18, proceeds 250.00, basis 310.00, a page nobody extracted, which explains the 250 gap.

## 4. Related returns, evidence linking and notes (6:45 to 8:00)

**Role:** Priya.

1. Click **Related returns** in the left menu. **See:** three cards: Ada's own 1040 (nothing in this packet), the S corporation's 1120-S (K-1s **D39, D40**, return lines they feed, and a case), and Ridgeline's 1065 (**D37, D38**). Click **D39**. **See:** "Part of a related return: Lindqvist Family Woodworks, Inc., prepared by Willamette CPA Group (not this firm)", which links back.
2. Review queue, search `Meridian`, open "Meridian 1099-B summary proceeds 71,965 vs extracted lots 71,715", then **Show full details** (the link at the top of the case). **Notes are added here, not in the guided steps: the guided steps have no notes box.**
3. In the **left** pane (the evidence), find **Link evidence to the decision** and type `doc:D31#page32` in "Reference to link", a reason such as "Unread page with lot M18 (proceeds 250)", click **Link**. **See:** the toast "Linked doc:D31#page32".
4. In the **Notes** box in the **right** pane, type "Page 32 lot M18 explains the 250." and click **Add**. Then **← Back to guided steps**.

## 5. Masking with Marcus and a logged reveal by Priya (8:00 to 9:00)

1. **Role: Marcus Bell** (no clearance). Open **Client records**. **See:** SSNs shown as `***-**-2287`, the IP PIN as `••2915`, each with a greyed-out "masked" control. Say: staff without clearance cannot reveal them.
2. **Role: Priya Raman.** Client records, click **reveal** next to Ngozi's SSN. **See:** the full number and a "hide" control.
3. Open **Activity**. **See:** "Sensitive-data view log (1): Priya Raman viewed household:ngozi.ssn". Say: every reveal is logged. Also say: this is **display masking only**; the identifiers are still in the data file and in the browser's saved log.

## 6. A stale sign-off (9:00 to 10:00)

**Role:** Priya (the RSU case was resolved in section 2).

1. Open **Documents**, then **D11**. In **Disposition**, choose **Supplemental evidence**, add a short note, click **Save**.
2. Open the RSU case. **See:** the banner "This case was signed off, but the evidence it covers changed afterwards. The sign-off no longer counts; reopen and reconsider." and the checklist item "Decision submitted: **Changed since sign-off**". Say: a sign-off remembers the evidence it covered and reopens when it changes.

## 7. The AI copilot (10:00 to 11:15)

**This is the only section that needs the access code** (also the "AI second look" card in the help panel). Without the code everything else above works, and Step 1 says the AI is off.

**Role:** Priya. Use the case whose report is already cached (see the checklist).

1. Open the case, Step 1. If asked, enter the access code (off screen) and click **Use code**. **See:** three plain lines labelled as an AI suggestion, with **cached** and the time it was made (a fresh run shows "fresh" and takes about 40 seconds). Click **Show full analysis**: facts with clickable evidence chips, hypotheses, missing information, and a line saying the citations and amounts were checked against the packet.
2. Step 2: "**Link these records as evidence?**" Nothing is selected. Click **Select the documentary ones**, then **Link N records**. Say: linking is the person's click, and the usual evidence rules still apply.
3. Step 4: click **Draft from the AI analysis**. **See:** the reason filled in, marked "AI draft: check and edit it before you submit". It is not submitted for you.
4. Say: suggestion only, citations verified, an unverified report cannot be accepted, and it never changes a case.

## 8. Close (11:15 to 12:00)

Spoken points. Tradeoffs:
- A browser app plus a small server (it holds the AI key), not a database. It runs from a link, but **each browser keeps its own history; two people do not see each other's work**.
- Rules in code, not AI, so findings are repeatable. A few rules fit this packet.
- Tax effects are estimates from the packet's rates, not a recomputed return.
- Roles are checked in the browser: a demonstration of the rules, not security. The access code gates paid AI calls and is not user authentication.
- Masking is display-only, and the packet is public on this site.

What is not built (say it plainly): several people at once; the "what changed since I last looked" indicator (the Activity log lists every action; the unread count did not show in my testing, so I do not claim it); client approval and e-file signature; freeze at filing and amend; time against budget; a firm-standards screen; books-to-tax and state-split schedules; your own what-ifs; file upload; a notice-response package; next-year roll-forward; per-number "how verified"; elections and penalty decisions; bonus and recapture columns; richer Form 8949 lot detail.

How AI was used: the app was built with Claude Code, directed and reviewed by me, and at runtime the optional copilot is the only model use (I ran it once on the deployed site).

## If something goes wrong

- **Page is blank or slow:** the free plan was asleep; wait and reload.
- **AI says it is off or refuses the code:** skip section 7; nothing else depends on it.
- **A state you do not expect:** Activity > Reset demo, then pick Priya again.
