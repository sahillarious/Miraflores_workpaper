import { useMemo } from 'react';
import { useApp } from './ui/context';
import { useRoute } from './ui/router';
import { readiness, READINESS_LABEL } from './domain/workflow';
import { Overview } from './views/Overview';
import { Queue } from './views/Queue';
import { CaseView } from './views/CaseView';
import { Documents, DocumentView } from './views/Documents';
import { Versions } from './views/Versions';
import { LineTrace } from './views/LineTrace';
import { Activity } from './views/Activity';
import { Readiness, Checks } from './views/Readiness';
import { ClientRecords, ClientPortal } from './views/Client';
import { PriorRecords, Assets } from './views/Prior';

const NAV = [
  { href: '#/', label: 'Overview', match: '' },
  { href: '#/queue', label: 'Review queue', match: 'queue' },
  { href: '#/versions', label: 'Return & versions', match: 'versions' },
  { href: '#/docs', label: 'Documents', match: 'docs' },
  { href: '#/checks', label: 'Independent checks', match: 'checks' },
  { href: '#/readiness', label: 'Readiness', match: 'readiness' },
  { href: '#/activity', label: 'Activity', match: 'activity' },
  { href: '#/client', label: 'Client records', match: 'client' },
  { href: '#/assets', label: 'Assets', match: 'assets' },
  { href: '#/prior', label: 'Prior year & agency', match: 'prior' },
];

export function App() {
  const { ix, defs, state, actor, actors, setActor, checks, lastSeen } = useApp();
  const route = useRoute();
  const ready = useMemo(() => readiness(ix, defs, state, checks.filter((c) => !c.pass).length), [ix, defs, state, checks]);
  const open = defs.filter((d) => state.cases[d.id].status !== 'resolved').length;
  const newSince = lastSeen ? state.events.filter((e) => e.at > lastSeen && e.actor !== actor.id && e.type !== 'sensitive.view').length : 0;
  const top = route.path[0] ?? '';

  let view;
  if (actor.role === 'client') view = <ClientPortal />;
  else {
    switch (top) {
      case '': view = <Overview ready={ready} />; break;
      case 'queue': view = <Queue />; break;
      case 'case': view = <CaseView id={route.path[1]} />; break;
      case 'docs': view = <Documents />; break;
      case 'doc': view = <DocumentView id={route.path[1]} />; break;
      case 'versions': view = <Versions />; break;
      case 'line': view = <LineTrace k={route.path[1]} />; break;
      case 'activity': view = <Activity />; break;
      case 'readiness': view = <Readiness ready={ready} />; break;
      case 'checks': view = <Checks />; break;
      case 'client': view = <ClientRecords />; break;
      case 'prior': view = <PriorRecords />; break;
      case 'assets': view = <Assets />; break;
      default: view = <div className="page"><h1>Not found</h1><p><a href="#/">Back to overview</a></p></div>;
    }
  }

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="#/">Miraflores <span>workpaper</span></a>
        <div className="client-id">
          <strong>{ix.packet.household.people.filter((p: any) => p.role !== 'dependent').map((p: any) => p.name.split(' ').at(-1)).join('-')}</strong>
          <span className="muted"> · {ix.packet.packet.client_id} · TY{ix.packet.household.tax_year} · MFJ · current return {ix.current.version}</span>
        </div>
        <a className={`ready-pill r-${ready.level}`} href="#/readiness" title={ready.blockers.join('; ') || 'No blockers'}>
          {READINESS_LABEL[ready.level]} · {open} open
        </a>
        <label className="role">
          <span className="demo-tag" title="Role switching simulates different users for the demo. It is not authentication; permissions are enforced in the app's command layer.">Demo role</span>
          <select value={actor.id} onChange={(e) => setActor(e.target.value)} aria-label="Act as">
            {actors.map((a) => <option key={a.id} value={a.id}>{a.name} — {a.title}</option>)}
          </select>
        </label>
      </header>
      <div className="body">
        {actor.role !== 'client' && (
          <nav className="sidenav" aria-label="Sections">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} className={top === n.match || (n.match === 'queue' && top === 'case') || (n.match === 'docs' && top === 'doc') || (n.match === 'versions' && top === 'line') ? 'active' : ''}>
                {n.label}
                {n.match === 'activity' && newSince > 0 && <span className="badge" title="Changes by others since you last looked">{newSince}</span>}
                {n.match === 'queue' && <span className="count">{open}</span>}
              </a>
            ))}
            <div className="nav-foot muted small">
              Packet {ix.packet.packet.version} · generated {ix.packet.packet.generated}<br />
              All data invented (README).
            </div>
          </nav>
        )}
        <main className="main">{view}</main>
      </div>
    </div>
  );
}
