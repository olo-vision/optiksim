/**
 * Administration: Organisation und Branding (Produktname, Logo, Akzentfarbe, Firmenname),
 * Standardrolle neuer Konten und empfohlene Vorlagen.
 */
import { useEffect, useState } from 'react';
import { Building2, ImagePlus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { useSession, errorMessage } from '../session';
import { platform } from '../platformInstance';
import { BrandMark } from '../Brand';
import { Button, Card, EmptyState, PageHeader, Pill, SelectField, TextField } from '@/ui/ds';
import { useAppStore } from '@/state/store';
import { ORG_TYPE_LABELS, type Organization, type OrganizationType, type Role } from '@/platform/models';
import { roleLabel } from '@/platform/permissions';
import { ACCENT_PRESETS, applyAccent, DEFAULT_BRANDING, isValidHex } from '@/platform/branding';
import { pickImage, resizeImageFile } from '../imageUtils';
import { usePageTitle } from '../usePageTitle';

export function AdminOrganizationPage() {
  usePageTitle('Organisation');
  const actor = useSession((s) => s.user)!;
  const org = useSession((s) => s.org);
  const templates = useSession((s) => s.templates);
  const notify = useAppStore((s) => s.notify);
  const [draft, setDraft] = useState<Organization | null>(org);
  const [busy, setBusy] = useState(false);

  useEffect(() => setDraft(org), [org]);
  // Akzentfarbe live vorschauen; beim Verlassen ohne Speichern zurücksetzen
  useEffect(() => {
    if (draft && isValidHex(draft.branding.accentColor)) applyAccent(draft.branding.accentColor);
  }, [draft?.branding.accentColor]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => applyAccent(useSession.getState().org?.branding.accentColor), []);

  if (!org || !draft) return <div className="page"><EmptyState icon={Building2} title="Keine Organisation" text="Dein Konto ist keiner Organisation zugeordnet." /></div>;

  const b = draft.branding;
  const setB = (patch: Partial<Organization['branding']>) => setDraft({ ...draft, branding: { ...b, ...patch } });
  const save = async () => {
    setBusy(true);
    try {
      await platform.accounts.updateOrganization(actor, org.id, {
        name: draft.name,
        type: draft.type,
        defaultRole: draft.defaultRole,
        featuredTemplateIds: draft.featuredTemplateIds,
        branding: draft.branding,
      });
      await useSession.getState().refreshUser();
      notify('Organisation gespeichert', 'success');
    } catch (e) {
      notify(errorMessage(e), 'warning');
    }
    setBusy(false);
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(org);

  return (
    <div className="page page--narrow">
      <PageHeader
        title="Organisation"
        subtitle="Name, Art, Standardrolle und Erscheinungsbild für alle Konten dieser Organisation."
        actions={
          <Button variant="primary" icon={Save} loading={busy} disabled={!dirty} onClick={() => void save()}>
            Änderungen speichern
          </Button>
        }
      />
      <div className="profile-grid">
        <Card>
          <div className="form-stack">
            <h2 className="card-title">Allgemein</h2>
            <TextField label="Name der Organisation" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <div className="form-stack">
              <SelectField<OrganizationType> label="Art" value={draft.type} onChange={(type) => setDraft({ ...draft, type })} options={Object.entries(ORG_TYPE_LABELS).map(([value, label]) => ({ value: value as OrganizationType, label }))} hint="Bestimmt die Rollenbezeichnungen (z. B. Lehrkraft / Schüler/in)." />
              <SelectField<Role>
                label="Standardrolle neuer Konten"
                value={draft.defaultRole}
                onChange={(defaultRole) => setDraft({ ...draft, defaultRole })}
                options={(['trainer', 'member', 'guest'] as Role[]).map((r) => ({ value: r, label: roleLabel(r, draft.type) }))}
              />
            </div>
            <div className="setting-note">
              Lizenzierung, Benutzerlimits und Cloud-Synchronisierung <Pill tone="dev">In Entwicklung</Pill>
            </div>
          </div>
        </Card>

        <Card>
          <div className="form-stack">
            <h2 className="card-title">Branding</h2>
            <div className="brand-preview" aria-label="Vorschau">
              {b.logoDataUrl ? <img src={b.logoDataUrl} alt="" className="brand__logo" /> : <BrandMark size={26} />}
              <span className="brand-preview__name">{b.productName || DEFAULT_BRANDING.productName}</span>
              <span className="brand-preview__btn">Primäraktion</span>
            </div>
            <div className="form-row">
              <TextField label="Produktname" value={b.productName} maxLength={40} onChange={(e) => setB({ productName: e.target.value })} hint="Erscheint in Navigation, Anmeldung und Fenstertitel." />
              <TextField label="Firmenname" optional value={b.companyName ?? ''} onChange={(e) => setB({ companyName: e.target.value || undefined })} />
            </div>
            <div className="ds-field">
              <span className="ds-field__label">Akzentfarbe</span>
              <div className="color-row">
                {ACCENT_PRESETS.map((c) => (
                  <button key={c} type="button" className={`color-dot${b.accentColor.toLowerCase() === c ? ' is-active' : ''}`} style={{ background: c }} onClick={() => setB({ accentColor: c })} aria-label={`Akzentfarbe ${c}`} />
                ))}
                <input type="color" className="color-input" value={isValidHex(b.accentColor) ? b.accentColor : '#4cc2ff'} onChange={(e) => setB({ accentColor: e.target.value })} aria-label="Eigene Akzentfarbe" />
                <input className="ds-input ds-input--mono ds-input--short" value={b.accentColor} onChange={(e) => setB({ accentColor: e.target.value })} aria-label="Akzentfarbe als Hex" />
              </div>
              {!isValidHex(b.accentColor) && <p className="ds-field__error">Bitte als Hex-Wert angeben, z. B. #4cc2ff.</p>}
            </div>
            <div className="ds-field">
              <span className="ds-field__label">Logo</span>
              <div className="form-inline">
                <Button
                  size="sm"
                  icon={ImagePlus}
                  onClick={async () => {
                    const f = await pickImage();
                    if (!f) return;
                    try {
                      setB({ logoDataUrl: await resizeImageFile(f, 96, 'image/png') });
                    } catch (e) {
                      notify(errorMessage(e), 'warning');
                    }
                  }}
                >
                  Logo wählen
                </Button>
                {b.logoDataUrl && (
                  <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setB({ logoDataUrl: undefined })}>
                    Entfernen
                  </Button>
                )}
                <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => setB({ ...DEFAULT_BRANDING, companyName: b.companyName, logoDataUrl: undefined })}>
                  Standard
                </Button>
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <div className="form-stack">
            <h2 className="card-title">Empfohlene Vorlagen</h2>
            <p className="ds-field__hint">Erscheinen im Dashboard aller Konten dieser Organisation zuerst.</p>
            <div className="chip-select">
              {templates.map((t) => {
                const on = draft.featuredTemplateIds.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={on}
                    className={`chip${on ? ' is-on' : ''}`}
                    onClick={() => setDraft({ ...draft, featuredTemplateIds: on ? draft.featuredTemplateIds.filter((x) => x !== t.id) : [...draft.featuredTemplateIds, t.id] })}
                  >
                    {t.name}
                  </button>
                );
              })}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
