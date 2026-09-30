/**
 * Super-Admin: Lebenszyklus der Kundenkonten (0.10.1).
 *
 * Drei klar getrennte Zustände:
 *  1. Lizenz abgelaufen      – Konto aktiv, Daten bleiben unbefristet (kein Löschwunsch!)
 *  2. Konto geschlossen      – Kunde hat geschlossen; Löschung fällig am [Datum]. Die automatische Löschung
 *                              (mail-jobs) erinnert 30 Tage vorher per E-Mail und löscht frühestens 14 Tage
 *                              nach der Erinnerung.
 *  3. Löschung beantragt     – Antrag (z. B. per E-Mail, Identität geprüft) – Ausführung hier.
 * Jede Löschung verlangt die erneute Eingabe des Admin-Passworts.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock, FileWarning, MailCheck, RefreshCcw, ShieldCheck, Trash2, UserX } from 'lucide-react';
import { Button, EmptyState, Notice, PageHeader, Pill, Tabs, TextField } from '@/ui/ds';
import { usePageTitle } from '../../usePageTitle';
import { cloudBackend } from '../../cloudSession';
import { AdminTabs } from './AdminLegalPage';
import { formatDate, LICENSE_STATUS_LABEL } from '@/cloud/plans';
import { translateError } from '@/cloud/errors';
import type { AccountLifecycleCategory, AccountLifecycleRow, LicenseStatus } from '@/cloud/types';
import { useAppStore } from '@/state/store';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notify = (t: string, tone: 'success' | 'warning' = 'success') => useAppStore.getState().notify(t, tone);

const CATEGORY: Record<AccountLifecycleCategory, { label: string; empty: string; desc: string }> = {
  deletion_requested: {
    label: 'Löschung beantragt',
    empty: 'Keine offenen Löschanträge.',
    desc: 'Erfasste Löschanträge (z. B. per E-Mail, Identität geprüft). Bitte zeitnah ausführen – spätestens innerhalb eines Monats (Art. 12 Abs. 3 DSGVO).',
  },
  closed: {
    label: 'Konto geschlossen',
    empty: 'Keine geschlossenen Konten.',
    desc: 'Vom Kunden geschlossen. Wiederöffnen ist bis zum Fälligkeitsdatum möglich. Automatisch: Erinnerung 30 Tage vorher, Löschung frühestens 14 Tage nach der Erinnerung.',
  },
  license_ended: {
    label: 'Lizenz abgelaufen',
    empty: 'Keine Konten mit abgelaufener Lizenz.',
    desc: 'Lizenz beendet (Kündigung, Ablauf oder Demo-Ende). Das ist kein Löschwunsch: Konto und Simulationen bleiben erhalten, bis der Kunde das Konto schließt oder die Löschung verlangt.',
  },
};

function reminderInfo(r: AccountLifecycleRow) {
  if (r.deletionReminderSentAt) return `Erinnerung versendet am ${formatDate(r.deletionReminderSentAt)}`;
  if (r.deletionDueAt && Date.parse(r.deletionDueAt) - Date.now() <= 30 * 86_400_000) return 'Erinnerung ausstehend (E-Mail-Versand prüfen)';
  return 'Erinnerung 30 Tage vor Fälligkeit';
}

export function AdminAccountsPage() {
  usePageTitle('Kontoschließung & Löschung');
  const [rows, setRows] = useState<AccountLifecycleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<AccountLifecycleCategory>('deletion_requested');
  const [target, setTarget] = useState('');
  const [pw, setPw] = useState('');
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [reqEmail, setReqEmail] = useState('');
  const [reqNote, setReqNote] = useState('');
  const [reqBusy, setReqBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await cloudBackend().adminAccountLifecycle());
      setError(null);
    } catch (e) {
      setError(translateError(e).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const c = { deletion_requested: 0, closed: 0, license_ended: 0 } as Record<AccountLifecycleCategory, number>;
    for (const r of rows ?? []) c[r.category]++;
    return c;
  }, [rows]);
  const list = (rows ?? []).filter((r) => r.category === tab);
  const selected = rows?.find((r) => r.userId === target.trim());
  const now = Date.now();

  const runDelete = async () => {
    setBusy(true);
    setFormError(null);
    try {
      const b = cloudBackend();
      await b.reauthenticate(pw);
      await b.deleteAccount(word, target.trim());
      notify('Konto gelöscht. Die Bestätigung wurde an die bisherige E-Mail-Adresse gesendet.');
      setTarget('');
      setPw('');
      setWord('');
      await load();
    } catch (e) {
      setFormError(translateError(e).message);
    } finally {
      setBusy(false);
    }
  };

  const recordRequest = async () => {
    setReqBusy(true);
    try {
      const id = await cloudBackend().adminRequestDeletionByEmail(reqEmail.trim(), reqNote.trim() || null);
      notify('Löschantrag erfasst.');
      setReqEmail('');
      setReqNote('');
      setTab('deletion_requested');
      setTarget(id);
      await load();
    } catch (e) {
      notify(translateError(e).message, 'warning');
    } finally {
      setReqBusy(false);
    }
  };

  const clearRequest = async (r: AccountLifecycleRow) => {
    try {
      await cloudBackend().adminSetDeletionRequest(r.userId, false);
      notify('Löschantrag zurückgenommen.');
      await load();
    } catch (e) {
      notify(translateError(e).message, 'warning');
    }
  };

  return (
    <div className="page page--wide">
      <PageHeader
        eyebrow={
          <>
            <ShieldCheck size={13} /> Super-Admin
          </>
        }
        title="Kontoschließung & Löschung"
        subtitle="Lizenzende ist kein Löschwunsch. Automatisch gelöscht werden nur ausdrücklich geschlossene Konten nach 12 Monaten. Rechnungen (Stripe) und gesetzliche Nachweise bleiben nach ihren eigenen Fristen erhalten."
        actions={
          <Button icon={RefreshCcw} onClick={() => void load()}>
            Aktualisieren
          </Button>
        }
      />
      <AdminTabs />
      {error && <p className="ds-field__error">{error}</p>}

      <div className="lib-tabs">
        <Tabs<AccountLifecycleCategory>
          value={tab}
          onChange={setTab}
          items={[
            { value: 'deletion_requested', label: CATEGORY.deletion_requested.label, count: counts.deletion_requested, icon: FileWarning },
            { value: 'closed', label: CATEGORY.closed.label, count: counts.closed, icon: UserX },
            { value: 'license_ended', label: CATEGORY.license_ended.label, count: counts.license_ended, icon: Clock },
          ]}
        />
      </div>
      <p className="account-section__desc" data-testid="lifecycle-desc">
        {CATEGORY[tab].desc}
      </p>

      {rows === null && !error ? (
        <p className="muted">Wird geladen …</p>
      ) : !list.length ? (
        <EmptyState icon={UserX} title={CATEGORY[tab].empty} />
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table" data-testid="lifecycle-table" data-category={tab}>
            <thead>
              <tr>
                <th>Konto</th>
                {tab === 'license_ended' && (
                  <>
                    <th>Lizenz</th>
                    <th>Ende</th>
                  </>
                )}
                {tab === 'closed' && (
                  <>
                    <th>Geschlossen am</th>
                    <th>Löschung fällig am</th>
                    <th>Erinnerung</th>
                  </>
                )}
                {tab === 'deletion_requested' && (
                  <>
                    <th>Beantragt am</th>
                    <th>Notiz</th>
                  </>
                )}
                <th>Simulationen</th>
                <th aria-label="Aktionen" />
              </tr>
            </thead>
            <tbody>
              {list.map((r) => {
                const overdue = !!r.deletionDueAt && Date.parse(r.deletionDueAt) <= now;
                return (
                  <tr key={r.userId} data-testid="lifecycle-row" data-email={r.email} data-category={r.category}>
                    <td>
                      <strong>{r.institutionName || `${r.firstName} ${r.lastName}`.trim() || '–'}</strong>
                      <small>{r.email}</small>
                    </td>
                    {tab === 'license_ended' && (
                      <>
                        <td>{r.licenseSource === 'demo' ? 'Demo beendet' : r.licenseStatus ? (LICENSE_STATUS_LABEL[r.licenseStatus as LicenseStatus] ?? r.licenseStatus) : '–'}</td>
                        <td>{formatDate(r.licenseValidUntil)}</td>
                      </>
                    )}
                    {tab === 'closed' && (
                      <>
                        <td>{formatDate(r.closedAt)}</td>
                        <td data-testid="lifecycle-due">{overdue ? <Pill tone="danger">fällig seit {formatDate(r.deletionDueAt)}</Pill> : formatDate(r.deletionDueAt)}</td>
                        <td>
                          <span className="admin-sub">
                            {r.deletionReminderSentAt && <MailCheck size={12} />} {reminderInfo(r)}
                          </span>
                        </td>
                      </>
                    )}
                    {tab === 'deletion_requested' && (
                      <>
                        <td>{formatDate(r.deletionRequestedAt)}</td>
                        <td>{r.deletionRequestNote ?? '–'}</td>
                      </>
                    )}
                    <td>{r.simulations}</td>
                    <td>
                      <span className="admin-actions">
                        {tab !== 'license_ended' && (
                          <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setTarget(r.userId)}>
                            Zur Löschung auswählen
                          </Button>
                        )}
                        {tab === 'deletion_requested' && (
                          <Button size="sm" variant="ghost" onClick={() => void clearRequest(r)}>
                            Antrag zurücknehmen
                          </Button>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <section className="page-section" data-testid="admin-request">
        <div className="page-section__head">
          <h2 className="page-section__title">
            <FileWarning size={16} /> Löschantrag erfassen
          </h2>
        </div>
        <p className="account-section__desc">Für Löschanträge, die per E-Mail oder Post eingehen. Bitte vorher die Identität prüfen (Antrag von der hinterlegten E-Mail-Adresse).</p>
        <form
          className="account-form"
          onSubmit={(e) => {
            e.preventDefault();
            void recordRequest();
          }}
        >
          <div className="form-row">
            <TextField label="E-Mail-Adresse des Kontos" type="email" value={reqEmail} onChange={(e) => setReqEmail(e.target.value)} />
            <TextField label="Notiz (optional)" value={reqNote} onChange={(e) => setReqNote(e.target.value)} placeholder="z. B. E-Mail vom 30.09., Identität geprüft" maxLength={500} />
          </div>
          <div className="form-actions">
            <Button type="submit" loading={reqBusy} disabled={!reqEmail.includes('@')}>
              Antrag erfassen
            </Button>
          </div>
        </form>
      </section>

      <section className="page-section" data-testid="admin-delete">
        <div className="page-section__head">
          <h2 className="page-section__title">
            <Trash2 size={16} /> Konto endgültig löschen
          </h2>
        </div>
        <Notice tone="warn" className="page-notice">
          Nur bei einem Löschantrag der betroffenen Person oder einem geschlossenen Konto nach Fristablauf. Gelöscht werden Konto, Simulationen, Vorlagen, Einstellungen und Stammdaten; Rechnungen und Nachweise bleiben. Konten mit laufendem, nicht gekündigtem Abonnement können nicht gelöscht werden.
        </Notice>
        <form
          className="account-form"
          onSubmit={(e) => {
            e.preventDefault();
            void runDelete();
          }}
        >
          <TextField label="Benutzer-ID (UUID)" value={target} onChange={(e) => setTarget(e.target.value)} hint={selected ? `${selected.email} · ${CATEGORY[selected.category].label}` : 'Aus der Liste auswählen.'} error={target && !UUID_RE.test(target.trim()) ? 'Keine gültige UUID.' : null} />
          <div className="form-row">
            <TextField label="Ihr Admin-Passwort" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
            <TextField label="Zur Bestätigung „LÖSCHEN“ eingeben" value={word} onChange={(e) => setWord(e.target.value)} autoComplete="off" />
          </div>
          {formError && (
            <p className="ds-field__error" role="alert">
              {formError}
            </p>
          )}
          <div className="form-actions">
            <Button type="submit" variant="danger" icon={Trash2} loading={busy} disabled={!UUID_RE.test(target.trim()) || !pw || word.trim().toUpperCase() !== 'LÖSCHEN'}>
              Konto löschen
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
