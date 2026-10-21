import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { CaseDef } from '../domain/cases';
import { independentChecks, type CheckResult } from '../domain/checks';
import type { PacketIndex } from '../domain/packetIndex';
import type { Workpaper } from '../domain/store';
import { buildActors, type Actor, type Command, type WorkState } from '../domain/workflow';

interface Ctx {
  ix: PacketIndex;
  defs: CaseDef[];
  defsById: Map<string, CaseDef>;
  wp: Workpaper;
  state: WorkState;
  actors: Actor[];
  actor: Actor;
  setActor: (id: string) => void;
  checks: CheckResult[];
  run: (cmds: Command | Command[], success?: string) => boolean;
  toast: (msg: string, kind?: 'ok' | 'err') => void;
  lastSeen: string;
  markSeen: () => void;
}

const C = createContext<Ctx | null>(null);
export const useApp = () => useContext(C)!;

function readLS(k: string, fallback: string) {
  try { return localStorage.getItem(k) ?? fallback; } catch { return fallback; }
}
function writeLS(k: string, v: string) {
  try { localStorage.setItem(k, v); } catch { /* ignore */ }
}

export function AppProvider({ ix, defs, wp, children }: { ix: PacketIndex; defs: CaseDef[]; wp: Workpaper; children: ReactNode }) {
  const state = useSyncExternalStore((f) => wp.subscribe(f), () => wp.state);
  const actors = useMemo(() => buildActors(ix), [ix]);
  const [actorId, setActorId] = useState(() => readLS('mf-actor', 'st-01'));
  const actor = actors.find((a) => a.id === actorId) ?? actors[0];
  const defsById = useMemo(() => new Map(defs.map((d) => [d.id, d])), [defs]);
  const checks = useMemo(() => independentChecks(ix, new Set(defs.map((d) => d.id))), [ix, defs]);
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: 'ok' | 'err' }[]>([]);
  const seenKey = `mf-seen:${actor.id}`;
  const [lastSeen, setLastSeen] = useState(() => readLS(seenKey, ''));
  useEffect(() => { setLastSeen(readLS(seenKey, '')); }, [seenKey]);

  const toast = (msg: string, kind: 'ok' | 'err' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind }].slice(-3));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'err' ? 6000 : 3000);
  };

  const value: Ctx = {
    ix, defs, defsById, wp, state, actors, actor,
    setActor: (id) => { writeLS('mf-actor', id); setActorId(id); },
    checks,
    run: (cmds, success) => {
      const r = wp.dispatch(actor, cmds);
      if (!r.ok) { toast(r.error, 'err'); return false; }
      if (success) toast(success);
      return true;
    },
    toast,
    lastSeen,
    markSeen: () => { const now = new Date().toISOString(); writeLS(seenKey, now); setLastSeen(now); },
  };

  return (
    <C.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>)}
      </div>
    </C.Provider>
  );
}
