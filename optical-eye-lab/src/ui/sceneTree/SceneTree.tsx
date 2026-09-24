/**
 * Szenenverwaltung (linke Seitenleiste): Raum, Auge, optische Elemente,
 * Lichtquellen, Messpunkte – mit Sichtbarkeit, Sperre, Duplizieren, Löschen, Umbenennen.
 */
import { useState, type ReactNode } from 'react';
import { Box, ChevronRight, Copy, Crosshair, Eye, EyeOff, Lightbulb, Lock, LockOpen, PanelLeftClose, Plus, Trash2 } from 'lucide-react';
import { useAppStore } from '@/state/store';
import { ROOM_ID, type SceneEntity } from '@/model/types';
import { ElementGlyph, EyeGlyph } from '../common/ElementGlyph';

function RowName({ name, onRename }: { name: string; onRename?: (n: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(name);
  if (editing && onRename)
    return (
      <input
        className="tree-row__input"
        value={text}
        autoFocus
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={() => {
          onRename(text);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setText(name);
            setEditing(false);
          }
        }}
        onClick={(e) => e.stopPropagation()}
      />
    );
  return (
    <span
      className="tree-row__name"
      onDoubleClick={(e) => {
        if (!onRename) return;
        e.stopPropagation();
        setText(name);
        setEditing(true);
      }}
      title={onRename ? 'Doppelklick zum Umbenennen' : undefined}
    >
      {name}
    </span>
  );
}

function EntityRow({ entity, icon, removable = true }: { entity: SceneEntity; icon: ReactNode; removable?: boolean }) {
  const selected = useAppStore((s) => s.selectedId === entity.id);
  const { select, setEntityFlag, duplicateEntity, deleteEntity, renameEntity } = useAppStore.getState();
  return (
    <div
      className={`tree-row${selected ? ' is-selected' : ''}${!entity.visible ? ' is-hidden' : ''}`}
      onClick={() => select(entity.id)}
      role="treeitem"
      aria-selected={selected}
    >
      <span className="tree-row__icon">{icon}</span>
      <RowName name={entity.name} onRename={(n) => renameEntity(entity.id, n)} />
      <span className="tree-row__actions">
        {removable && (
          <>
            <button type="button" className="tree-act tree-act--hover" data-tip="Duplizieren" onClick={(e) => (e.stopPropagation(), duplicateEntity(entity.id))}>
              <Copy size={13} />
            </button>
            <button type="button" className="tree-act tree-act--hover" data-tip="Löschen" disabled={entity.locked} onClick={(e) => (e.stopPropagation(), deleteEntity(entity.id))}>
              <Trash2 size={13} />
            </button>
          </>
        )}
        <button
          type="button"
          className={`tree-act${entity.locked ? ' is-on' : ''}`}
          data-tip={entity.locked ? 'Entsperren' : 'Sperren'}
          onClick={(e) => (e.stopPropagation(), setEntityFlag(entity.id, 'locked', !entity.locked))}
        >
          {entity.locked ? <Lock size={13} /> : <LockOpen size={13} />}
        </button>
        <button
          type="button"
          className={`tree-act${!entity.visible ? ' is-on' : ''}`}
          data-tip={entity.visible ? 'Ausblenden' : 'Einblenden'}
          onClick={(e) => (e.stopPropagation(), setEntityFlag(entity.id, 'visible', !entity.visible))}
        >
          {entity.visible ? <Eye size={13} /> : <EyeOff size={13} />}
        </button>
      </span>
    </div>
  );
}

function Group({ title, count, onAdd, addTip, children, empty }: { title: string; count: number; onAdd?: () => void; addTip?: string; children: ReactNode; empty?: string }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="tree-group">
      <div className="tree-group__header">
        <button type="button" className="tree-group__toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          <ChevronRight size={12} className={`tree-group__chevron${open ? ' is-open' : ''}`} />
          <span>{title}</span>
          <span className="tree-group__count">{count}</span>
        </button>
        {onAdd && (
          <button type="button" className="tree-act" onClick={onAdd} data-tip={addTip}>
            <Plus size={14} />
          </button>
        )}
      </div>
      {open && <div className="tree-group__body">{count === 0 && empty ? <div className="tree-empty">{empty}</div> : children}</div>}
    </div>
  );
}

export function SceneTree() {
  const doc = useAppStore((s) => s.doc);
  const selectedId = useAppStore((s) => s.selectedId);
  const { select, openDialog, addLightSource, addMeasurePoint, setDocField, togglePanel } = useAppStore.getState();

  return (
    <aside className="panel panel--left">
      <header className="panel__header">
        <span className="panel__title">Szene</span>
        <button type="button" className="tree-act" onClick={() => togglePanel('left')} data-tip="Seitenleiste ausblenden  ·  [" data-tip-side="right">
          <PanelLeftClose size={15} />
        </button>
      </header>
      <div className="panel__scroll" role="tree">
        <div
          className={`tree-row tree-row--root${selectedId === ROOM_ID ? ' is-selected' : ''}${!doc.environment.showRoom ? ' is-hidden' : ''}`}
          onClick={() => select(ROOM_ID)}
        >
          <span className="tree-row__icon">
            <Box size={15} strokeWidth={1.6} />
          </span>
          <span className="tree-row__name">Laborraum</span>
          <span className="tree-row__actions">
            <button
              type="button"
              className={`tree-act${!doc.environment.showRoom ? ' is-on' : ''}`}
              data-tip={doc.environment.showRoom ? 'Raum ausblenden' : 'Raum einblenden'}
              onClick={(e) => (e.stopPropagation(), setDocField('environment', { showRoom: !doc.environment.showRoom }))}
            >
              {doc.environment.showRoom ? <Eye size={13} /> : <EyeOff size={13} />}
            </button>
          </span>
        </div>
        <EntityRow entity={doc.eye} icon={<EyeGlyph size={17} />} removable={false} />

        <Group title="Optische Elemente" count={doc.elements.length} onAdd={() => openDialog('add-element')} addTip="Optisches Element hinzufügen" empty="Noch keine Elemente – über + hinzufügen.">
          {doc.elements.map((el) => (
            <EntityRow key={el.id} entity={el} icon={<ElementGlyph kind={el.kind} size={17} />} />
          ))}
        </Group>

        <Group title="Lichtquellen / Geräte" count={doc.lights.length} onAdd={addLightSource} addTip="Lichtquelle hinzufügen" empty="Keine Lichtquelle – nötig für den Strahlengang.">
          {doc.lights.map((l) => (
            <EntityRow key={l.id} entity={l} icon={<Lightbulb size={15} strokeWidth={1.6} />} />
          ))}
        </Group>

        <Group title="Messpunkte" count={doc.measurePoints.length} onAdd={addMeasurePoint} addTip="Messpunkt hinzufügen" empty="Keine Messpunkte.">
          {doc.measurePoints.map((m) => (
            <EntityRow key={m.id} entity={m} icon={<Crosshair size={15} strokeWidth={1.6} />} />
          ))}
        </Group>
      </div>
      <footer className="panel__footer">
        <span>{doc.elements.length + doc.lights.length + doc.measurePoints.length + 1} Objekte</span>
        <span className="panel__footer-hint">Doppelklick = umbenennen</span>
      </footer>
    </aside>
  );
}

