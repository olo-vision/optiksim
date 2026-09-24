/**
 * Rechte Seitenleiste: kontextabhängiger Inspector.
 */
import { MousePointerClick, PanelRightClose } from 'lucide-react';
import { useAppStore, findEntity } from '@/state/store';
import { ROOM_ID } from '@/model/types';
import { TextField } from '../common/fields';
import { Kbd, Section } from '../common/controls';
import { ElementInspector } from './ElementInspector';
import { LensInspector } from './LensInspector';
import { EyeInspector } from './EyeInspector';
import { LightInspector, MeasurePointInspector, RoomInspector } from './OtherInspectors';

function EmptyInspector() {
  const name = useAppStore((s) => s.doc.name);
  const setSceneName = useAppStore((s) => s.setSceneName);
  return (
    <>
      <div className="insp-empty">
        <MousePointerClick size={26} strokeWidth={1.4} />
        <p className="insp-empty__title">Kein Objekt ausgewählt</p>
        <p className="insp-empty__text">Objekt in der Szene oder im Szenenbaum anklicken, um seine Eigenschaften zu bearbeiten.</p>
      </div>
      <Section title="Szene">
        <TextField label="Name" value={name} onChange={setSceneName} />
      </Section>
      <Section title="Bedienung">
        <ul className="help-list">
          <li><span>Auswählen</span><span><Kbd>Linksklick</Kbd></span></li>
          <li><span>Kamera drehen</span><span><Kbd>Rechte Maustaste</Kbd></span></li>
          <li><span>Kamera verschieben</span><span><Kbd>Mittlere Maustaste</Kbd></span></li>
          <li><span>Zoomen</span><span><Kbd>Mausrad</Kbd></span></li>
          <li><span>Trackpad: drehen / schieben</span><span><Kbd>Alt</Kbd> / <Kbd>⇧</Kbd> + ziehen</span></li>
          <li><span>Werte scrubben</span><span>Feldname ziehen</span></li>
        </ul>
      </Section>
    </>
  );
}

export function Inspector() {
  const selectedId = useAppStore((s) => s.selectedId);
  const entity = useAppStore((s) => findEntity(s.doc, s.selectedId));
  const togglePanel = useAppStore((s) => s.togglePanel);

  let body;
  if (selectedId === ROOM_ID) body = <RoomInspector />;
  else if (!entity) body = <EmptyInspector />;
  else if (entity.entityType === 'eye') body = <EyeInspector eye={entity} />;
  else if (entity.entityType === 'element' && entity.family === 'lens') body = <LensInspector key={entity.id} el={entity} />;
  else if (entity.entityType === 'element') body = <ElementInspector key={entity.id} el={entity} />;
  else if (entity.entityType === 'light') body = <LightInspector key={entity.id} light={entity} />;
  else body = <MeasurePointInspector key={entity.id} point={entity} />;

  return (
    <aside className="panel panel--right">
      <header className="panel__header">
        <span className="panel__title">Inspector</span>
        <button type="button" className="tree-act" onClick={() => togglePanel('right')} data-tip="Inspector ausblenden  ·  ]" data-tip-side="left">
          <PanelRightClose size={15} />
        </button>
      </header>
      <div className="panel__scroll">{body}</div>
    </aside>
  );
}
