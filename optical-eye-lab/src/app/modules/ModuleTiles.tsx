/**
 * Modul-Kacheln (Phase 5) – gemeinsam für Dashboard und Modulübersicht.
 * Aktive Module öffnen /modules/:id (letzte Sitzung oder neue), geplante sind deaktiviert („In Entwicklung“).
 */
import { useNavigate } from 'react-router';
import { ArrowRight, Box, Clock } from 'lucide-react';
import { MODULES, type ModuleDefinition } from '@/modules/registry';
import { useSession } from '../session';
import { moduleSessions } from './moduleSessions';

export function ModuleTile({ mod, compact }: { mod: ModuleDefinition; compact?: boolean }) {
  const navigate = useNavigate();
  const sims = useSession((s) => s.sims);
  const planned = mod.status === 'planned';
  const sessions = planned ? [] : moduleSessions(sims, mod.id);
  return (
    <button
      type="button"
      className={`module-tile${planned ? ' is-planned' : ''}${compact ? ' module-tile--compact' : ''}`}
      disabled={planned}
      aria-disabled={planned}
      onClick={() => navigate(`/modules/${mod.id}`)}
      data-testid={`module-tile-${mod.id}`}
    >
      <span className="module-tile__icon">
        <mod.icon size={compact ? 18 : 22} strokeWidth={1.7} />
      </span>
      <span className="module-tile__text">
        <span className="module-tile__title">
          {mod.title}
          {planned && <span className="module-tile__badge">In Entwicklung</span>}
        </span>
        <span className="module-tile__desc">{mod.tagline}</span>
        {!compact && !planned && (
          <span className="module-tile__meta">
            {sessions.length ? (
              <>
                <Clock size={12} /> {sessions.length} Sitzung{sessions.length === 1 ? '' : 'en'} · weiter mit „{sessions[0].name}“
              </>
            ) : (
              'Neue Sitzung starten'
            )}
          </span>
        )}
      </span>
      {!planned && <ArrowRight size={16} className="module-tile__go" />}
    </button>
  );
}

/** Einstiegskarte „Vollständiger Simulator“ */
export function SimulatorTile({ onNew, lastId, lastName }: { onNew: () => void; lastId?: string; lastName?: string }) {
  const navigate = useNavigate();
  return (
    <div className="module-tile module-tile--simulator" data-testid="simulator-tile">
      <span className="module-tile__icon">
        <Box size={24} strokeWidth={1.6} />
      </span>
      <span className="module-tile__text">
        <span className="module-tile__title">Vollständiger Simulator</span>
        <span className="module-tile__desc">Freie 3D-Szene mit allen Elementen, Werkzeugen und Arbeitsbereichen.</span>
        <span className="module-tile__actions">
          <button type="button" className="btn btn--accent" onClick={onNew}>
            Neue Simulation
          </button>
          {lastId && (
            <button type="button" className="btn btn--ghost" onClick={() => navigate(`/simulations/${lastId}`)} title={lastName}>
              Zuletzt: {lastName}
            </button>
          )}
        </span>
      </span>
    </div>
  );
}

export function ModuleGrid({ modules = MODULES, compact }: { modules?: ModuleDefinition[]; compact?: boolean }) {
  return (
    <div className={`module-grid${compact ? ' module-grid--compact' : ''}`}>
      {modules.map((m) => (
        <ModuleTile key={m.id} mod={m} compact={compact} />
      ))}
    </div>
  );
}
