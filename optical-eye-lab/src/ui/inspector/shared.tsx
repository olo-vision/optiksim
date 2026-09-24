/**
 * Gemeinsame Inspector-Bausteine: Kopfbereich, Transformation, Info-Karte, Schema-Felder.
 */
import type { ReactNode } from 'react';
import { Eye, EyeOff, Lock, LockOpen, Sigma } from 'lucide-react';
import type { SceneEntity, Transform } from '@/model/types';
import type { FieldGroup } from '@/model/fieldSchema';
import { getPath } from '@/model/fieldSchema';
import type { InfoCard } from '@/model/derived/infoCards';
import { useAppStore } from '@/state/store';
import { Badge, Section } from '../common/controls';
import { ColorField, NumberField, SelectField, TextField, ToggleField, Vec3Field } from '../common/fields';

export function InspectorHeader({ entity, typeLabel, icon }: { entity: SceneEntity; typeLabel: string; icon?: ReactNode }) {
  const { renameEntity, setEntityFlag } = useAppStore.getState();
  return (
    <div className="insp-header">
      <div className="insp-header__top">
        {icon && <span className="insp-header__icon">{icon}</span>}
        <span className="insp-header__type">{typeLabel}</span>
        <span className="insp-header__flags">
          <button type="button" className={`tree-act${entity.locked ? ' is-on' : ''}`} onClick={() => setEntityFlag(entity.id, 'locked', !entity.locked)} data-tip={entity.locked ? 'Entsperren' : 'Sperren'}>
            {entity.locked ? <Lock size={14} /> : <LockOpen size={14} />}
          </button>
          <button type="button" className={`tree-act${!entity.visible ? ' is-on' : ''}`} onClick={() => setEntityFlag(entity.id, 'visible', !entity.visible)} data-tip={entity.visible ? 'Ausblenden' : 'Einblenden'}>
            {entity.visible ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
        </span>
      </div>
      <TextField label="Name" value={entity.name} onChange={(v) => renameEntity(entity.id, v)} />
      {entity.locked && <div className="insp-note">Objekt ist gesperrt – Position und Parameter sind schreibgeschützt.</div>}
    </div>
  );
}

export function TransformSection({ entity, rotation = true, scale = false, children }: { entity: SceneEntity; rotation?: boolean; scale?: boolean; children?: ReactNode }) {
  const setTransform = useAppStore((s) => s.setTransform);
  const decimals = useAppStore((s) => s.prefs.decimals);
  const t: Transform = entity.transform;
  const locked = entity.locked;
  return (
    <Section title="Transformation">
      <Vec3Field label="Position" unit="mm" step={0.5} decimals={decimals} value={t.position} disabled={locked} onChange={(v) => setTransform(entity.id, { position: v })} />
      {rotation && <Vec3Field label="Rotation" unit="deg" step={1} decimals={1} value={t.rotation} disabled={locked} onChange={(v) => setTransform(entity.id, { rotation: v })} />}
      {scale && <Vec3Field label="Skalierung" unit="none" step={0.05} decimals={2} value={t.scale} disabled={locked} onChange={(v) => setTransform(entity.id, { scale: v.map((x) => Math.max(0.01, x)) as [number, number, number] })} />}
      {children}
    </Section>
  );
}

export function InfoCardView({ card }: { card: InfoCard }) {
  return (
    <div className="info-card">
      <div className="info-card__head">
        <div>
          <div className="info-card__title">{card.title}</div>
          {card.subtitle && <div className="info-card__subtitle">{card.subtitle}</div>}
        </div>
      </div>
      <dl className="info-card__rows">
        {card.rows.map((r) => (
          <div key={r.label} className="info-card__row">
            <dt>{r.label}</dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
      <button type="button" className="btn btn--ghost btn--block" disabled data-tip="Lernmodus: Formeln und Herleitungen mit den aktuellen Werten – folgt in einer späteren Phase" data-tip-side="top">
        <Sigma size={14} />
        <span>Mathematisch erklären</span>
        <Badge tone="dev">In Entwicklung</Badge>
      </button>
    </div>
  );
}

/** Rendert deklarative Feldgruppen aus der Element-Registry. */
export function SchemaFields<T>({ entity, groups, onChange, disabled }: { entity: T; groups: FieldGroup<T>[]; onChange: (path: string, value: unknown) => void; disabled?: boolean }) {
  return (
    <>
      {groups.map((g) => (
        <Section key={g.id} title={g.title}>
          {g.fields
            .filter((f) => !f.visibleIf || f.visibleIf(entity))
            .map((f) => {
              const v = getPath(entity, f.path);
              switch (f.type) {
                case 'number':
                  return (
                    <NumberField
                      key={f.path}
                      label={f.label}
                      value={Number(v ?? 0)}
                      unit={f.unit}
                      min={f.min}
                      max={f.max}
                      step={f.step}
                      decimals={f.decimals}
                      zeroMeansInfinity={f.zeroMeansInfinity}
                      hint={f.hint}
                      disabled={disabled || f.readOnly}
                      onChange={(nv) => onChange(f.path, nv)}
                    />
                  );
                case 'select':
                  return <SelectField key={f.path} label={f.label} value={String(v)} options={f.options} disabled={disabled} hint={f.hint} onChange={(nv) => onChange(f.path, nv)} />;
                case 'toggle':
                  return <ToggleField key={f.path} label={f.label} value={Boolean(v)} disabled={disabled} onChange={(nv) => onChange(f.path, nv)} />;
                case 'color':
                  return <ColorField key={f.path} label={f.label} value={String(v)} onChange={(nv) => onChange(f.path, nv)} />;
              }
            })}
        </Section>
      ))}
    </>
  );
}
