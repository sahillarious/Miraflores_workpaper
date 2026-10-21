import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AppProvider } from './ui/context';
import { buildIndex } from './domain/packetIndex';
import { buildCases } from './domain/cases';
import { LocalStorageRepository, Workpaper } from './domain/store';
import type { Packet } from './domain/types';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
root.render(<div className="boot">Loading packet…</div>);

// The packet is fetched exactly as delivered; everything else is derived from it.
fetch('./data/okafor_lindqvist_2025_packet.json')
  .then((r) => {
    if (!r.ok) throw new Error(`Packet request failed (${r.status})`);
    return r.json() as Promise<Packet>;
  })
  .then((packet) => {
    const ix = buildIndex(packet);
    const defs = buildCases(ix);
    const repo = new LocalStorageRepository(`mf-workpaper:${packet.packet.client_id}:${packet.packet.version}`);
    const wp = new Workpaper(ix, defs, repo);
    root.render(
      <AppProvider ix={ix} defs={defs} wp={wp}>
        <App />
      </AppProvider>,
    );
  })
  .catch((err) => {
    root.render(<div className="boot error">Could not load the case packet: {String(err.message ?? err)}</div>);
  });
