/**
 * Vertragscenter / Rechtliches (Phase 8, nur Super-Admin).
 *
 * - Dokumente je Typ und Zielgruppe versioniert: Entwurf → aktiv (veröffentlicht) → archiviert.
 * - Veröffentlichte Versionen sind unveränderlich (Datenbank-Trigger); Änderungen = neue Version.
 * - Pro Typ und Zielgruppe ist genau eine Version aktiv; beim Veröffentlichen wird die vorherige archiviert.
 * - Hinweis, welche für Registrierung/Demo/Kauf vorgesehenen Dokumente noch fehlen.
 * Alle Aktionen laufen über serverseitig geprüfte Funktionen (admin_legal_*).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavLink } from 'react-router';
import { Archive, CircleAlert, Eye, FilePlus2, FileText, PencilLine, RefreshCcw, Rocket, ShieldCheck, Trash2, Users } from 'lucide-react';
import { Button, EmptyState, PageHeader, Pill, SelectField, TextArea, TextField } from '@/ui/ds';
import { Dialog } from '@/ui/common/overlays';
import { confirmDialog } from '@/ui/ds/modals';
import { usePageTitle } from '../../usePageTitle';
import { cloudBackend } from '../../cloudSession';
import { formatDate, LEGAL_AUDIENCE_LABEL, LEGAL_DOC_TYPE_LABEL } from '@/cloud/plans';
import { legalDocPath, suggestNextVersion } from '@/cloud/legal';
import { LEGAL_DOC_TYPES, type AdminLegalDocument, type LegalAudience, type LegalDocType, type LegalDraftInput } from '@/cloud/types';
import { useAppStore } from '@/state/store';
import { LegalMarkdown } from './LegalPages';

const notify = (m: string, tone: 'success' | 'warning' = 'success') => useAppStore.getState().notify(m, tone);

/** Reiter des Admin-Bereichs */
export function AdminTabs() {
  return (
    <nav className="admin-tabs" aria-label="Admin-Bereiche">
      <NavLink to="/admin" end className={({ isActive }) => (isActive ? 'is-active' : '')}>
        <Users size={14} /> Kunden
      </NavLink>
      <NavLink to="/admin/legal" className={({ isActive }) => (isActive ? 'is-active' : '')} data-testid="admin-tab-legal">
        <FileText size={14} /> Rechtliches
      </NavLink>
    </nav>
  );
}

/** Für welche Abläufe welche Dokumente vorgesehen sind (Spiegel von legal_required_documents, nur Anzeige) */
const EXPECTED: Array<{ label: string; audience: Exclude<LegalAudience, 'all'>; types: LegalDocType[] }> = [
  { label: 'Registrierung & Demo', audience: 'b2c', types: ['privacy', 'license_terms'] },
  { label: 'Registrierung & Demo', audience: 'b2b', types: ['privacy', 'license_terms'] },
  { label: 'Kauf B2C', audience: 'b2c', types: ['terms', 'privacy', 'withdrawal', 'withdrawal_form', 'license_terms', 'consent_immediate_performance', 'consent_withdrawal_loss'] },
  { label: 'Kauf B2B', audience: 'b2b', types: ['terms', 'b2b_terms', 'privacy', 'license_terms'] },
];

const STATUS_LABEL = { draft: 'Entwurf', active: 'Aktiv', archived: 'Archiviert' } as const;
const STATUS_TONE = { draft: 'dev', active: 'ok', archived: 'neutral' } as const;

export function AdminLegalPage() {
  usePageTitle('Rechtliches');
  const [docs, setDocs] = useState<AdminLegalDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<LegalDraftInput | null>(null);
  const [preview, setPreview] = useState<AdminLegalDocument | null>(null);

  const load = useCallback(async () => {
    try {
      setDocs(await cloudBackend().adminLegalList());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const missing = useMemo(() => {
    const active = (docs ?? []).filter((d) => d.status === 'active');
    return EXPECTED.map((e) => ({ ...e, missing: e.types.filter((t) => !active.some((d) => d.type === t && (d.audience === e.audience || d.audience === 'all'))) })).filter((e) => e.missing.length);
  }, [docs]);

  const run = async (fn: () => Promise<void>, ok: string) => {
    try {
      await fn();
      notify(ok);
      await load();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Fehler', 'warning');
    }
  };

  const newVersion = (type: LegalDocType, audience: LegalAudience, from?: AdminLegalDocument) => {
    const versions = (docs ?? []).filter((d) => d.type === type && d.audience === audience).map((d) => d.version);
    setEditing({
      id: null,
      type,
      audience,
      version: suggestNextVersion(versions),
      title: from?.title ?? LEGAL_DOC_TYPE_LABEL[type],
      content: from?.content ?? '',
      checkboxLabel: from?.checkboxLabel ?? null,
      effectiveFrom: null,
    });
  };

  const activate = (d: AdminLegalDocument) =>
    void confirmDialog({
      title: `${d.title} (Version ${d.version}) veröffentlichen?`,
      message: 'Die Version wird sofort für neue Registrierungen, Demos und Käufe verwendet. Eine bisher aktive Version desselben Typs und derselben Zielgruppe wird archiviert. Veröffentlichte Versionen können nicht mehr geändert werden.',
      confirmLabel: 'Veröffentlichen',
    }).then((ok) => void (ok && run(() => cloudBackend().adminLegalActivate(d.id), `Version ${d.version} ist aktiv.`)));

  const groups = LEGAL_DOC_TYPES.map((type) => ({ type, items: (docs ?? []).filter((d) => d.type === type) }));

  return (
    <div className="page">
      <PageHeader
        eyebrow={
          <>
            <ShieldCheck size={13} /> Super-Admin
          </>
        }
        title="Rechtliches"
        subtitle="Rechtstexte versioniert verwalten. Veröffentlichte Versionen bleiben unverändert erhalten – bestehende Zustimmungen verweisen immer auf die damals gültige Version."
        actions={
          <Button icon={RefreshCcw} onClick={() => void load()}>
            Aktualisieren
          </Button>
        }
      />
      <AdminTabs />
      {error ? (
        <EmptyState icon={FileText} title="Keine Daten" text={error} />
      ) : (
        <>
          {missing.length > 0 && (
            <div className="legal-missing" data-testid="legal-missing">
              <CircleAlert size={16} />
              <div>
                <strong>Noch nicht veröffentlicht</strong>
                <span>Solange ein Dokument fehlt, wird es im jeweiligen Ablauf nicht abgefragt. Inhalte bitte juristisch prüfen lassen.</span>
                <ul>
                  {missing.map((m) => (
                    <li key={`${m.label}-${m.audience}`}>
                      {m.label} ({m.audience.toUpperCase()}): {m.missing.map((t) => LEGAL_DOC_TYPE_LABEL[t]).join(', ')}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          <div className="legal-groups">
            {groups.map(({ type, items }) => (
              <section key={type} className="legal-group" data-testid={`legal-group-${type}`}>
                <header className="legal-group__head">
                  <div>
                    <h3>{LEGAL_DOC_TYPE_LABEL[type]}</h3>
                    <span className="muted">{items.length ? `${items.length} Version${items.length === 1 ? '' : 'en'}` : 'Noch keine Version'}</span>
                  </div>
                  <Button size="sm" icon={FilePlus2} onClick={() => newVersion(type, type === 'b2b_terms' ? 'b2b' : type.startsWith('consent_') || type === 'withdrawal' || type === 'withdrawal_form' ? 'b2c' : 'all', items.find((d) => d.status === 'active'))} data-testid={`legal-new-${type}`}>
                    Neue Version
                  </Button>
                </header>
                {items.length > 0 && (
                  <table className="admin-table legal-table">
                    <thead>
                      <tr>
                        <th>Version</th>
                        <th>Zielgruppe</th>
                        <th>Status</th>
                        <th>Gültig ab</th>
                        <th>Titel</th>
                        <th aria-label="Aktionen" />
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((d) => (
                        <tr key={d.id} data-testid="legal-row" data-status={d.status} data-version={d.version}>
                          <td className="mono">{d.version}</td>
                          <td>{LEGAL_AUDIENCE_LABEL[d.audience]}</td>
                          <td>
                            <Pill tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Pill>
                          </td>
                          <td>{formatDate(d.effectiveFrom)}</td>
                          <td>{d.title}</td>
                          <td className="legal-actions">
                            {d.status === 'draft' ? (
                              <>
                                <Button size="sm" variant="ghost" icon={PencilLine} onClick={() => setEditing({ id: d.id, type: d.type, audience: d.audience, version: d.version, title: d.title, content: d.content, checkboxLabel: d.checkboxLabel, effectiveFrom: d.effectiveFrom })}>
                                  Bearbeiten
                                </Button>
                                <Button size="sm" variant="ghost" icon={Eye} onClick={() => setPreview(d)}>
                                  Vorschau
                                </Button>
                                <Button size="sm" variant="primary" icon={Rocket} onClick={() => activate(d)} data-testid="legal-activate">
                                  Veröffentlichen
                                </Button>
                                <Button size="sm" variant="ghost" icon={Trash2} aria-label="Entwurf löschen" onClick={() => void confirmDialog({ title: 'Entwurf löschen?', message: `${d.title} (Version ${d.version})`, confirmLabel: 'Löschen', tone: 'danger' }).then((ok) => void (ok && run(() => cloudBackend().adminLegalDeleteDraft(d.id), 'Entwurf gelöscht.')))} />
                              </>
                            ) : (
                              <>
                                <a className="btn btn--ghost btn--sm-link" href={legalDocPath(d.id)} target="_blank" rel="noopener noreferrer">
                                  <Eye size={13} /> Ansehen
                                </a>
                                <Button size="sm" variant="ghost" icon={FilePlus2} onClick={() => newVersion(d.type, d.audience, d)}>
                                  Als neue Version
                                </Button>
                                {d.status === 'active' && (
                                  <Button size="sm" variant="ghost" icon={Archive} onClick={() => void confirmDialog({ title: 'Version archivieren?', message: 'Danach ist für diesen Typ und diese Zielgruppe keine Version mehr aktiv – das Dokument wird in den Abläufen nicht mehr abgefragt.', confirmLabel: 'Archivieren', tone: 'danger' }).then((ok) => void (ok && run(() => cloudBackend().adminLegalArchive(d.id), 'Version archiviert.')))}>
                                    Archivieren
                                  </Button>
                                )}
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            ))}
          </div>
        </>
      )}
      {editing && (
        <LegalEditor
          initial={editing}
          existingVersions={(docs ?? []).filter((d) => d.id !== editing.id).map((d) => `${d.type}|${d.audience}|${d.version}`)}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
      {preview && (
        <Dialog title={`${preview.title} – Version ${preview.version}`} subtitle="Vorschau (Entwurf)" onClose={() => setPreview(null)} width={760}>
          <LegalMarkdown content={preview.content} />
        </Dialog>
      )}
    </div>
  );
}

function LegalEditor({ initial, existingVersions, onClose, onSaved }: { initial: LegalDraftInput; existingVersions: string[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [d, setD] = useState<LegalDraftInput>(initial);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof LegalDraftInput>(k: K, v: LegalDraftInput[K]) => setD((x) => ({ ...x, [k]: v }));
  const duplicate = existingVersions.includes(`${d.type}|${d.audience}|${d.version.trim()}`);
  const isConsentText = d.type.startsWith('consent_');
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await cloudBackend().adminLegalSaveDraft({ ...d, effectiveFrom: d.effectiveFrom ? new Date(d.effectiveFrom).toISOString() : null });
      notify('Entwurf gespeichert.');
      await onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Fehler');
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={initial.id ? 'Entwurf bearbeiten' : 'Neue Version anlegen'}
      subtitle="Wird als Entwurf gespeichert. Erst „Veröffentlichen“ macht die Version wirksam."
      onClose={onClose}
      width={820}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <span className="flex-spacer" />
          <Button variant="primary" loading={busy} disabled={!d.title.trim() || !d.version.trim() || duplicate} onClick={() => void save()} data-testid="legal-save">
            Entwurf speichern
          </Button>
        </>
      }
    >
      <div className="legal-editor" data-testid="legal-editor">
        <div className="form-row">
          <SelectField label="Dokument" value={d.type} options={LEGAL_DOC_TYPES.map((t) => ({ value: t, label: LEGAL_DOC_TYPE_LABEL[t] }))} onChange={(v) => set('type', v)} />
          <SelectField label="Zielgruppe" value={d.audience} options={(['all', 'b2c', 'b2b'] as const).map((a) => ({ value: a, label: LEGAL_AUDIENCE_LABEL[a] }))} onChange={(v) => set('audience', v)} />
        </div>
        <div className="form-row">
          <TextField label="Version" value={d.version} onChange={(e) => set('version', e.target.value)} error={duplicate ? 'Diese Version existiert bereits.' : null} hint="z. B. 1.0, 1.1, 2.0" />
          <TextField label="Gültig ab" type="date" optional value={d.effectiveFrom ? d.effectiveFrom.slice(0, 10) : ''} onChange={(e) => set('effectiveFrom', e.target.value || null)} hint="Leer = ab Veröffentlichung" />
        </div>
        <TextField label="Titel" value={d.title} onChange={(e) => set('title', e.target.value)} />
        <TextField
          label="Text der Checkbox"
          optional
          value={d.checkboxLabel ?? ''}
          onChange={(e) => set('checkboxLabel', e.target.value || null)}
          hint={isConsentText ? 'Dieser Text erscheint direkt als Checkbox-Beschriftung.' : '„{link}“ wird durch den verlinkten Titel ersetzt. Leer = neutrale Standardformulierung.'}
        />
        <div className="legal-editor__tabs">
          <button type="button" className={tab === 'edit' ? 'is-on' : ''} onClick={() => setTab('edit')}>
            Text
          </button>
          <button type="button" className={tab === 'preview' ? 'is-on' : ''} onClick={() => setTab('preview')}>
            Vorschau
          </button>
        </div>
        {tab === 'edit' ? (
          <TextArea label="Inhalt" value={d.content} onChange={(e) => set('content', e.target.value)} rows={14} hint="Formatierung: # Überschrift, ## Unterüberschrift, - Aufzählung, 1. Nummerierung, **fett**. Leerzeile = neuer Absatz." />
        ) : (
          <div className="legal-editor__preview">
            <LegalMarkdown content={d.content || '_(leer)_'} />
          </div>
        )}
        {err && (
          <p className="ds-field__error" role="alert">
            {err}
          </p>
        )}
      </div>
    </Dialog>
  );
}
