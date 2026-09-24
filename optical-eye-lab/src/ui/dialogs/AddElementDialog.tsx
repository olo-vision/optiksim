/**
 * Auswahlfenster „Optisches Element hinzufügen“.
 */
import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { ELEMENT_CATEGORIES, ELEMENT_DEFINITIONS } from '@/model/elementRegistry';
import { modulesByCategory } from '@/modules/registry';
import { useAppStore } from '@/state/store';
import { Dialog } from '../common/overlays';
import { ElementGlyph } from '../common/ElementGlyph';
import { Badge } from '../common/controls';

export function AddElementDialog() {
  const close = () => useAppStore.getState().openDialog(null);
  const addElement = useAppStore((s) => s.addElement);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const defs = useMemo(() => ELEMENT_DEFINITIONS.filter((d) => !q || d.label.toLowerCase().includes(q) || d.description.toLowerCase().includes(q)), [q]);
  const devices = modulesByCategory('Untersuchungsgeräte');

  return (
    <Dialog title="Optisches Element hinzufügen" subtitle="Das Element wird auf der optischen Achse vor dem Auge platziert." onClose={close} width={780}>
      <div className="add-search">
        <Search size={15} />
        <input autoFocus placeholder="Suchen …" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      </div>
      {ELEMENT_CATEGORIES.map((cat) => {
        const items = defs.filter((d) => d.category === cat);
        if (!items.length) return null;
        return (
          <div key={cat} className="add-cat">
            <h3 className="add-cat__title">{cat}</h3>
            <div className="add-grid">
              {items.map((d) => (
                <button key={d.kind} type="button" className="add-card" onClick={() => addElement(d.kind)}>
                  <span className="add-card__glyph">
                    <ElementGlyph kind={d.kind} size={30} />
                  </span>
                  <span className="add-card__text">
                    <span className="add-card__name">{d.label}</span>
                    <span className="add-card__desc">{d.description}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
      {!q && (
        <div className="add-cat add-cat--muted">
          <h3 className="add-cat__title">
            Untersuchungsgeräte <Badge tone="dev">In Entwicklung</Badge>
          </h3>
          <div className="add-grid add-grid--compact">
            {devices.map((m) => (
              <div key={m.id} className="add-card is-disabled" aria-disabled>
                <span className="add-card__text">
                  <span className="add-card__name">{m.title}</span>
                  <span className="add-card__desc">{m.description}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {defs.length === 0 && <p className="insp-hint">Keine passenden Elemente.</p>}
    </Dialog>
  );
}
