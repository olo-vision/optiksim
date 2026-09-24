/**
 * Einstellungen (je Benutzer, lokal gespeichert). Jede Option wirkt sofort;
 * noch nicht verfügbare Optionen sind als „In Entwicklung“ gekennzeichnet und deaktiviert.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router';
import { Box, Database, Eye, Glasses, LayoutPanelLeft, MousePointer2, Palette, RotateCcw, Settings2, Sparkles, Trash2, Download, Upload } from 'lucide-react';
import { useAppStore } from '@/state/store';
import { Segmented } from '@/ui/common/controls';
import { Button, Notice, PageHeader, Pill, SettingRow, Switch } from '@/ui/ds';
import { DEFAULT_USER_PREFS, WORKSPACES, type UserPreferences } from '@/platform/preferences';
import { useSession, errorMessage } from '../session';
import { platform } from '../platformInstance';
import { exportLibrary, pickImportFiles } from '../library/actions';
import { confirmDialog } from '@/ui/ds/modals';
import { removeDemoData, wipeAllData } from '@/platform/seed';
import { can } from '@/platform/permissions';
import { usePageTitle } from '../usePageTitle';
import { ELEMENT_DEFINITIONS } from '@/model/elementRegistry';

type SectionId = 'general' | 'appearance' | 'graphics' | 'simulation' | 'controls' | 'optics' | 'workspace' | 'data';

const SECTIONS: Array<{ id: SectionId; label: string; icon: typeof Settings2 }> = [
  { id: 'general', label: 'Allgemein', icon: Settings2 },
  { id: 'appearance', label: 'Darstellung', icon: Palette },
  { id: 'graphics', label: '3D & Grafik', icon: Box },
  { id: 'simulation', label: 'Simulation', icon: Eye },
  { id: 'controls', label: 'Bedienung', icon: MousePointer2 },
  { id: 'optics', label: 'Augenoptik', icon: Glasses },
  { id: 'workspace', label: 'Arbeitsbereich', icon: LayoutPanelLeft },
  { id: 'data', label: 'Daten', icon: Database },
];

const Dev = () => <Pill tone="dev">In Entwicklung</Pill>;

function Range({ value, min, max, step, onChange, format, label }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; format: (v: number) => string; label: string }) {
  return (
    <div className="ds-range">
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} />
      <output>{format(value)}</output>
    </div>
  );
}

function Group({ title, children, description }: { title: string; children: ReactNode; description?: string }) {
  return (
    <section className="settings-group">
      <h2 className="settings-group__title">{title}</h2>
      {description && <p className="settings-group__desc">{description}</p>}
      <div className="settings-group__body">{children}</div>
    </section>
  );
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

function DataSection() {
  const user = useSession((s) => s.user)!;
  const sims = useSession((s) => s.sims);
  const navigate = useNavigate();
  const [usage, setUsage] = useState<number | null>(null);
  const [hasDemo, setHasDemo] = useState(false);
  const [noRealAdmin, setNoRealAdmin] = useState(false);
  const refresh = async () => {
    setUsage(await platform.storage.usage());
    const users = await platform.repos.listUsers();
    setHasDemo(users.some((u) => u.isDemo));
    setNoRealAdmin(!users.some((u) => u.role === 'admin' && !u.isDemo && u.active));
  };
  useEffect(() => {
    void refresh();
  }, [sims.length]);
  const mayManage = can(user, 'data.manage') || noRealAdmin;
  const notify = useAppStore.getState().notify;

  const removeDemo = async () => {
    const ok = await confirmDialog({
      title: 'Demo-Daten entfernen?',
      message: 'Das Demo-Konto „Max Mustermann“, seine Beispiel-Simulationen und die Demo-Organisation werden gelöscht. Deine eigenen Daten bleiben erhalten.',
      confirmLabel: 'Demo-Daten entfernen',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const r = await removeDemoData(platform.repos);
      if (user.isDemo) {
        await useSession.getState().signOut();
        navigate('/login', { replace: true });
        return;
      }
      await useSession.getState().refreshLibrary();
      notify(`Demo-Daten entfernt (${r.simulations} Simulationen)`, 'success');
      void refresh();
    } catch (e) {
      notify(errorMessage(e), 'warning');
    }
  };

  const wipe = async () => {
    const ok = await confirmDialog({
      title: 'Alle lokalen Daten löschen?',
      message: 'Alle Konten, Einstellungen, Simulationen und Vorlagen in diesem Browser werden unwiderruflich gelöscht – auch übernommene Daten der Vorversion. Exportiere vorher, was du behalten möchtest.',
      confirmLabel: 'Alles löschen',
      tone: 'danger',
    });
    if (!ok) return;
    await wipeAllData(platform.repos);
    window.location.href = '/login';
  };

  return (
    <>
      <Group title="Speicherort">
        <Notice tone="info" icon={Database} title="Nur in diesem Browser gespeichert">
          Konten, Einstellungen und Simulationen liegen im lokalen Speicher dieses Browsers auf diesem Gerät. Es findet keine Übertragung an einen Server statt. Beim Löschen der Browserdaten gehen sie verloren – exportiere wichtige Arbeiten regelmäßig.
        </Notice>
        <SettingRow label="Belegter Speicher" description="Browser erlauben meist ca. 5–10 MB pro Website.">
          <span className="mono">{usage === null ? '…' : formatBytes(usage)}</span>
        </SettingRow>
        <SettingRow label="Simulationen" description="Sichtbar für dein Konto">
          <span className="mono">{sims.length}</span>
        </SettingRow>
      </Group>
      <Group title="Import & Export">
        <SettingRow label="Bibliothek exportieren" description="Alle für dich sichtbaren Simulationen als JSON-Datei.">
          <Button icon={Download} onClick={() => void exportLibrary()} disabled={!sims.length || !can(user, 'simulations.export')}>
            Exportieren
          </Button>
        </SettingRow>
        <SettingRow label="Importieren" description=".opticsim-Dateien, Bibliotheksdateien und Szenendateien der Vorversion (.oel.json).">
          <Button icon={Upload} onClick={() => pickImportFiles()}>
            Datei wählen …
          </Button>
        </SettingRow>
      </Group>
      <Group title="Zurücksetzen" description={mayManage ? undefined : 'Diese Aktionen betreffen alle Konten und sind der Administration vorbehalten.'}>
        <SettingRow label="Demo-Daten entfernen" description={hasDemo ? 'Demo-Konto, Beispiel-Simulationen und Demo-Organisation löschen.' : 'Keine Demo-Daten vorhanden.'}>
          <Button icon={Trash2} onClick={() => void removeDemo()} disabled={!hasDemo || !mayManage}>
            Entfernen
          </Button>
        </SettingRow>
        <SettingRow label="Alle lokalen Daten löschen" description="Setzt Optical Eye Lab in diesem Browser vollständig zurück.">
          <Button variant="danger" icon={Trash2} onClick={() => void wipe()} disabled={!mayManage}>
            Alles löschen
          </Button>
        </SettingRow>
      </Group>
    </>
  );
}

export function SettingsPage() {
  usePageTitle('Einstellungen');
  const { section: raw } = useParams();
  const section: SectionId = SECTIONS.some((s) => s.id === raw) ? (raw as SectionId) : 'general';
  const p = useAppStore((s) => s.prefs);
  const set = useAppStore((s) => s.setPrefs);
  const up = <K extends keyof UserPreferences>(k: K) => (v: UserPreferences[K]) => set({ [k]: v } as Partial<UserPreferences>);

  const resetAll = async () => {
    const ok = await confirmDialog({ title: 'Einstellungen zurücksetzen?', message: 'Alle Einstellungen deines Kontos werden auf die Standardwerte gesetzt. Simulationen bleiben unverändert.', confirmLabel: 'Zurücksetzen' });
    if (ok) {
      set({ ...DEFAULT_USER_PREFS, onboardingDone: true });
      useAppStore.getState().applyUserPrefs({ ...DEFAULT_USER_PREFS, onboardingDone: true });
      useAppStore.getState().notify('Einstellungen zurückgesetzt', 'success');
    }
  };

  let body: ReactNode;
  switch (section) {
    case 'general':
      body = (
        <>
          <Group title="Start & Sprache">
            <SettingRow label="Startansicht" description="Was nach der Anmeldung geöffnet wird.">
              <Segmented
                size="sm"
                value={p.startView}
                onChange={up('startView')}
                options={[
                  { value: 'dashboard', label: 'Dashboard' },
                  { value: 'library', label: 'Bibliothek' },
                  { value: 'last-simulation', label: 'Letzte Simulation' },
                ]}
              />
            </SettingRow>
            <SettingRow label="Sprache" badge={<Pill tone="dev">Englisch in Vorbereitung</Pill>}>
              <Segmented size="sm" value="de" onChange={() => undefined} options={[{ value: 'de', label: 'Deutsch' }]} />
            </SettingRow>
          </Group>
          <Group title="Speichern">
            <Switch label="Automatisch speichern" description="Änderungen im Simulator werden nach kurzer Pause in der Bibliothek gespeichert." checked={p.autoSave} onChange={up('autoSave')} />
            <SettingRow label="Verzögerung" description="Wartezeit nach der letzten Änderung.">
              <Range label="Verzögerung automatisches Speichern" value={p.autoSaveDelaySec} min={1} max={30} step={1} onChange={up('autoSaveDelaySec')} format={(v) => `${v} s`} />
            </SettingRow>
            <SettingRow label="Beim Schließen mit ungespeicherten Änderungen">
              <Segmented
                size="sm"
                value={p.onCloseUnsaved}
                onChange={up('onCloseUnsaved')}
                options={[
                  { value: 'ask', label: 'Nachfragen' },
                  { value: 'save', label: 'Speichern' },
                  { value: 'discard', label: 'Verwerfen' },
                ]}
              />
            </SettingRow>
            <Switch label="Löschen bestätigen" description="Vor dem Löschen von Simulationen nachfragen." checked={p.confirmDestructive} onChange={up('confirmDestructive')} />
          </Group>
          <Group title="Einführung">
            <SettingRow label="Einführung erneut anzeigen" description="Die kurze Tour durch die wichtigsten Bereiche.">
              <Button icon={Sparkles} onClick={() => set({ onboardingDone: false })}>
                Starten
              </Button>
            </SettingRow>
            <SettingRow label="Alle Einstellungen zurücksetzen">
              <Button icon={RotateCcw} onClick={() => void resetAll()}>
                Zurücksetzen
              </Button>
            </SettingRow>
          </Group>
        </>
      );
      break;
    case 'appearance':
      body = (
        <>
          <Group title="Farbschema" description="Das helle Schema betrifft die Oberfläche; der 3D-Laborraum bleibt für den Kontrast von Glas und Strahlen dunkel.">
            <SettingRow label="Design">
              <Segmented
                size="sm"
                value={p.theme}
                onChange={up('theme')}
                options={[
                  { value: 'dark', label: 'Dunkel' },
                  { value: 'light', label: 'Hell' },
                  { value: 'system', label: 'System' },
                ]}
              />
            </SettingRow>
            <SettingRow label="Schriftgröße">
              <Segmented
                size="sm"
                value={p.fontScale}
                onChange={up('fontScale')}
                options={[
                  { value: 'small', label: 'Klein' },
                  { value: 'normal', label: 'Normal' },
                  { value: 'large', label: 'Groß' },
                ]}
              />
            </SettingRow>
            <Switch label="Bewegungen reduzieren" description="Animationen und Übergänge der Oberfläche abschalten." checked={p.reducedMotion} onChange={up('reducedMotion')} />
          </Group>
          <Group title="Panels im Simulator">
            <SettingRow label="Deckkraft der Panels">
              <Range label="Deckkraft der Panels" value={p.panelOpacity} min={0.6} max={1} step={0.02} onChange={up('panelOpacity')} format={(v) => `${Math.round(v * 100)} %`} />
            </SettingRow>
            <SettingRow label="Breite Szenenbaum">
              <Range label="Breite Szenenbaum" value={p.leftPanelWidth} min={220} max={420} step={4} onChange={up('leftPanelWidth')} format={(v) => `${v} px`} />
            </SettingRow>
            <SettingRow label="Breite Inspector">
              <Range label="Breite Inspector" value={p.rightPanelWidth} min={260} max={480} step={4} onChange={up('rightPanelWidth')} format={(v) => `${v} px`} />
            </SettingRow>
            <Switch label="Szenenbaum anzeigen" checked={p.leftPanelOpen} onChange={up('leftPanelOpen')} />
            <Switch label="Inspector anzeigen" checked={p.rightPanelOpen} onChange={up('rightPanelOpen')} />
            <Switch label="Objektinfo bei Maus-Hover" checked={p.showHoverInfo} onChange={up('showHoverInfo')} />
          </Group>
        </>
      );
      break;
    case 'graphics':
      body = (
        <Group title="Renderqualität" description="Wirkt sofort im Simulator. Bei schwächerer Grafik „Leistung“ wählen.">
          <SettingRow label="Qualitätsstufe">
            <Segmented
              size="sm"
              value={p.quality}
              onChange={up('quality')}
              options={[
                { value: 'high', label: 'Hoch' },
                { value: 'balanced', label: 'Ausgewogen' },
                { value: 'performance', label: 'Leistung' },
              ]}
            />
          </SettingRow>
          <Switch label="Schatten" description="Nur in den Stufen Hoch und Ausgewogen." checked={p.shadows} onChange={up('shadows')} disabled={p.quality === 'performance'} />
          <Switch label="Bodenreflexion" description="Nur in der Stufe Hoch." checked={p.reflections} onChange={up('reflections')} disabled={p.quality !== 'high'} />
          <Switch label="Kantenglättung (Antialiasing)" checked={p.antialias} onChange={up('antialias')} />
          <SettingRow label="Maximale Pixeldichte" description="Höher = schärfer, aber langsamer.">
            <Segmented
              size="sm"
              value={String(p.maxPixelRatio)}
              onChange={(v) => set({ maxPixelRatio: Number(v) as 1 | 1.5 | 2 })}
              options={[
                { value: '1', label: '1×' },
                { value: '1.5', label: '1,5×' },
                { value: '2', label: '2×' },
              ]}
            />
          </SettingRow>
          <Switch label="Nachbearbeitung (Bloom, Tiefenschärfe)" badge={<Dev />} checked={false} onChange={() => undefined} disabled />
        </Group>
      );
      break;
    case 'simulation':
      body = (
        <>
          <Group title="Strahlengang">
            <Switch label="Live-Berechnung beim Öffnen" description="Strahlengang sofort live berechnen (sonst pausiert starten)." checked={p.simulationLiveDefault} onChange={up('simulationLiveDefault')} />
          </Group>
          <Group title="Neue, leere Simulationen" description="Standardwerte für „Leere Simulation“. Vorlagen bringen ihre eigenen Werte mit.">
            <Switch label="Optische Achse anzeigen" checked={p.newSceneOpticalAxis} onChange={up('newSceneOpticalAxis')} />
            <Switch label="Bemaßung anzeigen" checked={p.newSceneDimensions} onChange={up('newSceneDimensions')} />
            <Switch label="Optische Bank anzeigen" checked={p.newSceneBench} onChange={up('newSceneBench')} />
            <SettingRow label="Ametropie-Modell des Auges" description="Wie das Auge eine eingestellte Fehlsichtigkeit umsetzt.">
              <Segmented
                size="sm"
                value={p.defaultAmetropiaMode}
                onChange={up('defaultAmetropiaMode')}
                options={[
                  { value: 'auto', label: 'Automatisch' },
                  { value: 'axial', label: 'Achsenlänge' },
                  { value: 'refractive', label: 'Brechwert' },
                ]}
              />
            </SettingRow>
          </Group>
        </>
      );
      break;
    case 'controls':
      body = (
        <>
          <Group title="Kamera">
            <SettingRow label="Drehgeschwindigkeit">
              <Range label="Drehgeschwindigkeit" value={p.cameraRotateSpeed} min={0.2} max={3} step={0.1} onChange={up('cameraRotateSpeed')} format={(v) => `${v.toFixed(1).replace('.', ',')}×`} />
            </SettingRow>
            <SettingRow label="Zoomgeschwindigkeit">
              <Range label="Zoomgeschwindigkeit" value={p.zoomSpeed} min={0.1} max={3} step={0.1} onChange={up('zoomSpeed')} format={(v) => `${v.toFixed(1).replace('.', ',')}×`} />
            </SettingRow>
            <SettingRow label="Standardprojektion">
              <Segmented
                size="sm"
                value={p.defaultProjection}
                onChange={up('defaultProjection')}
                options={[
                  { value: 'perspective', label: 'Perspektive' },
                  { value: 'orthographic', label: 'Orthografisch' },
                ]}
              />
            </SettingRow>
          </Group>
          <Group title="Werkzeuge">
            <SettingRow label="Standardwerkzeug">
              <Segmented
                size="sm"
                value={p.defaultTool}
                onChange={up('defaultTool')}
                options={[
                  { value: 'select', label: 'Auswahl' },
                  { value: 'translate', label: 'Verschieben' },
                  { value: 'rotate', label: 'Drehen' },
                ]}
              />
            </SettingRow>
            <SettingRow label="Gizmo-Größe">
              <Range label="Gizmo-Größe" value={p.gizmoSize} min={0.4} max={2} step={0.05} onChange={up('gizmoSize')} format={(v) => v.toFixed(2).replace('.', ',')} />
            </SettingRow>
            <SettingRow label="Raster Verschieben">
              <Range label="Raster Verschieben" value={p.translationSnap} min={0.1} max={10} step={0.1} onChange={up('translationSnap')} format={(v) => `${v.toFixed(1).replace('.', ',')} mm`} />
            </SettingRow>
            <SettingRow label="Raster Drehen">
              <Range label="Raster Drehen" value={p.rotationSnap} min={1} max={45} step={1} onChange={up('rotationSnap')} format={(v) => `${v}°`} />
            </SettingRow>
          </Group>
        </>
      );
      break;
    case 'optics':
      body = (
        <Group title="Werte & Schreibweisen">
          <SettingRow label="Zylinderschreibweise">
            <Segmented
              size="sm"
              value={p.cylForm}
              onChange={up('cylForm')}
              options={[
                { value: 'minus', label: 'Minuszylinder' },
                { value: 'plus', label: 'Pluszylinder' },
              ]}
            />
          </SettingRow>
          <SettingRow label="Parametersteuerung im Inspector">
            <Segmented
              size="sm"
              value={p.paramMode}
              onChange={up('paramMode')}
              options={[
                { value: 'optical', label: 'Optische Werte' },
                { value: 'geometry', label: 'Geometrie' },
              ]}
            />
          </SettingRow>
          <SettingRow label="Schrittweite Sph/Cyl" description="Pfeiltasten und Ziehen in Rezeptfeldern.">
            <Segmented
              size="sm"
              value={String(p.diopterStep)}
              onChange={(v) => set({ diopterStep: Number(v) as 0.12 | 0.25 | 0.5 })}
              options={[
                { value: '0.12', label: '0,12 dpt' },
                { value: '0.25', label: '0,25 dpt' },
                { value: '0.5', label: '0,50 dpt' },
              ]}
            />
          </SettingRow>
          <SettingRow label="Nachkommastellen (mm)">
            <Segmented
              size="sm"
              value={String(p.decimals)}
              onChange={(v) => set({ decimals: Number(v) as 1 | 2 | 3 })}
              options={[
                { value: '1', label: '0,0' },
                { value: '2', label: '0,00' },
                { value: '3', label: '0,000' },
              ]}
            />
          </SettingRow>
        </Group>
      );
      break;
    case 'workspace':
      body = (
        <>
          <Group title="Arbeitsbereiche" description="Vordefinierte Oberflächen-Konfigurationen. Sie ändern nur Panels und Anzeige, nie Simulationen.">
            <div className="workspace-grid">
              {WORKSPACES.map((w) => (
                <button key={w.id} type="button" className={`workspace-card${p.workspace === w.id ? ' is-active' : ''}`} aria-pressed={p.workspace === w.id} onClick={() => set({ ...w.patch, workspace: w.id })}>
                  <strong>{w.label}</strong>
                  <span>{w.description}</span>
                </button>
              ))}
            </div>
          </Group>
          <Group title="Lieblingselemente" description="Erscheinen oben im Dialog „Optisches Element hinzufügen“. Auch dort per Stern markierbar.">
            <div className="chip-select">
              {ELEMENT_DEFINITIONS.map((d) => {
                const on = p.favoriteElementKinds.includes(d.kind);
                return (
                  <button
                    key={d.kind}
                    type="button"
                    aria-pressed={on}
                    className={`chip${on ? ' is-on' : ''}`}
                    onClick={() => set({ favoriteElementKinds: on ? p.favoriteElementKinds.filter((k) => k !== d.kind) : [...p.favoriteElementKinds, d.kind] })}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </Group>
        </>
      );
      break;
    case 'data':
      body = <DataSection />;
      break;
  }

  const current = SECTIONS.find((s) => s.id === section)!;
  return (
    <div className="page page--settings">
      <PageHeader title="Einstellungen" subtitle="Gelten für dein Konto auf diesem Gerät und werden sofort übernommen." />
      <div className="settings">
        <nav className="settings__nav" aria-label="Einstellungsbereiche">
          {SECTIONS.map((s) => (
            <NavLink key={s.id} to={`/settings/${s.id}`} className={() => `settings__nav-item${s.id === section ? ' is-active' : ''}`}>
              <s.icon size={16} strokeWidth={1.8} />
              {s.label}
            </NavLink>
          ))}
        </nav>
        <div className="settings__content" aria-label={current.label}>
          <h2 className="settings__section-title">{current.label}</h2>
          {body}
        </div>
      </div>
    </div>
  );
}
