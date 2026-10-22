import { useApp } from '../ui/context';
import { useRoute } from '../ui/router';
import { Ref, Section } from '../ui/components';
import { relatedReturns } from '../ui/relatedReturns';

/** The other returns this household's numbers depend on, and where each one touches this return. */
export function RelatedReturns() {
  const { ix, defs, state, mask } = useApp();
  const focus = useRoute().query.get('focus');
  const list = relatedReturns(ix, defs);
  return (
    <div className="page">
      <div className="page-h"><div><h1>Related returns</h1><p className="muted">Returns for the household's relatives and entities. Their figures feed this return, but most were prepared elsewhere and are not in this packet. Each card says what we hold and where it touches this return.</p></div></div>
      <div className="related-grid">
        {list.map((r) => (
          <Section key={r.key} id={r.key} title={r.who}>
            <div className={`related-card${focus === r.key ? ' focus' : ''}`}>
              <p>{mask(r.description)}</p>
              <p className="small muted">Prepared by {mask(r.preparedBy)}</p>
              <p className="small"><strong>In this packet:</strong> {r.docIds.length ? mask(r.inPacket) : <span className="muted">nothing. We only know it exists.</span>}</p>
              {r.docIds.length > 0 && <div className="refs">{r.docIds.map((id) => <Ref key={id} r={id} />)}</div>}
              {r.lines.length > 0 && <div><div className="small muted">Return lines fed by these documents</div><div className="refs">{r.lines.slice(0, 12).map((k) => <Ref key={k} r={k} compact />)}</div>{r.lines.length > 12 && <div className="small muted">and {r.lines.length - 12} more</div>}</div>}
              {r.personId && <p className="small">On this return: <a href="#/client">household record</a></p>}
              <h4>Cases that touch it</h4>
              {r.cases.length
                ? <ul className="plain small">{r.cases.map((d) => <li key={d.id}><a href={`#/case/${d.id}`}>{d.title}</a> <span className="muted">· {state.cases[d.id].status.replace(/_/g, ' ')}</span></li>)}</ul>
                : <p className="small muted">No case cites this return.</p>}
            </div>
          </Section>
        ))}
      </div>
    </div>
  );
}
