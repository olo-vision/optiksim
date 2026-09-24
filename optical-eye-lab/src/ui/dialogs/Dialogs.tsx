/**
 * Einstellungen, gespeicherte Szenen, Tastenkürzel.
 */
import { useState } from 'react';
import { FolderOpen, Trash2 } from 'lucide-react';
import { useAppStore } from '@/state/store';
import { deleteSavedScene, listSavedScenes, type QualityLevel } from '@/state/persistence';
import { MODULES } from '@/modules/registry';
import { Dialog } from '../common/overlays';
import { Badge, Kbd, Section, Segmented } from '../common/controls';
import { NumberField, ToggleField } from '../common/fields';
import { AddElementDialog } from './AddElementDialog';

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Strg';

function SettingsDialog() {
  const prefs = useAppStore((s) => s.prefs);
  const setPrefs = useAppStore((s) => s.setPrefs);
  const close = () => useAppStore.getState().openDialog(null);
  return (
    <Dialog title="Einstellungen" subtitle="Programmeinstellungen werden lokal im Browser gespeichert." onClose={close} width={560}>
      <Section title="Darstellung">
        <div className="field">
          <span className="field__label">Qualität</span>
          <div className="field__control field__control--flush">
            <Segmented<QualityLevel>
              size="sm"
              value={prefs.quality}
              onChange={(v) => setPrefs({ quality: v })}
              options={[
                { value: 'high', label: 'Hoch', tip: 'Glas-Transmission, Schatten, Bodenreflexion, bis 2× Pixeldichte' },
                { value: 'balanced', label: 'Ausgewogen', tip: 'Glas-Transmission und Schatten, ohne Bodenreflexion' },
                { value: 'performance', label: 'Leistung', tip: 'Einfache Transparenz, keine Schatten – für schwächere Grafik' },
              ]}
            />
          </div>
        </div>
        <ToggleField label="Objektinfo bei Maus-Hover" value={prefs.showHoverInfo} onChange={(v) => setPrefs({ showHoverInfo: v })} />
        <NumberField label="Gizmo-Größe" unit="none" step={0.05} decimals={2} min={0.4} max={2} value={prefs.gizmoSize} onChange={(v) => setPrefs({ gizmoSize: v })} />
      </Section>
      <Section title="Einheiten & Genauigkeit">
        <div className="field">
          <span className="field__label">Nachkommastellen (mm)</span>
          <div className="field__control field__control--flush">
            <Segmented
              size="sm"
              value={String(prefs.decimals)}
              onChange={(v) => setPrefs({ decimals: Number(v) as 1 | 2 | 3 })}
              options={[
                { value: '1', label: '0,0' },
                { value: '2', label: '0,00' },
                { value: '3', label: '0,000' },
              ]}
            />
          </div>
        </div>
        <NumberField label="Raster Verschieben" unit="mm" step={0.1} decimals={1} min={0.1} max={50} value={prefs.translationSnap} onChange={(v) => setPrefs({ translationSnap: v })} />
        <NumberField label="Raster Drehen" unit="deg" step={1} decimals={0} min={1} max={90} value={prefs.rotationSnap} onChange={(v) => setPrefs({ rotationSnap: v })} />
        <p className="insp-hint">Interne Einheit ist Millimeter. Weitere Anzeigeeinheiten (cm, m) sind im Einheitensystem vorbereitet.</p>
      </Section>
      <Section title="Module" defaultOpen={false}>
        <ul className="module-list">
          {MODULES.map((m) => (
            <li key={m.id}>
              <span>
                <strong>{m.title}</strong>
                <small>{m.description}</small>
              </span>
              {m.status === 'preview' ? <Badge tone="accent">Vorschau</Badge> : <Badge tone="dev">In Entwicklung</Badge>}
            </li>
          ))}
        </ul>
      </Section>
    </Dialog>
  );
}

function LoadDialog() {
  const [items, setItems] = useState(listSavedScenes);
  const loadSaved = useAppStore((s) => s.loadSaved);
  const currentId = useAppStore((s) => s.doc.id);
  const close = () => useAppStore.getState().openDialog(null);
  const fmt = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <Dialog title="Gespeicherte Szenen" subtitle="Lokal in diesem Browser gespeichert." onClose={close} width={560}>
      {items.length === 0 ? (
        <div className="insp-empty">
          <FolderOpen size={24} strokeWidth={1.4} />
          <p className="insp-empty__title">Noch keine gespeicherten Szenen</p>
          <p className="insp-empty__text">
            Über das Szenenmenü oder <Kbd>{MOD}</Kbd> + <Kbd>S</Kbd> speichern.
          </p>
        </div>
      ) : (
        <ul className="saved-list">
          {items.map((it) => (
            <li key={it.id} className={it.id === currentId ? 'is-current' : ''}>
              <button type="button" className="saved-list__main" onClick={() => loadSaved(it.id)}>
                <span className="saved-list__name">{it.name}</span>
                <span className="saved-list__meta">
                  {fmt.format(new Date(it.savedAt))} · {it.elementCount} Element{it.elementCount === 1 ? '' : 'e'}
                  {it.id === currentId ? ' · aktuell geöffnet' : ''}
                </span>
              </button>
              <button
                type="button"
                className="tree-act"
                data-tip="Gespeicherte Szene löschen"
                onClick={() => {
                  deleteSavedScene(it.id);
                  setItems(listSavedScenes());
                }}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

const SHORTCUTS: Array<[string, string[]]> = [
  ['Auswahl / Verschieben / Drehen', ['Q', 'W', 'E']],
  ['Einrasten umschalten (halten: invertieren)', ['S', '⇧']],
  ['Achsen Welt / Lokal', ['L']],
  ['Optisches Element hinzufügen', ['A']],
  ['Duplizieren', [MOD, 'D']],
  ['Löschen', ['Entf']],
  ['Rückgängig / Wiederholen', [MOD, 'Z', '⇧']],
  ['Speichern', [MOD, 'S']],
  ['Gespeicherte Szenen', [MOD, 'O']],
  ['Auswahl fokussieren', ['F']],
  ['Auge fokussieren / Szene fokussieren', ['G', 'H']],
  ['Kamera zurücksetzen', ['Pos1']],
  ['Front / Seite / Oben', ['1', '3', '7']],
  ['Perspektive ↔ Ortho', ['5']],
  ['Augenansicht Normal ↔ Schnitt', ['X']],
  ['Bemaßung ein/aus', ['M']],
  ['Strahlengang ein/aus · Live pausieren', ['T', 'Leertaste']],
  ['Seitenleisten', ['[', ']']],
  ['Auswahl aufheben / Dialog schließen', ['Esc']],
];

function ShortcutsDialog() {
  const close = () => useAppStore.getState().openDialog(null);
  return (
    <Dialog title="Tastenkürzel" onClose={close} width={560}>
      <ul className="help-list help-list--wide">
        {SHORTCUTS.map(([label, keys]) => (
          <li key={label}>
            <span>{label}</span>
            <span>
              {keys.map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
      <h4 className="help-sub">Maus</h4>
      <ul className="help-list help-list--wide">
        <li><span>Objekt auswählen</span><span><Kbd>Linksklick</Kbd></span></li>
        <li><span>Kamera drehen</span><span><Kbd>Rechte Taste</Kbd> oder <Kbd>Alt</Kbd> + links</span></li>
        <li><span>Kamera verschieben</span><span><Kbd>Mittlere Taste</Kbd> oder <Kbd>⇧</Kbd> + links</span></li>
        <li><span>Zoom (zum Mauszeiger)</span><span><Kbd>Mausrad</Kbd></span></li>
        <li><span>Wert fein / grob scrubben</span><span><Kbd>Alt</Kbd> / <Kbd>⇧</Kbd> + Feldname ziehen</span></li>
      </ul>
    </Dialog>
  );
}

export function Dialogs() {
  const dialog = useAppStore((s) => s.dialog);
  switch (dialog) {
    case 'add-element':
      return <AddElementDialog />;
    case 'settings':
      return <SettingsDialog />;
    case 'load':
      return <LoadDialog />;
    case 'shortcuts':
      return <ShortcutsDialog />;
    default:
      return null;
  }
}
