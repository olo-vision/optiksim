/**
 * Info-Symbol mit Erklärung eines berechneten Werts (Formel, eingesetzte Werte, Ergebnis, Kurztext).
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info, X } from 'lucide-react';
import type { Explanation } from '@/engine/physics/explain';

export function ExplainButton({ explanation }: { explanation: Explanation }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (pop.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`explain-btn${open ? ' is-open' : ''}`}
        aria-label={`Erklärung: ${explanation.title}`}
        onClick={(e) => {
          e.stopPropagation();
          const r = btn.current!.getBoundingClientRect();
          setPos({ x: Math.max(12, r.left - 340), y: Math.min(window.innerHeight - 260, r.top - 8) });
          setOpen(!open);
        }}
      >
        <Info size={12} strokeWidth={2} />
      </button>
      {open &&
        createPortal(
          <div ref={pop} className="explain-pop" style={{ left: pos.x, top: pos.y }} role="dialog" aria-label={explanation.title}>
            <div className="explain-pop__head">
              <span>{explanation.title}</span>
              <button type="button" className="tree-act" onClick={() => setOpen(false)} aria-label="Schließen">
                <X size={13} />
              </button>
            </div>
            <div className="explain-pop__label">Formel</div>
            <div className="explain-pop__formula">{explanation.formula}</div>
            <div className="explain-pop__label">Eingesetzt</div>
            <div className="explain-pop__subst">{explanation.substitution}</div>
            <div className="explain-pop__label">Ergebnis</div>
            <div className="explain-pop__result">{explanation.result}</div>
            <p className="explain-pop__text">{explanation.text}</p>
          </div>,
          document.body,
        )}
    </>
  );
}
