/**
 * Dokument-Seiten (Anmeldung, Registrierung, Passwort, öffentliche Seiten) scrollen über das Dokument selbst –
 * nicht über einen festen Vollbild-Container.
 *
 * Hintergrund: Die App-Oberfläche (Simulator, Seitenleiste) braucht `html, body { overflow: hidden }`.
 * Formularseiten in einem `position: fixed; inset: 0`-Container mit eigenem Scrollen verhalten sich auf
 * iOS/Safari schlecht: Die Browserleisten klappen nie ein, die Tastatur kann das aktive Feld verdecken und
 * Inhalte am Rand werden von den Leisten überdeckt. Mit Dokument-Scrollen übernimmt der Browser all das selbst.
 *
 * Solange eine solche Seite angezeigt wird, trägt <html> die Klasse `doc-scroll` (CSS in app.css).
 * Zusätzlich wird ein fokussiertes Feld wieder sichtbar gemacht, wenn die Bildschirmtastatur den sichtbaren
 * Bereich verkleinert (visualViewport) und das Feld darunter liegt.
 */
import { useLayoutEffect } from 'react';

let users = 0;

const FIELD = 'input:not([type="checkbox"]):not([type="radio"]), select, textarea';

/** Liegt das Feld (teilweise) außerhalb des sichtbaren Bereichs (z. B. unter der Tastatur)? → sichtbar machen */
export function revealFocusedField(margin = 16) {
  const el = document.activeElement as HTMLElement | null;
  if (!el || !el.matches?.(FIELD)) return false;
  const vv = window.visualViewport;
  const top = vv ? vv.offsetTop : 0;
  const height = vv ? vv.height : window.innerHeight;
  const r = el.getBoundingClientRect();
  if (r.top >= top + margin && r.bottom <= top + height - margin) return false;
  el.scrollIntoView({ block: 'center', inline: 'nearest' });
  return true;
}

export function useDocumentScroll() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    users += 1;
    root.classList.add('doc-scroll');
    let timer = 0;
    const onViewport = () => {
      window.clearTimeout(timer);
      // nach dem Ein-/Ausfahren der Tastatur (Animation) prüfen
      timer = window.setTimeout(() => revealFocusedField(), 120);
    };
    const vv = window.visualViewport;
    vv?.addEventListener('resize', onViewport);
    window.addEventListener('resize', onViewport);
    return () => {
      window.clearTimeout(timer);
      vv?.removeEventListener('resize', onViewport);
      window.removeEventListener('resize', onViewport);
      users -= 1;
      if (users <= 0) {
        users = 0;
        root.classList.remove('doc-scroll');
      }
    };
  }, []);
}
