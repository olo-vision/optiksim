/**
 * Simulationsbibliothek: Suche, Filter, Sortierung, Raster-/Listenansicht, Import/Export (auch per Drag & Drop).
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Download, FilePlus2, FolderOpen, LayoutGrid, List, SearchX, Star, Upload } from 'lucide-react';
import { useSession } from '../session';
import { platform } from '../platformInstance';
import { Button, EmptyState, PageHeader, Pill, SearchInput, Tabs } from '@/ui/ds';
import { exportLibrary, importFiles, openAppDialog, pickImportFiles, setFavorite } from '../library/actions';
import { SimulationActionsMenu, SimulationCard, relativeTime, TemplateGlyph } from '../library/visuals';
import { querySimulations, type LibraryScope, type LibrarySort } from '@/platform/library';
import { CATEGORY_LABELS, type SimulationCategory } from '@/platform/models';
import { can } from '@/platform/permissions';
import { usePageTitle } from '../usePageTitle';

const SORTS: Array<{ value: LibrarySort; label: string }> = [
  { value: 'updated', label: 'Zuletzt geändert' },
  { value: 'opened', label: 'Zuletzt geöffnet' },
  { value: 'created', label: 'Erstellt' },
  { value: 'name', label: 'Name A–Z' },
];

const VIEW_KEY = 'oel:ui:library-view';

export function LibraryPage() {
  usePageTitle('Meine Simulationen');
  const user = useSession((s) => s.user)!;
  const sims = useSession((s) => s.sims);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [ownerNames, setOwnerNames] = useState<Record<string, string>>({});
  const [view, setView] = useState<'grid' | 'list'>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid';
    } catch {
      return 'grid';
    }
  });
  const [dragOver, setDragOver] = useState(false);
  const viewAll = can(user, 'simulations.viewAll');

  const text = params.get('q') ?? '';
  const scope = (params.get('scope') as LibraryScope) || 'all';
  const category = (params.get('cat') as SimulationCategory | 'all') || 'all';
  const sort = (params.get('sort') as LibrarySort) || 'updated';
  const tag = params.get('tag') ?? '';

  const setParam = (k: string, v: string, def = '') => {
    const next = new URLSearchParams(params);
    if (!v || v === def) next.delete(k);
    else next.set(k, v);
    setParams(next, { replace: true });
  };

  useEffect(() => {
    if (!viewAll) return;
    void platform.repos.listUsers().then((us) => setOwnerNames(Object.fromEntries(us.map((u) => [u.id, u.displayName]))));
  }, [viewAll]);

  const results = useMemo(() => querySimulations(sims, { text, scope, category, sort, tag: tag || undefined }, user.id), [sims, text, scope, category, sort, tag, user.id]);
  const counts = useMemo(
    () => ({
      all: sims.filter((m) => !m.archived).length,
      favorites: sims.filter((m) => m.favorite && !m.archived).length,
      archived: sims.filter((m) => m.archived).length,
    }),
    [sims],
  );
  const setViewMode = (v: 'grid' | 'list') => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* optional */
    }
  };
  const owner = (id: string) => (id === 'legacy' ? 'Vorversion' : id === user.id ? undefined : ownerNames[id]);
  const filtered = text || category !== 'all' || tag || scope !== 'all';

  return (
    <div
      className={`page${dragOver ? ' is-drop-target' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length) void importFiles(e.dataTransfer.files);
      }}
    >
      <PageHeader
        title="Meine Simulationen"
        subtitle={viewAll ? 'Als Administrator/in siehst du die Simulationen aller Konten auf diesem Gerät.' : 'Alle deine gespeicherten Simulationen – lokal in diesem Browser.'}
        actions={
          <>
            <Button icon={Upload} onClick={() => pickImportFiles()}>
              Importieren
            </Button>
            {can(user, 'simulations.export') && (
              <Button icon={Download} onClick={() => void exportLibrary()} disabled={!sims.length}>
                Alle exportieren
              </Button>
            )}
            <Button variant="primary" icon={FilePlus2} onClick={() => openAppDialog({ kind: 'new-simulation' })}>
              Neue Simulation
            </Button>
          </>
        }
      />

      <div className="lib-toolbar">
        <SearchInput value={text} onChange={(v) => setParam('q', v)} placeholder="Name, Rezept, Tag oder Element suchen …" />
        <select className="ds-input ds-select ds-select--inline" aria-label="Kategorie" value={category} onChange={(e) => setParam('cat', e.target.value, 'all')}>
          <option value="all">Alle Kategorien</option>
          {(Object.keys(CATEGORY_LABELS) as SimulationCategory[]).map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        <select className="ds-input ds-select ds-select--inline" aria-label="Sortierung" value={sort} onChange={(e) => setParam('sort', e.target.value, 'updated')} disabled={scope === 'recent'}>
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <div className="segmented segmented--sm" role="radiogroup" aria-label="Ansicht">
          <button type="button" role="radio" aria-checked={view === 'grid'} className={`segmented__item${view === 'grid' ? ' is-active' : ''}`} onClick={() => setViewMode('grid')} data-tip="Kacheln">
            <LayoutGrid size={14} />
          </button>
          <button type="button" role="radio" aria-checked={view === 'list'} className={`segmented__item${view === 'list' ? ' is-active' : ''}`} onClick={() => setViewMode('list')} data-tip="Liste">
            <List size={14} />
          </button>
        </div>
      </div>

      <div className="lib-tabs">
        <Tabs<LibraryScope>
          value={scope}
          onChange={(v) => setParam('scope', v, 'all')}
          items={[
            { value: 'all', label: 'Alle', count: counts.all },
            { value: 'favorites', label: 'Favoriten', count: counts.favorites },
            { value: 'recent', label: 'Zuletzt geöffnet' },
            ...(viewAll ? [{ value: 'mine' as const, label: 'Nur meine' }] : []),
            { value: 'archived', label: 'Archiv', count: counts.archived },
          ]}
        />
        {tag && (
          <button type="button" className="filter-chip" onClick={() => setParam('tag', '')}>
            Tag: {tag} ✕
          </button>
        )}
        <span className="lib-count">
          {results.length} {results.length === 1 ? 'Simulation' : 'Simulationen'}
        </span>
      </div>

      {results.length === 0 ? (
        sims.length === 0 ? (
          <EmptyState
            icon={FolderOpen}
            title="Deine Bibliothek ist leer"
            text="Lege eine neue Simulation an oder importiere eine .opticsim-Datei (auch per Drag & Drop auf diese Seite)."
            action={
              <>
                <Button variant="primary" icon={FilePlus2} onClick={() => openAppDialog({ kind: 'new-simulation' })}>
                  Neue Simulation
                </Button>
                <Button icon={Upload} onClick={() => pickImportFiles()}>
                  Importieren
                </Button>
              </>
            }
          />
        ) : (
          <EmptyState
            icon={scope === 'favorites' ? Star : SearchX}
            title={scope === 'favorites' && !text ? 'Noch keine Favoriten' : scope === 'archived' && !text ? 'Das Archiv ist leer' : 'Keine Treffer'}
            text={scope === 'favorites' && !text ? 'Markiere Simulationen mit dem Stern, um sie hier zu sammeln.' : 'Passe Suche oder Filter an.'}
            action={
              filtered ? (
                <Button onClick={() => setParams(new URLSearchParams(), { replace: true })}>Filter zurücksetzen</Button>
              ) : undefined
            }
          />
        )
      ) : view === 'grid' ? (
        <div className="sim-grid">
          {results.map((m) => (
            <SimulationCard key={m.id} meta={m} ownerName={owner(m.ownerId)} />
          ))}
        </div>
      ) : (
        <div className="sim-table" role="table" aria-label="Simulationen">
          <div className="sim-table__row sim-table__row--head" role="row">
            <span role="columnheader">Name</span>
            <span role="columnheader">Kategorie</span>
            <span role="columnheader">Auge</span>
            <span role="columnheader">Geändert</span>
            <span role="columnheader" aria-label="Aktionen" />
          </div>
          {results.map((m) => (
            <div key={m.id} className="sim-table__row" role="row" data-sim-id={m.id} onClick={() => navigate(`/simulations/${m.id}`)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && navigate(`/simulations/${m.id}`)}>
              <span className="sim-table__name" role="cell">
                <button
                  type="button"
                  className={`star-btn${m.favorite ? ' is-on' : ''}`}
                  aria-label={m.favorite ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen'}
                  onClick={(e) => {
                    e.stopPropagation();
                    void setFavorite(m, !m.favorite);
                  }}
                >
                  <Star size={14} />
                </button>
                <TemplateGlyph category={m.category} size={15} />
                <span>
                  <strong>{m.name}</strong>
                  {owner(m.ownerId) && <small> · {owner(m.ownerId)}</small>}
                </span>
                {m.archived && <Pill>Archiviert</Pill>}
              </span>
              <span role="cell">{CATEGORY_LABELS[m.category]}</span>
              <span role="cell" className="mono">
                {m.summary.eyeRx}
              </span>
              <span role="cell">{relativeTime(m.updatedAt)}</span>
              <span role="cell" onClick={(e) => e.stopPropagation()}>
                <SimulationActionsMenu meta={m} />
              </span>
            </div>
          ))}
        </div>
      )}
      {dragOver && <div className="drop-overlay">Datei loslassen zum Importieren</div>}
    </div>
  );
}
