/**
 * Vorlagen: eingebaute Lernszenarien sowie eigene und Organisations-Vorlagen.
 */
import { useMemo, useState } from 'react';
import { FilePlus2, LayoutTemplate, Lock, SearchX, Trash2, Users } from 'lucide-react';
import { useSession, runAction } from '../session';
import { platform } from '../platformInstance';
import { Button, EmptyState, PageHeader, Pill, SearchInput } from '@/ui/ds';
import { openAppDialog } from '../library/actions';
import { TemplateGlyph, relativeTime } from '../library/visuals';
import { CATEGORY_LABELS, type SimulationCategory, type Template } from '@/platform/models';
import { confirmDialog } from '@/ui/ds/modals';
import { can } from '@/platform/permissions';
import { usePageTitle } from '../usePageTitle';

export function TemplatesPage() {
  usePageTitle('Vorlagen');
  const user = useSession((s) => s.user)!;
  const templates = useSession((s) => s.templates);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<SimulationCategory | 'all'>('all');
  const match = (t: Template) => {
    if (cat !== 'all' && t.category !== cat) return false;
    const s = q.trim().toLowerCase();
    return !s || [t.name, t.description, ...t.tags, CATEGORY_LABELS[t.category]].join(' ').toLowerCase().includes(s);
  };
  const builtin = useMemo(() => templates.filter((t) => t.visibility === 'builtin' && match(t)), [templates, q, cat]); // eslint-disable-line react-hooks/exhaustive-deps
  const own = useMemo(() => templates.filter((t) => t.visibility !== 'builtin' && match(t)), [templates, q, cat]); // eslint-disable-line react-hooks/exhaustive-deps

  const remove = async (t: Template) => {
    const ok = await confirmDialog({ title: 'Vorlage löschen?', message: `„${t.name}“ wird entfernt. Bereits erstellte Simulationen bleiben erhalten.`, confirmLabel: 'Löschen', tone: 'danger' });
    if (ok) await runAction((u) => platform.library.deleteTemplate(u, t.id), 'Vorlage gelöscht');
  };

  const Card = ({ t }: { t: Template }) => (
    <div className="tpl-card tpl-card--static" data-template-id={t.id}>
      <TemplateGlyph category={t.category} size={20} />
      <div className="tpl-card__text">
        <span className="tpl-card__name">
          {t.name}
          {t.visibility === 'organization' && <Pill icon={Users}>Organisation</Pill>}
          {t.visibility === 'private' && <Pill icon={Lock}>Privat</Pill>}
        </span>
        <span className="tpl-card__cat">
          {CATEGORY_LABELS[t.category]}
          {t.visibility !== 'builtin' && ` · ${relativeTime(t.createdAt)}`}
        </span>
        <span className="tpl-card__desc">{t.description || 'Ohne Beschreibung'}</span>
        <div className="tpl-card__actions">
          <Button size="sm" variant="primary" icon={FilePlus2} onClick={() => openAppDialog({ kind: 'new-simulation', templateId: t.id })}>
            Simulation erstellen
          </Button>
          {t.visibility !== 'builtin' && (t.createdBy === user.id || user.role === 'admin') && (
            <Button size="sm" variant="ghost" icon={Trash2} onClick={() => void remove(t)} aria-label={`Vorlage ${t.name} löschen`} />
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="page">
      <PageHeader title="Vorlagen" subtitle="Ausgangspunkte für neue Simulationen – von der Emmetropie bis zur Tränenlinse." />
      <div className="lib-toolbar">
        <SearchInput value={q} onChange={setQ} placeholder="Vorlagen durchsuchen …" />
        <select className="ds-input ds-select ds-select--inline" aria-label="Kategorie" value={cat} onChange={(e) => setCat(e.target.value as SimulationCategory | 'all')}>
          <option value="all">Alle Kategorien</option>
          {(Object.keys(CATEGORY_LABELS) as SimulationCategory[]).map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
      </div>

      <section className="page-section">
        <div className="page-section__head">
          <h2 className="page-section__title">Eigene & Organisation</h2>
        </div>
        {own.length ? (
          <div className="tpl-grid">
            {own.map((t) => (
              <Card key={t.id} t={t} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={LayoutTemplate}
            title={q || cat !== 'all' ? 'Keine passenden eigenen Vorlagen' : 'Noch keine eigenen Vorlagen'}
            text={
              can(user, 'templates.create')
                ? 'Öffne eine Simulation und wähle im Simulationsmenü „Als Vorlage speichern“ – oder nutze das Kartenmenü in „Meine Simulationen“.'
                : 'Eigene Vorlagen können Trainer/innen und Administrator/innen anlegen. Vorlagen deiner Organisation erscheinen hier automatisch.'
            }
          />
        )}
      </section>

      <section className="page-section">
        <div className="page-section__head">
          <h2 className="page-section__title">Lernszenarien & Standardvorlagen</h2>
        </div>
        {builtin.length ? (
          <div className="tpl-grid">
            {builtin.map((t) => (
              <Card key={t.id} t={t} />
            ))}
          </div>
        ) : (
          <EmptyState icon={SearchX} title="Keine Treffer" text="Passe Suche oder Kategorie an." />
        )}
      </section>
    </div>
  );
}
