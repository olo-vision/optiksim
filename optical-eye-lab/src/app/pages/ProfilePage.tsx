/**
 * Profil: Name, Anzeigename, Avatar, optionale Angaben, Passwort ändern.
 * Bewusst sparsam – keine Pflichtangaben über Name und E-Mail hinaus.
 */
import { useState } from 'react';
import { ImagePlus, KeyRound, Save, Trash2 } from 'lucide-react';
import { useSession, errorMessage } from '../session';
import { platform } from '../platformInstance';
import { Avatar, Button, Card, PageHeader, Pill, TextField } from '@/ui/ds';
import { useAppStore } from '@/state/store';
import { roleLabel } from '@/platform/permissions';
import { ORG_TYPE_LABELS } from '@/platform/models';
import { pickImage, resizeImageFile } from '../imageUtils';
import { AuthError } from '@/platform/auth';
import { usePageTitle } from '../usePageTitle';

const COLORS = ['#4cc2ff', '#45d6a0', '#ffb547', '#c38bff', '#ff8a80', '#5ad1c9', '#f2a1d0', '#9fb4ff'];
const dtf = new Intl.DateTimeFormat('de-DE', { dateStyle: 'long', timeStyle: 'short' });

export function ProfilePage() {
  usePageTitle('Profil');
  const user = useSession((s) => s.user)!;
  const org = useSession((s) => s.org);
  const notify = useAppStore((s) => s.notify);
  const [form, setForm] = useState({
    firstName: user.firstName,
    lastName: user.lastName,
    displayName: user.displayName,
    jobTitle: user.jobTitle ?? '',
    trainingStatus: user.trainingStatus ?? '',
    department: user.department ?? '',
  });
  const [avatar, setAvatar] = useState<{ src?: string; color: string }>({ src: user.avatarDataUrl, color: user.avatarColor });
  const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState({ current: '', next: '', repeat: '' });
  const [pwErr, setPwErr] = useState<string | null>(null);
  const isGuest = user.role === 'guest';
  const f = (k: keyof typeof form) => ({ value: form[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value }) });

  const save = async () => {
    setBusy(true);
    try {
      await platform.accounts.updateProfile(user, {
        ...form,
        jobTitle: form.jobTitle.trim() || undefined,
        trainingStatus: form.trainingStatus.trim() || undefined,
        department: form.department.trim() || undefined,
        avatarDataUrl: avatar.src,
        avatarColor: avatar.color,
      });
      await useSession.getState().refreshUser();
      notify('Profil gespeichert', 'success');
    } catch (e) {
      notify(errorMessage(e), 'warning');
    }
    setBusy(false);
  };

  const changePassword = async () => {
    setPwErr(null);
    if (pw.next !== pw.repeat) {
      setPwErr('Die neuen Passwörter stimmen nicht überein.');
      return;
    }
    try {
      await platform.auth.changePassword(user.id, pw.current, pw.next);
      setPw({ current: '', next: '', repeat: '' });
      notify('Passwort geändert', 'success');
    } catch (e) {
      setPwErr(e instanceof AuthError ? e.message : errorMessage(e));
    }
  };

  return (
    <div className="page page--narrow">
      <PageHeader title="Profil" subtitle="Deine Angaben werden nur lokal auf diesem Gerät gespeichert." />
      <div className="profile-grid">
        <Card>
          <div className="profile-avatar">
            <Avatar name={form.displayName || user.displayName} color={avatar.color} src={avatar.src} size={84} />
            <div className="profile-avatar__actions">
              <Button
                size="sm"
                icon={ImagePlus}
                disabled={isGuest}
                onClick={async () => {
                  const file = await pickImage();
                  if (!file) return;
                  try {
                    setAvatar({ ...avatar, src: await resizeImageFile(file, 160, 'image/jpeg') });
                  } catch (e) {
                    notify(errorMessage(e), 'warning');
                  }
                }}
              >
                Bild wählen
              </Button>
              {avatar.src && (
                <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setAvatar({ ...avatar, src: undefined })}>
                  Entfernen
                </Button>
              )}
            </div>
            {!avatar.src && (
              <div className="color-row" role="radiogroup" aria-label="Avatarfarbe">
                {COLORS.map((c) => (
                  <button key={c} type="button" role="radio" aria-checked={avatar.color === c} className={`color-dot${avatar.color === c ? ' is-active' : ''}`} style={{ background: c }} onClick={() => setAvatar({ ...avatar, color: c })} aria-label={`Farbe ${c}`} />
                ))}
              </div>
            )}
          </div>
          <dl className="profile-facts">
            <dt>E-Mail</dt>
            <dd>{user.email}</dd>
            <dt>Rolle</dt>
            <dd>
              <Pill tone="accent">{roleLabel(user.role, org?.type)}</Pill>
            </dd>
            {org && (
              <>
                <dt>Organisation</dt>
                <dd>
                  {org.name} <small>({ORG_TYPE_LABELS[org.type]})</small>
                </dd>
              </>
            )}
            <dt>Konto erstellt</dt>
            <dd>{dtf.format(new Date(user.createdAt))}</dd>
            {user.lastLoginAt && (
              <>
                <dt>Letzte Anmeldung</dt>
                <dd>{dtf.format(new Date(user.lastLoginAt))}</dd>
              </>
            )}
          </dl>
        </Card>

        <Card>
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <h2 className="card-title">Persönliche Angaben</h2>
            <div className="form-row">
              <TextField label="Vorname" {...f('firstName')} disabled={isGuest} autoComplete="given-name" />
              <TextField label="Nachname" optional {...f('lastName')} disabled={isGuest} autoComplete="family-name" />
            </div>
            <TextField label="Anzeigename" hint="So erscheinst du in der Oberfläche." {...f('displayName')} disabled={isGuest} />
            <div className="form-row">
              <TextField label="Tätigkeit" optional placeholder="z. B. Augenoptiker/in" {...f('jobTitle')} disabled={isGuest} />
              <TextField label="Ausbildungsstand" optional placeholder="z. B. 2. Lehrjahr" {...f('trainingStatus')} disabled={isGuest} />
            </div>
            <TextField label="Abteilung / Klasse" optional {...f('department')} disabled={isGuest} />
            <div className="form-actions">
              <Button type="submit" variant="primary" icon={Save} loading={busy} disabled={isGuest}>
                Profil speichern
              </Button>
            </div>
            {isGuest && <p className="ds-field__hint">Im Gastzugang kann das Profil nicht bearbeitet werden.</p>}
          </form>
        </Card>

        {!isGuest && (
          <Card>
            <form
              className="form-stack"
              onSubmit={(e) => {
                e.preventDefault();
                void changePassword();
              }}
            >
              <h2 className="card-title">Passwort ändern</h2>
              <p className="ds-field__hint">Das Passwort schützt nur die lokale Kontoauswahl auf diesem Gerät – es ist keine abgesicherte Anmeldung.</p>
              <TextField label="Aktuelles Passwort" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
              <div className="form-row">
                <TextField label="Neues Passwort" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
                <TextField label="Wiederholen" type="password" autoComplete="new-password" value={pw.repeat} onChange={(e) => setPw({ ...pw, repeat: e.target.value })} />
              </div>
              {pwErr && <p className="ds-field__error">{pwErr}</p>}
              <div className="form-actions">
                <Button type="submit" icon={KeyRound} disabled={!pw.current || !pw.next}>
                  Passwort ändern
                </Button>
              </div>
            </form>
          </Card>
        )}
      </div>
    </div>
  );
}
