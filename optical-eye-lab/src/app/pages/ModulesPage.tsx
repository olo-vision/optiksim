/**
 * Modulübersicht (/modules) und Einstieg (/modules/:moduleId) – Phase 5.
 * Der Einstieg öffnet die zuletzt verwendete Sitzung des Moduls oder legt eine neue an.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Boxes, FileQuestion, Hammer } from 'lucide-react';
import { findModule, MODULE_GROUPS, MODULES } from '@/modules/registry';
import { Button, EmptyState, PageHeader } from '@/ui/ds';
import { usePageTitle } from '../usePageTitle';
import { ModuleGrid } from '../modules/ModuleTiles';
import { resolveModuleSession } from '../modules/moduleSessions';
import { errorMessage } from '../session';

export function ModulesPage() {
  usePageTitle('Module');
  return (
    <div className="page">
      <PageHeader
        eyebrow="Fachmodule"
        title={
          <>
            <Boxes size={22} /> Module
          </>
        }
        subtitle="Jedes Modul ist ein fokussierter Arbeitsbereich zu einem Thema. Alle Module rechnen mit derselben Physik und lassen sich jederzeit im vollständigen Simulator weiterbearbeiten."
      />
      {MODULE_GROUPS.map((g) => {
        const list = MODULES.filter((m) => m.group === g);
        if (!list.length) return null;
        return (
          <section key={g} className="page-section">
            <div className="page-section__head">
              <h2 className="page-section__title">{g}</h2>
            </div>
            <ModuleGrid modules={list} />
          </section>
        );
      })}
    </div>
  );
}

/** /modules/:moduleId → letzte Sitzung oder neue Sitzung; geplante Module zeigen einen Hinweis. */
export function ModuleEntryRoute() {
  const { moduleId = '' } = useParams();
  const navigate = useNavigate();
  const mod = findModule(moduleId);
  const [error, setError] = useState<string | null>(null);
  const started = useRef<string | null>(null);
  usePageTitle(mod?.title ?? 'Modul');
  useEffect(() => {
    if (!mod || mod.status === 'planned' || started.current === moduleId) return;
    started.current = moduleId;
    resolveModuleSession(moduleId)
      .then((simId) => navigate(`/modules/${moduleId}/${simId}`, { replace: true }))
      .catch((e) => setError(errorMessage(e)));
  }, [mod, moduleId, navigate]);

  if (!mod)
    return (
      <div className="page-center">
        <EmptyState icon={FileQuestion} title="Modul nicht gefunden" text="Diese Adresse gehört zu keinem Modul." action={<Button onClick={() => navigate('/modules')}>Zur Modulübersicht</Button>} />
      </div>
    );
  if (mod.status === 'planned')
    return (
      <div className="page-center">
        <EmptyState
          icon={Hammer}
          title={`${mod.title} – in Entwicklung`}
          text={<>{mod.description} Das Modul ist in der Architektur bereits vorgesehen und erscheint hier, sobald es fertig ist.</>}
          action={<Button onClick={() => navigate('/modules')}>Zur Modulübersicht</Button>}
        />
      </div>
    );
  if (error)
    return (
      <div className="page-center">
        <EmptyState icon={FileQuestion} title="Modul konnte nicht geöffnet werden" text={error} action={<Button onClick={() => navigate('/modules')}>Zur Modulübersicht</Button>} />
      </div>
    );
  return (
    <div className="page-center">
      <p className="muted">{mod.title} wird geöffnet …</p>
    </div>
  );
}
