/**
 * Dialoge „Neue Simulation“ und „Als Vorlage speichern“.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { FilePlus2, LayoutTemplate, Lock, Users } from 'lucide-react';
import { Dialog } from '@/ui/common/overlays';
import { Button, Pill, SelectField, TextArea, TextField } from '@/ui/ds';
import { useSession, runAction } from '../session';
import { platform } from '../platformInstance';
import { closeAppDialog, useAppDialogs } from './actions';
import { CATEGORY_LABELS, type SimulationCategory, type Template } from '@/platform/models';
import { createBlankDocument } from '@/platform/templates';
import { useAppStore } from '@/state/store';
import { can } from '@/platform/permissions';
import { TemplateGlyph } from './visuals';

const CATEGORY_OPTIONS = (Object.keys(CATEGORY_LABELS) as SimulationCategory[]).map((value) => ({ value, label: CATEGORY_LABELS[value] }));

function NewSimulationDialog({ initialTemplate }: { initialTemplate?: string }) {
  const templates = useSession((s) => s.templates);
  const navigate = useNavigate();
  const [sel, setSel] = useState<string>(initialTemplate ?? 'blank');
  const tpl: Template | undefined = templates.find((t) => t.id === sel);
  const [name, setName] = useState(tpl?.name ?? '');
  const [nameTouched, setNameTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<SimulationCategory>('custom');
  const [busy, setBusy] = useState(false);

  const groups = useMemo(() => {
    const builtin = templates.filter((t) => t.visibility === 'builtin');
    const own = templates.filter((t) => t.visibility !== 'builtin');
    return { builtin, own };
  }, [templates]);

  const choose = (id: string) => {
    setSel(id);
    const t = templates.find((x) => x.id === id);
    if (!nameTouched) setName(t?.name ?? '');
  };

  const create = async () => {
    setBusy(true);
    const prefs = useAppStore.getState().prefs;
    const finalName = name.trim() || tpl?.name || 'Neue Simulation';
    const rec = await runAction((u) =>
      sel === 'blank'
        ? platform.library.create(u, { name: finalName, description, category, doc: createBlankDocument(finalName, prefs) })
        : platform.library.createFromTemplate(u, sel, finalName, description.trim() || undefined),
    );
    setBusy(false);
    if (rec) {
      closeAppDialog();
      navigate(`/simulations/${rec.meta.id}`);
    }
  };

  const Item = ({ t }: { t: Template }) => (
    <button type="button" role="option" aria-selected={sel === t.id} className={`tpl-option${sel === t.id ? ' is-active' : ''}`} onClick={() => choose(t.id)} onDoubleClick={() => void create()}>
      <TemplateGlyph category={t.category} />
      <span className="tpl-option__text">
        <span className="tpl-option__name">
          {t.name}
          {t.visibility === 'organization' && <Pill icon={Users}>Organisation</Pill>}
          {t.visibility === 'private' && <Pill icon={Lock}>Privat</Pill>}
        </span>
        <span className="tpl-option__desc">{t.description}</span>
      </span>
    </button>
  );

  return (
    <Dialog
      title="Neue Simulation"
      subtitle="Leer beginnen oder eine Vorlage als Ausgangspunkt wählen."
      onClose={closeAppDialog}
      width={880}
      footer={
        <>
          <Button variant="ghost" onClick={closeAppDialog}>
            Abbrechen
          </Button>
          <Button variant="primary" icon={FilePlus2} loading={busy} onClick={() => void create()}>
            Erstellen und öffnen
          </Button>
        </>
      }
    >
      <div className="new-sim">
        <div className="new-sim__list" role="listbox" aria-label="Vorlagen">
          <button type="button" role="option" aria-selected={sel === 'blank'} className={`tpl-option${sel === 'blank' ? ' is-active' : ''}`} onClick={() => choose('blank')}>
            <span className="tpl-glyph tpl-glyph--blank">
              <FilePlus2 size={18} strokeWidth={1.6} />
            </span>
            <span className="tpl-option__text">
              <span className="tpl-option__name">Leere Simulation</span>
              <span className="tpl-option__desc">Emmetropes Modellauge ohne Elemente – mit deinen Standardwerten.</span>
            </span>
          </button>
          <div className="new-sim__heading">Vorlagen</div>
          {groups.builtin.map((t) => (
            <Item key={t.id} t={t} />
          ))}
          {groups.own.length > 0 && <div className="new-sim__heading">Eigene & Organisation</div>}
          {groups.own.map((t) => (
            <Item key={t.id} t={t} />
          ))}
        </div>
        <form
          className="new-sim__form"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <TextField
            label="Name"
            value={name}
            placeholder={tpl?.name ?? 'Neue Simulation'}
            maxLength={120}
            onChange={(e) => {
              setName(e.target.value);
              setNameTouched(true);
            }}
            autoFocus
          />
          <TextArea label="Beschreibung" optional rows={3} value={description} placeholder={tpl?.description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
          {sel === 'blank' ? (
            <SelectField label="Kategorie" value={category} onChange={setCategory} options={CATEGORY_OPTIONS} />
          ) : (
            tpl && (
              <div className="new-sim__info">
                <span className="new-sim__info-label">Kategorie</span> {CATEGORY_LABELS[tpl.category]}
                {tpl.tags.length > 0 && (
                  <div className="tag-row">
                    {tpl.tags.map((t) => (
                      <Pill key={t}>{t}</Pill>
                    ))}
                  </div>
                )}
              </div>
            )
          )}
          <button type="submit" hidden />
        </form>
      </div>
    </Dialog>
  );
}

function SaveTemplateDialog({ doc, defaultName, defaultCategory, defaultDescription }: { doc: import('@/model/types').SceneDocument; defaultName: string; defaultCategory: SimulationCategory; defaultDescription: string }) {
  const user = useSession((s) => s.user)!;
  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState(defaultDescription);
  const [category, setCategory] = useState<SimulationCategory>(defaultCategory);
  const canOrg = can(user, 'templates.publishOrganization') && !!user.organizationId;
  const [visibility, setVisibility] = useState<'private' | 'organization'>('private');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const t = await runAction((u) => platform.library.saveAsTemplate(u, doc, { name, description, category, visibility }), (t) => `Vorlage „${t.name}“ gespeichert`);
    setBusy(false);
    if (t) closeAppDialog();
  };
  return (
    <Dialog
      title="Als Vorlage speichern"
      subtitle="Der aktuelle Stand wird als Ausgangspunkt für neue Simulationen gespeichert."
      onClose={closeAppDialog}
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={closeAppDialog}>
            Abbrechen
          </Button>
          <Button variant="primary" icon={LayoutTemplate} loading={busy} onClick={() => void save()}>
            Vorlage speichern
          </Button>
        </>
      }
    >
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <TextField label="Name der Vorlage" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus />
        <TextArea label="Beschreibung" optional rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        <SelectField label="Kategorie" value={category} onChange={setCategory} options={CATEGORY_OPTIONS} />
        <SelectField<'private' | 'organization'>
          label="Sichtbarkeit"
          value={visibility}
          onChange={setVisibility}
          options={[
            { value: 'private', label: 'Nur für mich' },
            { value: 'organization', label: 'Für alle in meiner Organisation', disabled: !canOrg },
          ]}
          hint={canOrg ? 'Organisationsvorlagen sehen alle Konten deiner Organisation auf diesem Gerät.' : 'Organisationsvorlagen können Trainer/innen und Administrator/innen veröffentlichen.'}
        />
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

export function AppDialogHost() {
  const dialog = useAppDialogs((s) => s.dialog);
  if (!dialog) return null;
  if (dialog.kind === 'new-simulation') return <NewSimulationDialog initialTemplate={dialog.templateId} />;
  return (
    <SaveTemplateDialog
      doc={dialog.doc}
      defaultName={dialog.meta?.name ?? dialog.doc.name}
      defaultCategory={dialog.meta?.category ?? 'custom'}
      defaultDescription={dialog.meta?.description ?? ''}
    />
  );
}
