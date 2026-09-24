/**
 * Administration: Benutzer hinzufügen, bearbeiten, Rolle ändern, deaktivieren, Passwort zurücksetzen.
 */
import { useEffect, useMemo, useState } from 'react';
import { KeyRound, Pencil, Power, UserPlus, Users } from 'lucide-react';
import { useSession, errorMessage } from '../session';
import { platform } from '../platformInstance';
import { Avatar, Button, EmptyState, PageHeader, Pill, SearchInput, SelectField, TextField } from '@/ui/ds';
import { Dialog } from '@/ui/common/overlays';
import { useAppStore } from '@/state/store';
import { roleLabel } from '@/platform/permissions';
import { ROLE_ORDER, type Role, type User } from '@/platform/models';
import { AuthError } from '@/platform/auth';
import { promptDialog, confirmDialog } from '@/ui/ds/modals';
import { relativeTime } from '../library/visuals';
import { usePageTitle } from '../usePageTitle';

function UserDialog({ existing, onClose, onDone }: { existing?: User; onClose: () => void; onDone: () => void }) {
  const actor = useSession((s) => s.user)!;
  const org = useSession((s) => s.org);
  const [form, setForm] = useState({
    firstName: existing?.firstName ?? '',
    lastName: existing?.lastName ?? '',
    email: existing?.email ?? '',
    role: (existing?.role ?? org?.defaultRole ?? 'member') as Role,
    password: '',
    jobTitle: existing?.jobTitle ?? '',
    department: existing?.department ?? '',
  });
  const [err, setErr] = useState<{ msg: string; field?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (existing)
        await platform.accounts.updateUser(actor, existing.id, {
          firstName: form.firstName,
          lastName: form.lastName,
          role: form.role,
          jobTitle: form.jobTitle.trim() || undefined,
          department: form.department.trim() || undefined,
        });
      else await platform.accounts.createUser(actor, form);
      useAppStore.getState().notify(existing ? 'Benutzer aktualisiert' : `${form.firstName} wurde angelegt`, 'success');
      onDone();
    } catch (e) {
      setErr({ msg: errorMessage(e), field: e instanceof AuthError ? e.field : undefined });
      setBusy(false);
    }
  };
  const fe = (f: string) => (err?.field === f ? err.msg : null);
  return (
    <Dialog
      title={existing ? 'Benutzer bearbeiten' : 'Benutzer hinzufügen'}
      subtitle={existing ? existing.email : 'Das Konto wird lokal auf diesem Gerät angelegt.'}
      onClose={onClose}
      width={540}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button variant="primary" icon={existing ? Pencil : UserPlus} loading={busy} onClick={() => void submit()}>
            {existing ? 'Speichern' : 'Anlegen'}
          </Button>
        </>
      }
    >
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="form-row">
          <TextField label="Vorname" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} error={fe('firstName')} autoFocus />
          <TextField label="Nachname" optional value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
        </div>
        {!existing && <TextField label="E-Mail" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={fe('email')} />}
        <SelectField<Role>
          label="Rolle"
          value={form.role}
          onChange={(role) => setForm({ ...form, role })}
          options={ROLE_ORDER.map((r) => ({ value: r, label: roleLabel(r, org?.type) }))}
          hint="Administration: alles · Trainer/in: Vorlagen für die Organisation · Nutzer/in: eigene Simulationen · Gast: eingeschränkt"
        />
        <div className="form-row">
          <TextField label="Tätigkeit" optional value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} />
          <TextField label="Abteilung / Klasse" optional value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
        </div>
        {!existing && (
          <TextField
            label="Start-Passwort"
            type="text"
            autoComplete="off"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            error={fe('password')}
            hint="Teile es der Person mit; sie kann es im Profil ändern. Lokale Demo-Anmeldung ohne echte Kontosicherheit."
          />
        )}
        {err && !err.field && <p className="ds-field__error">{err.msg}</p>}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

export function AdminUsersPage() {
  usePageTitle('Benutzer');
  const actor = useSession((s) => s.user)!;
  const org = useSession((s) => s.org);
  const notify = useAppStore((s) => s.notify);
  const [users, setUsers] = useState<User[]>([]);
  const [q, setQ] = useState('');
  const [dialog, setDialog] = useState<{ user?: User } | null>(null);
  const load = async () => setUsers(await platform.accounts.listUsers(actor));
  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return users
      .filter((u) => !s || `${u.displayName} ${u.email} ${u.department ?? ''}`.toLowerCase().includes(s))
      .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.displayName.localeCompare(b.displayName, 'de'));
  }, [users, q]);

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      notify(msg, 'success');
      await load();
      await useSession.getState().refreshUser();
    } catch (e) {
      notify(errorMessage(e), 'warning');
    }
  };

  const toggleActive = async (u: User) => {
    if (u.active) {
      const ok = await confirmDialog({ title: `${u.displayName} deaktivieren?`, message: 'Das Konto kann sich nicht mehr anmelden. Simulationen bleiben erhalten; du kannst es jederzeit wieder aktivieren.', confirmLabel: 'Deaktivieren', tone: 'danger' });
      if (!ok) return;
    }
    await act(() => platform.accounts.setActive(actor, u.id, !u.active), u.active ? `${u.displayName} deaktiviert` : `${u.displayName} aktiviert`);
  };

  const resetPw = async (u: User) => {
    const pw = await promptDialog({ title: 'Passwort zurücksetzen', label: `Neues Passwort für ${u.displayName}`, confirmLabel: 'Setzen', validate: (v) => (v.length < 4 ? 'Mindestens 4 Zeichen.' : null) });
    if (pw) await act(() => platform.accounts.resetPassword(actor, u.id, pw), 'Passwort gesetzt');
  };

  const activeCount = users.filter((u) => u.active && u.role !== 'guest').length;

  return (
    <div className="page">
      <PageHeader
        title="Benutzer"
        subtitle={
          <>
            {activeCount} aktive Konten auf diesem Gerät{org ? ` · ${org.name}` : ''}. Lizenzen und Benutzerlimits <Pill tone="dev">In Entwicklung</Pill>
          </>
        }
        actions={
          <Button variant="primary" icon={UserPlus} onClick={() => setDialog({})}>
            Benutzer hinzufügen
          </Button>
        }
      />
      <div className="lib-toolbar">
        <SearchInput value={q} onChange={setQ} placeholder="Name, E-Mail oder Abteilung …" />
      </div>
      {shown.length === 0 ? (
        <EmptyState icon={Users} title="Keine Benutzer gefunden" />
      ) : (
        <div className="user-table" role="table" aria-label="Benutzer">
          <div className="user-table__row user-table__row--head" role="row">
            <span role="columnheader">Name</span>
            <span role="columnheader">Rolle</span>
            <span role="columnheader">Status</span>
            <span role="columnheader">Letzte Anmeldung</span>
            <span role="columnheader" aria-label="Aktionen" />
          </div>
          {shown.map((u) => (
            <div key={u.id} className={`user-table__row${u.active ? '' : ' is-inactive'}`} role="row" data-user-email={u.email}>
              <span className="user-table__name" role="cell">
                <Avatar name={u.displayName} color={u.avatarColor} src={u.avatarDataUrl} size={30} />
                <span>
                  <strong>
                    {u.displayName}
                    {u.id === actor.id && <small> (du)</small>}
                  </strong>
                  <small>{u.email}</small>
                </span>
                {u.isDemo && <Pill>Demo</Pill>}
              </span>
              <span role="cell">
                <select
                  className="ds-input ds-select ds-select--inline"
                  aria-label={`Rolle von ${u.displayName}`}
                  value={u.role}
                  disabled={u.id === 'user_guest'}
                  onChange={(e) => void act(() => platform.accounts.updateUser(actor, u.id, { role: e.target.value as Role }), 'Rolle geändert')}
                >
                  {ROLE_ORDER.map((r) => (
                    <option key={r} value={r}>
                      {roleLabel(r, org?.type)}
                    </option>
                  ))}
                </select>
              </span>
              <span role="cell">{u.active ? <Pill tone="ok">Aktiv</Pill> : <Pill tone="warn">Deaktiviert</Pill>}</span>
              <span role="cell">{u.lastLoginAt ? relativeTime(u.lastLoginAt) : 'noch nie'}</span>
              <span role="cell" className="user-table__actions">
                <Button size="sm" variant="ghost" icon={Pencil} aria-label={`${u.displayName} bearbeiten`} data-tip="Bearbeiten" onClick={() => setDialog({ user: u })} disabled={u.id === 'user_guest'} />
                <Button size="sm" variant="ghost" icon={KeyRound} aria-label={`Passwort von ${u.displayName} zurücksetzen`} data-tip="Passwort zurücksetzen" onClick={() => void resetPw(u)} disabled={u.id === 'user_guest'} />
                <Button
                  size="sm"
                  variant="ghost"
                  icon={Power}
                  aria-label={u.active ? `${u.displayName} deaktivieren` : `${u.displayName} aktivieren`}
                  data-tip={u.active ? 'Deaktivieren' : 'Aktivieren'}
                  onClick={() => void toggleActive(u)}
                  disabled={u.id === actor.id}
                />
              </span>
            </div>
          ))}
        </div>
      )}
      {dialog && (
        <UserDialog
          existing={dialog.user}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            void load();
          }}
        />
      )}
    </div>
  );
}
