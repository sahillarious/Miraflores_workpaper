import type { CaseDef } from './cases';
import type { PacketIndex } from './packetIndex';
import { authorize, fingerprint, project, type Actor, type Command, type WEvent, type WorkState } from './workflow';

// Persistence sits behind a tiny repository interface. The deployed demo is a
// static site, so the default repository is the browser's localStorage (work
// survives refresh in that browser). A server repository with the same three
// methods would make the log shared across people without touching the UI.

export interface Repository {
  load(): WEvent[];
  save(log: WEvent[]): void;
  clear(): void;
}

export class MemoryRepository implements Repository {
  constructor(private log: WEvent[] = []) {}
  load() { return [...this.log]; }
  save(log: WEvent[]) { this.log = [...log]; }
  clear() { this.log = []; }
}

export class LocalStorageRepository implements Repository {
  constructor(private key: string, private storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = globalThis.localStorage) {}
  load(): WEvent[] {
    try {
      const raw = this.storage.getItem(this.key);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  save(log: WEvent[]) {
    try { this.storage.setItem(this.key, JSON.stringify(log)); } catch { /* storage full or blocked: work stays in memory */ }
  }
  clear() { try { this.storage.removeItem(this.key); } catch { /* ignore */ } }
}

export class Workpaper {
  log: WEvent[];
  state: WorkState;
  private defsById: Map<string, CaseDef>;
  private listeners = new Set<() => void>();

  constructor(public ix: PacketIndex, public defs: CaseDef[], private repo: Repository, private now: () => Date = () => new Date()) {
    this.defsById = new Map(defs.map((d) => [d.id, d]));
    this.log = repo.load();
    this.state = project(ix, defs, this.log);
  }

  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }

  /** Validate and append one or more commands as a single batch (all or nothing). */
  dispatch(actor: Actor, cmds: Command | Command[]): { ok: true; events: WEvent[] } | { ok: false; error: string } {
    const list = Array.isArray(cmds) ? cmds : [cmds];
    const batch = list.length > 1 ? `b-${this.log.length + 1}-${Date.now().toString(36)}` : undefined;
    let log = this.log;
    let state = this.state;
    const created: WEvent[] = [];
    for (const c of list) {
      const payload = { ...c.payload };
      if (c.type === 'case.propose' || c.type === 'case.resolve') {
        const def = this.defsById.get(payload.caseId);
        if (def) payload.fingerprint = fingerprint(state.cases[def.id], def, state.docs, this.ix);
      }
      const err = authorize(this.ix, this.defsById, state, actor, { ...c, payload });
      if (err) return { ok: false, error: list.length > 1 ? `${payload.caseId ?? payload.docId ?? ''}: ${err}` : err };
      const seq = (log.at(-1)?.seq ?? 0) + 1;
      const ev: WEvent = { id: `e-${seq}-${Math.random().toString(36).slice(2, 7)}`, seq, at: this.now().toISOString(), actor: actor.id, role: actor.role, type: c.type, payload, batch: c.batch ?? batch };
      log = [...log, ev];
      state = project(this.ix, this.defs, log);
      created.push(ev);
    }
    this.log = log;
    this.state = state;
    this.repo.save(log);
    this.listeners.forEach((f) => f());
    return { ok: true, events: created };
  }

  /** Undo a single event or a whole batch (appends an undo event; nothing is deleted). */
  undo(actor: Actor, eventId: string) {
    const ev = this.state.events.find((e) => e.id === eventId);
    if (!ev) return { ok: false as const, error: 'Event not found or already undone.' };
    const ids = ev.batch ? this.state.events.filter((e) => e.batch === ev.batch).map((e) => e.id) : [ev.id];
    return this.dispatch(actor, { type: 'undo', payload: { eventIds: ids, caseId: ev.payload.caseId, docId: ev.payload.docId, summary: `${ev.type}${ev.batch ? ` (batch of ${ids.length})` : ''}` } });
  }

  exportLog(): string { return JSON.stringify({ packet: this.ix.packet.packet, exportedAt: this.now().toISOString(), events: this.log }, null, 2); }

  importLog(json: string) {
    const parsed = JSON.parse(json);
    if (parsed?.packet?.client_id !== this.ix.packet.packet.client_id) throw new Error('This export belongs to a different client packet.');
    if (!Array.isArray(parsed.events)) throw new Error('No events in file.');
    this.log = parsed.events;
    this.state = project(this.ix, this.defs, this.log);
    this.repo.save(this.log);
    this.listeners.forEach((f) => f());
  }

  reset() {
    this.repo.clear();
    this.log = [];
    this.state = project(this.ix, this.defs, this.log);
    this.listeners.forEach((f) => f());
  }
}
