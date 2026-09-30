/**
 * Super-Admin: geschlossene Konten und Löschung auf Antrag (0.10.0).
 *
 * Geschlossene Konten werden nach Ablauf der Aufbewahrungsfrist (12 Monate) NICHT automatisch gelöscht –
 * die Liste zeigt fällige Konten; die Löschung erfolgt bewusst hier (bzw. künftig per geplantem Job,
 * sobald die Betreiberentscheidung dazu vorliegt). Löschanträge per E-Mail (Art. 17 DSGVO) werden
 * ebenfalls hier ausgeführt. Jede Löschung verlangt die erneute Eingabe des Admin-Passworts.
 */
import { useCallback, useEffect, useState } from 'react';
import { RefreshCcw, ShieldCheck, Trash2, UserX } from 'lucide-react';
import { Button, EmptyState, Notice, PageHeader, Pill, TextField } from '@/ui/ds';
import { usePageTitle } from '../../usePageTitle';
import { cloudBackend } from '../../cloudSession';
import { AdminTabs } from './AdminLegalPage';
import { formatDate } from '@/cloud/plans';
import { translateError } from '@/cloud/errors';
import { useAppStore } from '@/state/store';

type ClosedRow = Awaited<ReturnType<ReturnType<typeof cloudBackend>['adminClosedAccounts']>>[number];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function AdminAccountsPage() {
  usePageTitle('Kontoschließung & Löschung');
  const [rows, setRows] = useState<ClosedRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState('');
  const [pw, setPw] = useState('');
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await cloudBackend().adminClosedAccounts());
      setError(null);
    } catch (e) {
      setError(translateError(e).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const now = Date.now();
  const selected = rows?.find((r) => r.userId === target.trim());
  const run = async () => {
    setBusy(true);
    setFormError(null);
    try {
      const b = cloudBackend();
      await b.reauthenticate(pw);
      await b.deleteAccount(word, target.trim());
      useAppStore.getState().notify('Konto gelöscht. Die Bestätigung wurde an die bisherige E-Mail-Adresse gesendet.', 'success');
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

  return (
    <div className="page page--wide">
      <PageHeader
        eyebrow={
          <>
            <ShieldCheck size={13} /> Super-Admin
          </>
        }
        title="Kontoschließung & Löschung"
        subtitle="Geschlossene Konten (Aufbewahrung 12 Monate) und Löschung auf Antrag. Gelöscht werden Konto, Inhalte und Stammdaten; Rechnungen in Stripe und gesetzliche Nachweise bleiben erhalten."
        actions={
          <Button icon={RefreshCcw} onClick={() => void load()}>
            Aktualisieren
          </Button>
        }
      />
      <AdminTabs />
      {error && <p className="ds-field__error">{error}</p>}
      {rows === null && !error ? (
        <p className="muted">Wird geladen …</p>
      ) : rows && !rows.length ? (
        <EmptyState icon={UserX} title="Keine geschlossenen Konten" text="Hier erscheinen Konten, die Kundinnen und Kunden selbst geschlossen haben." />
      ) : rows ? (
        <div className="admin-table-wrap">
          <table className="admin-table" data-testid="closed-accounts-table">
            <thead>
              <tr>
                <th>Konto</th>
                <th>Geschlossen am</th>
                <th>Löschung fällig</th>
                <th>Simulationen</th>
                <th aria-label="Aktionen" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const due = !!r.deletionDueAt && Date.parse(r.deletionDueAt) <= now;
                return (
                  <tr key={r.userId} data-testid="closed-account-row" data-email={r.email}>
                    <td>
                      <strong>{r.institutionName || '–'}</strong>
                      <small>{r.email}</small>
                    </td>
                    <td>{formatDate(r.closedAt)}</td>
                    <td>{due ? <Pill tone="danger">fällig seit {formatDate(r.deletionDueAt)}</Pill> : formatDate(r.deletionDueAt)}</td>
                    <td>{r.simulations}</td>
                    <td>
                      <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setTarget(r.userId)}>
                        Zur Löschung auswählen
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <section className="page-section" data-testid="admin-delete">
        <div className="page-section__head">
          <h2 className="page-section__title">
            <Trash2 size={16} /> Konto endgültig löschen
          </h2>
        </div>
        <Notice tone="warn" className="page-notice">
          Nur ausführen, wenn das Konto geschlossen und die Frist abgelaufen ist oder ein Löschantrag der betroffenen Person vorliegt (Identität geprüft). Konten mit laufendem, nicht gekündigtem Abonnement können nicht gelöscht werden.
        </Notice>
        <form
          className="account-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <TextField label="Benutzer-ID (UUID)" value={target} onChange={(e) => setTarget(e.target.value)} hint={selected ? `${selected.email} · ${selected.institutionName}` : 'Aus der Liste auswählen oder die ID aus Supabase einfügen.'} error={target && !UUID_RE.test(target.trim()) ? 'Keine gültige UUID.' : null} />
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
