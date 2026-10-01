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
import { Archive, CircleAlert, Eye, FilePlus2, FileText, Inbox, PencilLine, RefreshCcw, Rocket, ShieldCheck, Trash2, Users, UserX } from 'lucide-react';
import { Button, EmptyState, PageHeader, Pill, SelectField, TextArea, TextField } from '@/ui/ds';
import { Dialog } from '@/ui/common/overlays';
import { confirmDialog } from '@/ui/ds/modals';
import { usePageTitle } from '../../usePageTitle';
import { cloudBackend } from '../../cloudSession';
import { formatDate, LEGAL_AUDIENCE_LABEL, LEGAL_DOC_TYPE_LABEL } from '@/cloud/plans';
import { countReviewMarkers, legalDocPath, suggestNextVersion } from '@/cloud/legal';
import { CloudError, LEGAL_DOC_TYPES, type AdminDeclarationRow, type AdminLegalDocument, type LegalAudience, type LegalDocType, type LegalDraftInput } from '@/cloud/types';
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
      <NavLink to="/admin/declarations" className={({ isActive }) => (isActive ? 'is-active' : '')} data-testid="admin-tab-declarations">
        <Inbox size={14} /> Kündigungen &amp; Widerrufe
      </NavLink>
      <NavLink to="/admin/accounts" className={({ isActive }) => (isActive ? 'is-active' : '')} data-testid="admin-tab-accounts">
        <UserX size={14} /> Kontoschließung &amp; Löschung
      </NavLink>
    </nav>
  );
}

/** Für welche Abläufe welche Dokumente vorgesehen sind (Spiegel von legal_required_documents, nur Anzeige) */
const EXPECTED: Array<{ label: string; audience: Exclude<LegalAudience, 'all'>; types: LegalDocType[] }> = [
  { label: 'Website (öffentlich)', audience: 'b2c', types: ['imprint'] },
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

  /** Warnung bei offenen Prüfhinweisen: blockiert nicht, verlangt aber eine bewusste Bestätigung (Server prüft ebenfalls, OLR01). */
  const confirmReviewOverride = (d: AdminLegalDocument, open: number) =>
    confirmDialog({
      title: 'Prüfhinweise vorhanden',
      message: (
        <div className="legal-override" data-testid="legal-override-dialog">
          <p>
            <strong>
              Dieses Dokument enthält noch {open === 1 ? 'einen Prüfhinweis' : `${open} Prüfhinweise`}. Möchten Sie es trotzdem veröffentlichen?
            </strong>
          </p>
          <p>
            {d.title} (Version {d.version}) wird sofort für neue Registrierungen, Demos und Käufe verwendet. Die Prüfhinweise bleiben nur hier im Vertragscenter sichtbar – Kundinnen und Kunden sehen sie nirgends (Rechtstext-Seiten, Zustimmungen, Vertragsbestätigung). Bitte prüfen Sie in der „Kundenansicht“, ob der Text ohne sie vollständig ist. Veröffentlichte Versionen können nicht mehr geändert werden – Korrekturen erfolgen über eine neue Version.
          </p>
        </div>
      ),
      confirmLabel: 'Trotzdem veröffentlichen',
      cancelLabel: 'Abbrechen',
      tone: 'danger',
    });

  const publish = async (d: AdminLegalDocument, acknowledgeReview: boolean) => {
    try {
      await cloudBackend().adminLegalActivate(d.id, { acknowledgeReview });
    } catch (e) {
      // Server hat Prüfhinweise gefunden, die hier nicht gezählt wurden: ebenfalls bewusst bestätigen lassen
      if (!acknowledgeReview && e instanceof CloudError && e.code === 'OLR01') {
        if (await confirmReviewOverride(d, Math.max(1, countReviewMarkers(d.content) + countReviewMarkers(d.checkboxLabel)))) return publish(d, true);
        return;
      }
      throw e;
    }
  };

  const activate = async (d: AdminLegalDocument) => {
    const open = countReviewMarkers(d.content) + countReviewMarkers(d.checkboxLabel);
    const ok = open
      ? await confirmReviewOverride(d, open)
      : await confirmDialog({
          title: `${d.title} (Version ${d.version}) veröffentlichen?`,
          message: 'Die Version wird sofort für neue Registrierungen, Demos und Käufe verwendet. Eine bisher aktive Version desselben Typs und derselben Zielgruppe wird archiviert. Veröffentlichte Versionen können nicht mehr geändert werden.',
          confirmLabel: 'Veröffentlichen',
        });
    if (!ok) return;
    await run(() => publish(d, open > 0), `Version ${d.version} ist aktiv.`);
  };

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
                      {m.types.includes('imprint') ? m.label : `${m.label} (${m.audience.toUpperCase()})`}: {m.missing.map((t) => LEGAL_DOC_TYPE_LABEL[t]).join(', ')}
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
                          <td>
                            {d.title}
                            {countReviewMarkers(d.content) + countReviewMarkers(d.checkboxLabel) > 0 && (
                              <span
                                className="legal-review-count"
                                data-testid={d.status === 'draft' ? 'legal-review-count' : 'legal-review-count-published'}
                                title={d.status === 'draft' ? 'Offene [Prüfhinweis]-Markierungen – möglichst vor dem Veröffentlichen klären; Veröffentlichen ist nur nach ausdrücklicher Bestätigung möglich' : 'Diese Fassung wurde bewusst mit internen Prüfhinweisen veröffentlicht. Kunden sehen die Hinweise nicht. Klärung/Korrektur nur über eine neue Version'}
                              >
                                {countReviewMarkers(d.content) + countReviewMarkers(d.checkboxLabel)} Prüfhinweis{countReviewMarkers(d.content) + countReviewMarkers(d.checkboxLabel) === 1 ? '' : 'e'}
                              </span>
                            )}
                          </td>
                          <td className="legal-actions">
                            {d.status === 'draft' ? (
                              <>
                                <Button size="sm" variant="ghost" icon={PencilLine} onClick={() => setEditing({ id: d.id, type: d.type, audience: d.audience, version: d.version, title: d.title, content: d.content, checkboxLabel: d.checkboxLabel, effectiveFrom: d.effectiveFrom })}>
                                  Bearbeiten
                                </Button>
                                <Button size="sm" variant="ghost" icon={Eye} onClick={() => setPreview(d)}>
                                  Vorschau
                                </Button>
                                <Button size="sm" variant="primary" icon={Rocket} onClick={() => void activate(d)} data-testid="legal-activate">
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
        <Dialog title={`${preview.title} – Version ${preview.version}`} subtitle="Vorschau (intern, mit Prüfhinweisen)" onClose={() => setPreview(null)} width={760}>
          <LegalMarkdown content={preview.content} internal />
        </Dialog>
      )}
    </div>
  );
}

function LegalEditor({ initial, existingVersions, onClose, onSaved }: { initial: LegalDraftInput; existingVersions: string[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [d, setD] = useState<LegalDraftInput>(initial);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'edit' | 'preview' | 'customer'>('edit');
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
          <button type="button" className={tab === 'customer' ? 'is-on' : ''} onClick={() => setTab('customer')} data-testid="legal-preview-customer">
            Kundenansicht
          </button>
        </div>
        {tab === 'edit' ? (
          <TextArea label="Inhalt" value={d.content} onChange={(e) => set('content', e.target.value)} rows={14} hint="Formatierung: # Überschrift, ## Unterüberschrift, - Aufzählung, 1. Nummerierung, **fett**. Leerzeile = neuer Absatz." />
        ) : tab === 'preview' ? (
          <div className="legal-editor__preview">
            <LegalMarkdown content={d.content || '_(leer)_'} internal />
          </div>
        ) : (
          <div className="legal-editor__preview" data-testid="legal-customer-view">
            <p className="auth-note">So sehen Kundinnen und Kunden den Text: interne Prüfhinweise sind ausgeblendet.</p>
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

/* ------------------------------------------------------------------------------------------------ */
/* Kündigungen & Widerrufe (über die Website eingegangen)                                           */
/* ------------------------------------------------------------------------------------------------ */

const DECL_STATUS: Record<AdminDeclarationRow['status'], { label: string; tone: 'ok' | 'dev' | 'neutral' | 'warn' }> = {
  received: { label: 'Eingegangen', tone: 'dev' },
  processed: { label: 'Automatisch gekündigt', tone: 'ok' },
  needs_review: { label: 'Zu bearbeiten', tone: 'warn' },
  done: { label: 'Erledigt', tone: 'neutral' },
};

export function AdminDeclarationsPage() {
  usePageTitle('Kündigungen & Widerrufe');
  const [rows, setRows] = useState<AdminDeclarationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setRows(await cloudBackend().adminListDeclarations());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const mark = async (id: string, status: 'needs_review' | 'done') => {
    try {
      await cloudBackend().adminSetDeclarationStatus(id, status);
      notify(status === 'done' ? 'Als erledigt markiert.' : 'Wieder offen.');
      await load();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Fehler', 'warning');
    }
  };
  const open = (rows ?? []).filter((r) => r.status === 'needs_review' || r.status === 'received').length;
  const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('de-DE') : '–');
  return (
    <div className="page page--wide">
      <PageHeader
        eyebrow={
          <>
            <ShieldCheck size={13} /> Super-Admin
          </>
        }
        title="Kündigungen & Widerrufe"
        subtitle="Über „Verträge hier kündigen“ und „Vertrag widerrufen“ eingegangene Erklärungen. Ordentliche Kündigungen mit zugeordnetem Abo werden automatisch zum Periodenende wirksam; Widerrufe (Erstattung mit Wertersatz) und alles Übrige bearbeitest du in Stripe und markierst es hier als erledigt."
        actions={
          <Button icon={RefreshCcw} onClick={() => void load()}>
            Aktualisieren
          </Button>
        }
      />
      <AdminTabs />
      {error && <p className="ds-field__error">{error}</p>}
      {rows && open > 0 && (
        <p className="auth-note auth-note--warn" data-testid="declarations-open">
          <CircleAlert size={15} /> {open} Vorgang{open === 1 ? '' : 'e'} zu bearbeiten.
        </p>
      )}
      {rows === null ? (
        <p className="muted">Wird geladen …</p>
      ) : !rows.length ? (
        <EmptyState icon={Inbox} title="Keine Erklärungen" text="Hier erscheinen Kündigungen und Widerrufe, die über die Website eingehen." />
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table" data-testid="declarations-table">
            <thead>
              <tr>
                <th>Eingang</th>
                <th>Art</th>
                <th>Kunde</th>
                <th>Angaben</th>
                <th>Status</th>
                <th>E-Mails</th>
                <th aria-label="Aktionen" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-testid="declaration-row" data-kind={r.kind} data-status={r.status}>
                  <td>{dt(r.receivedAt)}</td>
                  <td>
                    {r.kind === 'withdrawal' ? 'Widerruf' : r.cancellationType === 'extraordinary' ? 'Kündigung (außerordentlich)' : 'Kündigung'}
                    {r.customerType && <span className="admin-sub">{r.customerType === 'private' ? 'B2C' : 'B2B'}</span>}
                  </td>
                  <td>
                    {r.name}
                    <span className="admin-sub">{r.email}</span>
                    {r.institutionName && <span className="admin-sub">{r.institutionName}</span>}
                  </td>
                  <td>
                    {r.contractDetails ?? '–'}
                    {r.reason && <span className="admin-sub">„{r.reason}“</span>}
                    {r.stripeSubscriptionId && <span className="admin-sub mono">{r.stripeSubscriptionId}</span>}
                    {r.unmatched && <span className="admin-sub">kein Abo zugeordnet</span>}
                  </td>
                  <td>
                    <Pill tone={DECL_STATUS[r.status].tone}>{DECL_STATUS[r.status].label}</Pill>
                    {r.cancelAt && <span className="admin-sub">endet zum {formatDate(r.cancelAt)}</span>}
                    {r.handledAt && <span className="admin-sub">erledigt {dt(r.handledAt)}</span>}
                  </td>
                  <td>
                    <span className="admin-sub">Bestätigung: {r.confirmationSentAt ? 'versendet' : 'nicht versendet'}</span>
                    <span className="admin-sub">Hinweis an dich: {r.notifiedAt ? 'versendet' : 'nicht versendet'}</span>
                  </td>
                  <td className="legal-actions">
                    {r.status === 'done' ? (
                      <Button size="sm" variant="ghost" onClick={() => void mark(r.id, 'needs_review')}>
                        Wieder öffnen
                      </Button>
                    ) : (
                      <Button size="sm" variant="primary" onClick={() => void mark(r.id, 'done')} data-testid="declaration-done-btn">
                        Erledigt
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
