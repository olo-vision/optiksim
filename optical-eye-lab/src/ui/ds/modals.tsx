/**
 * Globale Bestätigungs- und Eingabedialoge (Promise-basiert).
 *   await confirmDialog({ title, message, tone: 'danger' })  → true/false
 *   await promptDialog({ title, label, initial })            → string | null
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { Dialog } from '../common/overlays';
import { Button } from './index';

interface ConfirmReq {
  kind: 'confirm';
  id: number;
  title: string;
  message: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  tone: 'default' | 'danger';
  /** optionaler dritter Knopf (z. B. „Nicht speichern“) */
  altLabel?: string;
  resolve: (v: boolean | 'alt') => void;
}
interface PromptReq {
  kind: 'prompt';
  id: number;
  title: string;
  label: string;
  initial: string;
  confirmLabel: string;
  description?: string;
  validate?: (v: string) => string | null;
  resolve: (v: string | null) => void;
}
type Req = ConfirmReq | PromptReq;

const useModals = create<{ stack: Req[] }>()(() => ({ stack: [] }));
let nextId = 1;

function push(r: Req) {
  useModals.setState((s) => ({ stack: [...s.stack, r] }));
}
function pop(id: number) {
  useModals.setState((s) => ({ stack: s.stack.filter((r) => r.id !== id) }));
}

export function confirmDialog(o: { title: string; message: ReactNode; confirmLabel?: string; cancelLabel?: string; tone?: 'default' | 'danger' }): Promise<boolean> {
  return new Promise((resolve) =>
    push({ kind: 'confirm', id: nextId++, title: o.title, message: o.message, confirmLabel: o.confirmLabel ?? 'OK', cancelLabel: o.cancelLabel ?? 'Abbrechen', tone: o.tone ?? 'default', resolve: (v) => resolve(v === true) }),
  );
}

/** Drei Möglichkeiten: 'confirm' | 'alt' | 'cancel' (z. B. Speichern / Nicht speichern / Abbrechen) */
export function choiceDialog(o: { title: string; message: ReactNode; confirmLabel: string; altLabel: string; cancelLabel?: string }): Promise<'confirm' | 'alt' | 'cancel'> {
  return new Promise((resolve) =>
    push({
      kind: 'confirm',
      id: nextId++,
      title: o.title,
      message: o.message,
      confirmLabel: o.confirmLabel,
      altLabel: o.altLabel,
      cancelLabel: o.cancelLabel ?? 'Abbrechen',
      tone: 'default',
      resolve: (v) => resolve(v === true ? 'confirm' : v === 'alt' ? 'alt' : 'cancel'),
    }),
  );
}

export function promptDialog(o: { title: string; label: string; initial?: string; confirmLabel?: string; description?: string; validate?: (v: string) => string | null }): Promise<string | null> {
  return new Promise((resolve) =>
    push({ kind: 'prompt', id: nextId++, title: o.title, label: o.label, initial: o.initial ?? '', confirmLabel: o.confirmLabel ?? 'OK', description: o.description, validate: o.validate, resolve }),
  );
}

function PromptView({ r }: { r: PromptReq }) {
  const [v, setV] = useState(r.initial);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.select();
  }, []);
  const done = (value: string | null) => {
    pop(r.id);
    r.resolve(value);
  };
  const submit = () => {
    const t = v.trim();
    const e = !t ? 'Bitte einen Wert eingeben.' : (r.validate?.(t) ?? null);
    if (e) {
      setErr(e);
      return;
    }
    done(t);
  };
  return (
    <Dialog
      title={r.title}
      subtitle={r.description}
      onClose={() => done(null)}
      width={440}
      footer={
        <>
          <Button variant="ghost" onClick={() => done(null)}>
            Abbrechen
          </Button>
          <Button variant="primary" onClick={submit}>
            {r.confirmLabel}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="ds-field__label" htmlFor={`prompt-${r.id}`}>
          {r.label}
        </label>
        <input
          id={`prompt-${r.id}`}
          ref={ref}
          autoFocus
          className="ds-input"
          value={v}
          maxLength={120}
          onChange={(e) => {
            setV(e.target.value);
            setErr(null);
          }}
          onKeyDown={(e) => e.stopPropagation()}
        />
        {err && <p className="ds-field__error">{err}</p>}
      </form>
    </Dialog>
  );
}

function ConfirmView({ r }: { r: ConfirmReq }) {
  const done = (v: boolean | 'alt') => {
    pop(r.id);
    r.resolve(v);
  };
  return (
    <Dialog
      title={r.title}
      onClose={() => done(false)}
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={() => done(false)}>
            {r.cancelLabel}
          </Button>
          {r.altLabel && (
            <Button variant="secondary" onClick={() => done('alt')}>
              {r.altLabel}
            </Button>
          )}
          <Button variant={r.tone === 'danger' ? 'danger' : 'primary'} autoFocus onClick={() => done(true)}>
            {r.confirmLabel}
          </Button>
        </>
      }
    >
      <div className="ds-confirm__message">{r.message}</div>
    </Dialog>
  );
}

export function ModalHost() {
  const stack = useModals((s) => s.stack);
  const top = stack[stack.length - 1];
  if (!top) return null;
  return top.kind === 'confirm' ? <ConfirmView key={top.id} r={top} /> : <PromptView key={top.id} r={top} />;
}
