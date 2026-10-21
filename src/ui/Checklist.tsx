import type { CheckItem } from './flowState';

const ICON: Record<CheckItem['state'], string> = { done: '✓', todo: '○', waiting: '…', stale: '!', na: '–' };
const WORD: Record<CheckItem['state'], string> = { done: 'Done', todo: 'To do', waiting: 'Waiting', stale: 'Changed since sign-off', na: 'Not needed' };

/** The case checklist; items come from flowState(), i.e. from projected domain state. */
export function Checklist({ items, compact }: { items: CheckItem[]; compact?: boolean }) {
  return (
    <section className={`section checklist-card${compact ? ' compact' : ''}`} aria-label="Checklist">
      <header className="section-h"><h3>Checklist</h3></header>
      <ul className="flow-checklist">
        {items.map((i) => (
          <li key={i.id} className={`ci-${i.state}`}>
            <span className="ci-icon" aria-hidden>{ICON[i.state]}</span>
            <div><div className="ci-label">{i.label} <span className="sr-only">: {WORD[i.state]}</span></div><div className="small muted">{i.detail}</div></div>
          </li>
        ))}
      </ul>
    </section>
  );
}
