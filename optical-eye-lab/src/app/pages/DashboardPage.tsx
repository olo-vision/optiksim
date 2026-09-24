/**
 * Dashboard: Begrüßung, Schnellaktionen, zuletzt verwendet, Favoriten, Vorlagen & Lernszenarien.
 */
import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight, Clock, FilePlus2, FolderOpen, LayoutTemplate, Settings, Star, Upload } from 'lucide-react';
import { useSession } from '../session';
import { Button, EmptyState, PageHeader } from '@/ui/ds';
import { openAppDialog, pickImportFiles } from '../library/actions';
import { SimulationCard, TemplateGlyph } from '../library/visuals';
import { querySimulations } from '@/platform/library';
import { CATEGORY_LABELS } from '@/platform/models';
import { roleLabel } from '@/platform/permissions';
import { usePageTitle } from '../usePageTitle';

function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 11 ? 'Guten Morgen' : h < 18 ? 'Willkommen' : 'Guten Abend';
}

export function DashboardPage() {
  usePageTitle('Dashboard');
  const user = useSession((s) => s.user)!;
  const org = useSession((s) => s.org);
  const sims = useSession((s) => s.sims);
  const templates = useSession((s) => s.templates);
  const navigate = useNavigate();

  const recent = useMemo(() => querySimulations(sims, { scope: 'recent' }).slice(0, 4), [sims]);
  const favorites = useMemo(() => querySimulations(sims, { scope: 'favorites' }).slice(0, 4), [sims]);
  const latest = useMemo(() => querySimulations(sims, { sort: 'updated' }).slice(0, 4), [sims]);
  const featured = useMemo(() => {
    const ids = org?.featuredTemplateIds ?? [];
    const f = ids.map((id) => templates.find((t) => t.id === id)).filter((t): t is NonNullable<typeof t> => !!t);
    const rest = templates.filter((t) => !ids.includes(t.id));
    return [...f, ...rest].slice(0, 6);
  }, [templates, org]);
  const active = sims.filter((m) => !m.archived);

  const quick = [
    { icon: FilePlus2, label: 'Neue Simulation', desc: 'Leer oder aus Vorlage', onClick: () => openAppDialog({ kind: 'new-simulation' }), primary: true },
    { icon: FolderOpen, label: 'Meine Simulationen', desc: `${active.length} gespeichert`, onClick: () => navigate('/simulations') },
    { icon: LayoutTemplate, label: 'Vorlagen', desc: `${templates.length} verfügbar`, onClick: () => navigate('/templates') },
    { icon: Upload, label: 'Importieren', desc: '.opticsim oder .json', onClick: () => pickImportFiles() },
    { icon: Settings, label: 'Einstellungen', desc: 'Darstellung, Grafik, Optik', onClick: () => navigate('/settings') },
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow={
          <>
            {roleLabel(user.role, org?.type)}
            {org ? ` · ${org.name}` : ''}
          </>
        }
        title={
          <>
            {greeting()}, {user.firstName || user.displayName}
          </>
        }
        subtitle={active.length ? `Du hast ${active.length} Simulation${active.length === 1 ? '' : 'en'} in deiner Bibliothek.` : 'Lege deine erste Simulation an – leer oder aus einer Vorlage.'}
        actions={
          <Button variant="primary" icon={FilePlus2} onClick={() => openAppDialog({ kind: 'new-simulation' })}>
            Neue Simulation
          </Button>
        }
      />

      <section className="quick-grid" aria-label="Schnellaktionen">
        {quick.map((q) => (
          <button key={q.label} type="button" className={`quick-card${q.primary ? ' quick-card--primary' : ''}`} onClick={q.onClick}>
            <span className="quick-card__icon">
              <q.icon size={19} strokeWidth={1.7} />
            </span>
            <span className="quick-card__label">{q.label}</span>
            <span className="quick-card__desc">{q.desc}</span>
          </button>
        ))}
      </section>

      <section className="page-section">
        <div className="page-section__head">
          <h2 className="page-section__title">
            <Clock size={16} /> Zuletzt verwendet
          </h2>
          {sims.length > 0 && (
            <Button size="sm" variant="ghost" iconRight={ArrowRight} onClick={() => navigate('/simulations')}>
              Alle Simulationen
            </Button>
          )}
        </div>
        {recent.length ? (
          <div className="sim-grid">
            {recent.map((m) => (
              <SimulationCard key={m.id} meta={m} />
            ))}
          </div>
        ) : latest.length ? (
          <div className="sim-grid">
            {latest.map((m) => (
              <SimulationCard key={m.id} meta={m} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={FolderOpen}
            title="Noch keine Simulationen"
            text="Starte mit einer Vorlage wie „Myopie“ oder „Torische Kontaktlinse“ und passe sie an."
            action={
              <Button variant="primary" icon={FilePlus2} onClick={() => openAppDialog({ kind: 'new-simulation' })}>
                Erste Simulation anlegen
              </Button>
            }
          />
        )}
      </section>

      {favorites.length > 0 && (
        <section className="page-section">
          <div className="page-section__head">
            <h2 className="page-section__title">
              <Star size={16} /> Favoriten
            </h2>
          </div>
          <div className="sim-grid">
            {favorites.map((m) => (
              <SimulationCard key={m.id} meta={m} />
            ))}
          </div>
        </section>
      )}

      <section className="page-section">
        <div className="page-section__head">
          <h2 className="page-section__title">
            <LayoutTemplate size={16} /> Vorlagen & Lernszenarien
          </h2>
          <Button size="sm" variant="ghost" iconRight={ArrowRight} onClick={() => navigate('/templates')}>
            Alle Vorlagen
          </Button>
        </div>
        <div className="tpl-grid">
          {featured.map((t) => (
            <button key={t.id} type="button" className="tpl-card" onClick={() => openAppDialog({ kind: 'new-simulation', templateId: t.id })}>
              <TemplateGlyph category={t.category} size={20} />
              <span className="tpl-card__text">
                <span className="tpl-card__name">{t.name}</span>
                <span className="tpl-card__cat">{CATEGORY_LABELS[t.category]}</span>
                <span className="tpl-card__desc">{t.description}</span>
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
