/**
 * Zustimmungen zu Rechtstexten (Phase 8): lädt die für Kontext + Kundentyp erforderlichen Dokumente
 * (aktuelle Versionen, serverseitig bestimmt) und zeigt je Dokument eine Checkbox mit Link auf GENAU
 * diese Version. Übermittelt werden nur die Dokument-IDs – der Server prüft Vollständigkeit/Aktualität
 * und protokolliert Version + Hash.
 */
import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, FileText } from 'lucide-react';
import { cloudBackend } from '../../cloudSession';
import { consentLabel, infoDocs, legalDocPath, requiredDocs } from '@/cloud/legal';
import type { InstitutionType, LegalConsentContext, LegalDocRef } from '@/cloud/types';

export function useRequiredLegalDocs(context: LegalConsentContext, customerType: InstitutionType | null | undefined) {
  const [docs, setDocs] = useState<LegalDocRef[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!customerType) return;
    setError(null);
    try {
      setDocs(await cloudBackend().requiredLegalDocuments(context, customerType));
    } catch (e) {
      setDocs([]);
      setError(e instanceof Error ? e.message : 'Rechtstexte konnten nicht geladen werden.');
    }
  }, [context, customerType]);
  useEffect(() => {
    setDocs(null);
    void reload();
  }, [reload]);
  return { docs, error, reload };
}

export function LegalConsentList({
  docs,
  checked,
  onToggle,
  compact,
}: {
  docs: LegalDocRef[];
  checked: ReadonlySet<string>;
  onToggle: (id: string, on: boolean) => void;
  compact?: boolean;
}) {
  const req = requiredDocs(docs);
  const info = infoDocs(docs);
  if (!req.length && !info.length) return null;
  return (
    <div className={`consents${compact ? ' consents--compact' : ''}`} data-testid="legal-consents">
      {req.map((d) => {
        const l = consentLabel(d);
        return (
          <label key={d.id} className="consent" data-testid={`consent-${d.type}`}>
            <input type="checkbox" checked={checked.has(d.id)} onChange={(e) => onToggle(d.id, e.target.checked)} />
            <span>
              {l.before}
              {l.linkText && (
                <a href={legalDocPath(d.id)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                  {l.linkText}
                </a>
              )}
              {l.after}
              <small className="consent__version">Version {d.version}</small>
            </span>
          </label>
        );
      })}
      {info.map((d) => (
        <p key={d.id} className="consent-info">
          <FileText size={13} />
          <a href={legalDocPath(d.id)} target="_blank" rel="noopener noreferrer">
            {d.title} <ExternalLink size={11} />
          </a>
          <small className="consent__version">Version {d.version}</small>
        </p>
      ))}
    </div>
  );
}

/** Zustand der Checkboxen */
export function useConsentState() {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const toggle = useCallback((id: string, on: boolean) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const reset = useCallback(() => setChecked(new Set()), []);
  return { checked, toggle, reset };
}
