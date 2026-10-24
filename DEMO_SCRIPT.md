# Try it yourself

The video explains the design and the tradeoffs. This page is for trying things yourself: eight short scenarios, each with the exact clicks and what you should see. Each one stands alone, so do whichever you like, in any order (scenario 6 builds on scenario 2).

**The app:** https://miraflores-workpaper-up2n.onrender.com

- It runs on a free plan, so the **first load after a pause can take about a minute**. Reload if it is slow.
- Everything is invented data. Your work is saved **in your own browser only**: nobody else sees it, and you cannot break anything for anyone.
- To start over at any point: **Activity → Reset demo**, then pick **Priya Raman** again.
- Only scenario 8 (the AI) needs an **access code**, which is shared separately. Everything else works without it.

## Who is who

Pick a person with the **Demo role** box at the top right ("Act as"). It is a demonstration of who may do what, not a login.

| Person | Role | Useful for |
|---|---|---|
| **Priya Raman** | preparer | working a case, proposing, submitting |
| **Daniel Ortiz** | reviewer | approving small items; refused on big ones |
| **Helen Strand** | partner | approving anything, including adjustments over 1,000 |
| **Marcus Bell** | preparer **without** sensitive-data clearance | seeing identifiers masked |
| **Ngozi Okafor** | client | sees only the portal |

**Start state** (after Reset demo): the top bar shows **Blocked · 34 open**, you are Priya, and nothing has been proposed, approved or signed off.

## 1. See what is unverified and what needs attention

*Role: Priya.*

1. Open the home page. You should see **"Your next case: 1 of 34"**, a **Blocker**: "Theo Lindqvist-Okafor: SSN in the organizer differs from the 2024 return", with a plain sentence ("…ending 3309 does not match last year's return (ending 3390), so the e-file would be rejected").
2. Scroll to **Return figures**. A yellow banner says **"Unverified."** These are the tax software's own v3 figures, not checked numbers.
3. Click **Review queue**. You should see 34 cases: 13 from the tax software's own flags and 21 from checks this app runs.

## 2. Fix a case with four people (stock sales with $0 cost)

1. **Priya:** Review queue, search `RSU`, open "Corvane RSU sales reported with $0 basis…". Step 1 says what is wrong, with an estimate (Fed −15,536, CA −2,765, marked *est.*) and the source page (D11, page 2) highlighted. Click **Yes, that's right**.
2. **Step 2, Check the proof:** the two sides are compared. Click **The proof checks out**.
3. **Step 3, Fix it:** click **Propose all**. Three adjustments appear, one per lot, and the checklist says "Adjustments approved: Waiting, 3 waiting for partner approval".
4. **Switch to Helen Strand** (partner). Same case, Step 3: click **Approve all**. The checklist says "3 approved".
5. **Switch to Priya.** Step 4 (Send): type a reason of at least 20 characters, for example "D11 gives the basis for all three lots; the partner approved the adjustments." Click **Submit for approval**. The checklist says "Waiting for partner approval". (Priya cannot approve her own work.)
6. **Switch to Daniel Ortiz** (reviewer) and open the case. It opens on Step 4, now called **Review and approve**. Click **Approve & sign off**. You should see it **refused**: "An adjustment over 1,000 needs partner sign-off." Also open Step 1 as Daniel: there is no "waiting for your approval" banner, because approving would fail for him.
7. **Switch to Helen.** Open the case on Step 1 or 2. A banner says **"This case is waiting for your approval. Go to Step 4"**. Click the link, then **Approve & sign off**. You should see "Approved and resolved", status **Resolved**, and "Approved and signed off" in the checklist.

The top bar stays **Blocked** while the Theo SSN case is open.

## 3. Spot a confident mistake

1. Open **Documents**, then **D62** (Little Sprouts Learning Center), then click the value **ev-1045**. (Or go straight to `#/doc/D62?ev=ev-1045`.)
2. The page prints the Tax ID **74-3829156**. The value the software read is **74-3829516** at confidence **0.97**, marked **"not found in printed text"**. The software was confident and wrong; the app checked every extracted value against its printed page.
3. Another one: open the Meridian case ("Meridian 1099-B summary proceeds 71,965 vs extracted lots 71,715") and follow the `doc:D31#page32` link. Page 32 holds lot M18 (proceeds 250.00, basis 310.00), a page nobody extracted, which explains the 250 gap.

## 4. Follow a related return, link evidence, add a note

*Role: Priya.*

1. Click **Related returns** in the left menu. Three cards: Ada's own 1040 (nothing in this packet), the S corporation's 1120-S (K-1s **D39, D40**), and Ridgeline's 1065 (**D37, D38**), each with the return lines it feeds and the cases that touch it. Click **D39**: it says "Part of a related return: Lindqvist Family Woodworks, Inc.…" and links back.
2. Review queue, open the Meridian case, then click **Show full details** (the link at the top). **Notes live here, not in the guided steps.**
3. In the **left** pane, find **Link evidence to the decision**. Type `doc:D31#page32` in "Reference to link", a reason such as "Unread page with lot M18 (proceeds 250)", and click **Link**. You should see "Linked doc:D31#page32".
4. In the **Notes** box in the **right** pane, type a note and click **Add**. Use **← Back to guided steps** to return.

## 5. See identifiers masked, and a logged reveal

1. **Switch to Marcus Bell** (no clearance) and open **Client records**. SSNs show as `***-**-2287` and the IP PIN as `••2915`, each with a greyed-out "masked" control.
2. **Switch to Priya** and click **reveal** next to Ngozi's SSN. The full number appears.
3. Open **Activity**. The **Sensitive-data view log** now has "Priya Raman viewed household:ngozi.ssn". Every reveal is logged. (This is display masking only; the real values are still in the data file.)

## 6. See a sign-off go stale

*Needs scenario 2 done first (a resolved case).*

1. As Priya, open **Documents**, then **D11**. In **Disposition** choose **Supplemental evidence**, add a short note and click **Save**.
2. Open the stock-sales case again. A banner says **"This case was signed off, but the evidence it covers changed afterwards. The sign-off no longer counts; reopen and reconsider."** and the checklist shows **"Changed since sign-off"**. A sign-off remembers the evidence it covered and reopens when that changes.

## 7. See what changed since you last looked

This works in one browser, per role, and needs one first click.

1. **Switch to Daniel.** Open **Activity** and click **Mark all seen**. (Without this, nothing shows.)
2. **Switch to Priya.** Open the Meridian case, **Show full details**, and add a note in the right pane.
3. **Switch back to Daniel.** You should see a count on **Activity** in the left menu, a small dot on the Meridian case in the Review queue ("Changed since you last looked"), and on **Activity** the line "1 new since you last looked".

It does not show another person's changes made on another computer, because work is not shared between browsers.

## 8. Try the AI (needs the access code)

*Role: Priya.* The AI is optional and only suggests.

1. Open any case on Step 1. Type the access code in the box and click **Use code**. The first run takes about 40 seconds. You should see **three plain lines** marked as an AI suggestion (later visits show "cached" instead of running again). Click **Show full analysis** for the facts, the records they cite and what is missing. Every record and amount is checked against the packet.
2. **Step 2:** "Link these records as evidence?" Nothing is pre-selected. Click **Select the documentary ones**, then **Link N records**.
3. **Step 4:** click **Draft from the AI analysis**. A reason is filled in, marked "AI draft: check and edit it before you submit". It is never submitted for you.

The AI never changes a case. A report that fails the checks cannot be accepted.

A fresh run calls a paid model (about 9 cents), so please run it once or twice rather than repeatedly; the daily limit is shared by everyone.

## If something looks wrong

- **Blank page or very slow:** the free plan was asleep. Wait a minute and reload.
- **An odd state:** Activity → Reset demo, then pick Priya.
- **The AI says it is off or refuses the code:** skip scenario 8; nothing else depends on it.

## What this app does not do

Several people working at once (each browser keeps its own history), client approval and e-file signature, freezing at filing, time against budget, and more. The full, plain list is in [PRODUCT_WRITEUP.md](PRODUCT_WRITEUP.md); the 18 errors found are in [ERRORS_FOUND.md](ERRORS_FOUND.md).
