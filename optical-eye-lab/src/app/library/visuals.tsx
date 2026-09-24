/**
 * Darstellungsbausteine der Bibliothek: Kategorie-Symbol, Vorschaubild, Simulationskarte, relative Zeit.
 */
import { memo, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import type { LucideIcon } from 'lucide-react';
import {
  Archive,
  ArchiveRestore,
  CircleDot,
  Copy,
  Download,
  Droplet,
  Eye,
  Glasses,
  GraduationCap,
  LayoutTemplate,
  MoreHorizontal,
  Orbit,
  Pencil,
  Presentation,
  Shapes,
  Star,
  Trash2,
  UserRound,
} from 'lucide-react';
import { CATEGORY_LABELS, type SimulationCategory, type SimulationMetadata } from '@/platform/models';
import { platform } from '../platformInstance';
import { currentUser, useSession } from '../session';
import { can } from '@/platform/permissions';
import { Menu } from '@/ui/common/overlays';
import { Pill } from '@/ui/ds';
import { deleteSimulation, duplicateSimulation, exportSimulation, openAppDialog, renameSimulation, setArchived, setFavorite } from './actions';

export const CATEGORY_ICONS: Record<SimulationCategory, LucideIcon> = {
  refraction: Eye,
  spectacles: Glasses,
  'contact-lens': CircleDot,
  astigmatism: Orbit,
  'tear-lens': Droplet,
  demonstration: Presentation,
  training: GraduationCap,
  custom: UserRound,
  other: Shapes,
};

export function TemplateGlyph({ category, size = 18 }: { category: SimulationCategory; size?: number }) {
  const Icon = CATEGORY_ICONS[category] ?? Shapes;
  return (
    <span className={`tpl-glyph tpl-glyph--${category}`}>
      <Icon size={size} strokeWidth={1.6} />
    </span>
  );
}

const rtf = new Intl.RelativeTimeFormat('de-DE', { numeric: 'auto' });
const dtf = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' });

export function relativeTime(iso: string | undefined, now = Date.now()): string {
  if (!iso) return '–';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '–';
  const s = Math.round((t - now) / 1000);
  const a = Math.abs(s);
  if (a < 45) return 'gerade eben';
  if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (a < 86400 * 7) return rtf.format(Math.round(s / 86400), 'day');
  return dtf.format(new Date(t));
}

/** Vorschaubild; lädt das gespeicherte Bild, sonst eine Kategorie-Grafik. */
export const SimThumbnail = memo(function SimThumbnail({ meta }: { meta: SimulationMetadata }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (meta.hasThumbnail)
      platform.library
        .thumbnail(meta.id)
        .then((s) => alive && setSrc(s))
        .catch(() => undefined);
    else setSrc(null);
    return () => {
      alive = false;
    };
  }, [meta.id, meta.hasThumbnail, meta.updatedAt]);
  if (src) return <img className="sim-thumb" src={src} alt="" loading="lazy" draggable={false} />;
  const Icon = CATEGORY_ICONS[meta.category] ?? Shapes;
  return (
    <div className={`sim-thumb sim-thumb--placeholder tpl-glyph--${meta.category}`}>
      <svg viewBox="0 0 160 100" preserveAspectRatio="none" className="sim-thumb__rays" aria-hidden>
        {[30, 40, 50, 60, 70].map((y) => (
          <path key={y} d={`M0 ${y} L95 ${y} L150 50`} />
        ))}
      </svg>
      <Icon size={28} strokeWidth={1.3} />
    </div>
  );
});

export function SimulationActionsMenu({ meta, onChanged }: { meta: SimulationMetadata; onChanged?: () => void }) {
  const navigate = useNavigate();
  const canTemplate = can(useSession((s) => s.user), 'templates.create');
  return (
    <Menu
      align="right"
      width={230}
      label={`Aktionen für ${meta.name}`}
      trigger={(open) => (
        <button type="button" className={`card-more${open ? ' is-open' : ''}`} aria-label={`Aktionen für ${meta.name}`} onClick={(e) => e.stopPropagation()}>
          <MoreHorizontal size={16} />
        </button>
      )}
      items={[
        { label: 'Öffnen', icon: Eye, onSelect: () => navigate(`/simulations/${meta.id}`) },
        { label: 'Duplizieren', icon: Copy, onSelect: () => void duplicateSimulation(meta).then(onChanged) },
        { label: 'Umbenennen', icon: Pencil, onSelect: () => void renameSimulation(meta).then(onChanged) },
        { label: 'Exportieren', icon: Download, description: 'Als .opticsim-Datei', onSelect: () => void exportSimulation(meta) },
        {
          label: 'Als Vorlage speichern',
          icon: LayoutTemplate,
          disabled: !canTemplate,
          description: canTemplate ? undefined : 'Für Trainer/innen und Administration',
          onSelect: async () => {
            const rec = await platform.library.get(currentUser(), meta.id);
            if (rec) openAppDialog({ kind: 'save-template', doc: rec.doc, meta });
          },
        },
        { label: meta.favorite ? 'Aus Favoriten entfernen' : 'Zu Favoriten', icon: Star, onSelect: () => void setFavorite(meta, !meta.favorite) },
        { label: meta.archived ? 'Wiederherstellen' : 'Archivieren', icon: meta.archived ? ArchiveRestore : Archive, onSelect: () => void setArchived(meta, !meta.archived) },
        { separator: true, label: '' },
        { label: 'Löschen', icon: Trash2, danger: true, onSelect: () => void deleteSimulation(meta).then(onChanged) },
      ]}
    />
  );
}

export function SimulationCard({ meta, ownerName }: { meta: SimulationMetadata; ownerName?: string }) {
  const navigate = useNavigate();
  const open = () => navigate(`/simulations/${meta.id}`);
  return (
    <article
      className={`sim-card${meta.archived ? ' is-archived' : ''}`}
      data-sim-id={meta.id}
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter') open();
      }}
      aria-label={`Simulation ${meta.name} öffnen`}
    >
      <div className="sim-card__media">
        <SimThumbnail meta={meta} />
        <button
          type="button"
          className={`sim-card__fav${meta.favorite ? ' is-on' : ''}`}
          aria-label={meta.favorite ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen'}
          aria-pressed={meta.favorite}
          onClick={(e) => {
            e.stopPropagation();
            void setFavorite(meta, !meta.favorite);
          }}
        >
          <Star size={15} strokeWidth={1.9} />
        </button>
        <span className="sim-card__cat">{CATEGORY_LABELS[meta.category]}</span>
      </div>
      <div className="sim-card__body">
        <div className="sim-card__title-row">
          <h3 className="sim-card__title" title={meta.name}>
            {meta.name}
          </h3>
          <SimulationActionsMenu meta={meta} />
        </div>
        <p className="sim-card__rx">
          {meta.summary.eyeRx}
          {meta.summary.elementCount > 0 && ` · ${meta.summary.elementKinds.slice(0, 2).join(', ')}${meta.summary.elementKinds.length > 2 ? ' …' : ''}`}
        </p>
        <div className="sim-card__meta">
          <span>Geändert {relativeTime(meta.updatedAt)}</span>
          {ownerName && <span>· {ownerName}</span>}
        </div>
        {(meta.tags.length > 0 || meta.summary.highlights.length > 0) && (
          <div className="tag-row">
            {meta.summary.highlights.slice(0, 2).map((h) => (
              <Pill key={h} tone="accent">
                {h}
              </Pill>
            ))}
            {meta.tags.slice(0, 3).map((t) => (
              <Pill key={t}>{t}</Pill>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
