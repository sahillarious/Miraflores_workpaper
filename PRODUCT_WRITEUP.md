# Miraflores workpaper: core idea and data model

**The idea.** A workpaper should answer three questions about any number: where did it come from, can I trust it, and what did we decide. So this is not a set of schedules. It is a review queue of *cases* on a read-only packet. Every number traces to its source page and field, every finding shows both sides of the disagreement, and every human action is saved as an event that is never edited.

**Data model.**
- **Source layer:** the packet exactly as delivered, indexed by its own ids so any reference opens its record.
- **Derived layer:** plain functions over the packet: 34 cases (13 from the tax software's own flags, 21 from rules comparing documents, pages, years and agency records) and 16 independent recomputations. Nothing is typed in.
- **Event log:** notes, questions, adjustments, decisions, sign-offs, undo. State is the log played forward, so one log gives history, undo, the audit trail and stale sign-offs: a sign-off remembers the evidence it covered and reopens if that changes.

**Guided flow.** A case opens as four steps (What's wrong, Check the proof, Fix it, Send) so a new hire can start on day one. It is a view over the same workflow: no extra rules, and every button passes the same permission check. The full view is one click away.

**AI.** One optional helper per case, with read-only tools. It only suggests: every record and amount it cites is checked against the packet, an unverified report cannot be accepted, it never changes a case, and a person accepts or rejects it. Everything else is ordinary code. I ran it once on the deployed site.

**Sensitive data.** Social Security and bank numbers are masked on screen; cleared staff can reveal them and each reveal is logged. This is display masking only: the data file and saved log still hold the real values.

**Tradeoffs.** A browser app plus a small server (for the AI key), not a database: it runs from a link, but each browser keeps its own history. Rules in code, not AI: findings are repeatable, but a few fit this packet. Roles are checked in the browser: a demonstration, not security.

**Not built / partly built**
- **Several people at once:** each browser keeps its own history; sharing would mean saving the same log on a server.
- **"What changed since I last looked":** partly built. After "Mark all seen", another role's change in the same browser shows a count and a marker; changes from another computer never do.
- **Client approval and e-file signature:** one more recorded step after partner sign-off.
- **Freeze at filing, amend:** a "filed" event, after which changes are refused; an amendment starts a copy.
- **Time against budget:** hours could be added up from timestamps already in the log.
- **Firm standards screen:** standards feed one check only; a screen would display them.
- **Books-to-tax and state-split schedules:** only single cases exist; schedules would be new views.
- **Your own what-ifs:** the packet's five are view-only; yours would be draft adjustments.
- **File upload:** only links and notes; an upload would attach through the same link event.
- **Notice-response package:** the notice cases exist; a package would gather them.
- **Next-year roll-forward:** carryovers are only shown.
- **Per-number "how verified":** recorded per reconciliation only.
- **Elections and penalty decisions:** no place yet; each would be a decision with a reason.
- **Depreciation bonus and recapture; fuller Form 8949 lots:** missing columns.
- **Role rules:** enforced in the browser only; a server would run the same check.
