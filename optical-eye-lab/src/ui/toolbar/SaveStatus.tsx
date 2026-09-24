/**
 * Speicherstatus des Simulators: „Gespeichert · vor 12 s“, „Speichert …“, „Ungespeicherte Änderungen“.
 */
import { useEffect, useState } from 'react';
import { Check, CircleDot, Loader2 } from 'lucide-react';
import { useAppStore } from '@/state/store';

export function formatAgo(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return 'gerade eben';
  if (s < 60) return `vor ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `vor ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `vor ${h} h`;
  return `vor ${Math.round(h / 24)} Tagen`;
}

export function SaveStatus({ compact }: { compact?: boolean }) {
  const dirty = useAppStore((s) => s.dirty);
  const saving = useAppStore((s) => s.saving);
  const savedAt = useAppStore((s) => s.savedAt);
  const autoSave = useAppStore((s) => s.prefs.autoSave);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => setNow(Date.now()), [savedAt]);

  if (saving)
    return (
      <span className="save-status save-status--saving" role="status" data-state="saving">
        <Loader2 size={12} className="spin" /> Speichert …
      </span>
    );
  if (dirty)
    return (
      <span
        className="save-status save-status--dirty"
        role="status"
        data-state="dirty"
        data-tip={autoSave ? 'Wird in Kürze automatisch gespeichert' : 'Automatisches Speichern ist aus – mit ⌘/Strg + S speichern'}
        data-tip-side="bottom"
      >
        <CircleDot size={12} /> {compact ? 'Ungespeichert' : 'Ungespeicherte Änderungen'}
      </span>
    );
  return (
    <span className="save-status save-status--saved" role="status" data-state="saved" data-tip="Lokal in diesem Browser gespeichert" data-tip-side="bottom">
      <Check size={12} /> {savedAt ? `Gespeichert · ${formatAgo(now - savedAt)}` : 'Gespeichert'}
    </span>
  );
}
