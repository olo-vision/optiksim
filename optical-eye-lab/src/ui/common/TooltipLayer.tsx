/**
 * Globale Tooltip-Ebene für alle Elemente mit `data-tip` (fixiert positioniert,
 * daher nicht von scrollenden Panels abgeschnitten).
 */
import { useEffect, useState } from 'react';

interface TipState {
  text: string;
  x: number;
  y: number;
  side: 'top' | 'bottom' | 'left' | 'right';
}

export function TooltipLayer() {
  const [tip, setTip] = useState<TipState | null>(null);

  useEffect(() => {
    let timer: number | undefined;
    let current: HTMLElement | null = null;

    const show = (el: HTMLElement) => {
      const text = el.dataset.tip;
      if (!text) return;
      const r = el.getBoundingClientRect();
      const side = (el.dataset.tipSide as TipState['side']) || 'bottom';
      const pos =
        side === 'top'
          ? { x: r.left + r.width / 2, y: r.top - 8 }
          : side === 'left'
            ? { x: r.left - 8, y: r.top + r.height / 2 }
            : side === 'right'
              ? { x: r.right + 8, y: r.top + r.height / 2 }
              : { x: r.left + r.width / 2, y: r.bottom + 8 };
      setTip({ text, side, ...pos });
    };

    const over = (e: PointerEvent) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-tip]') ?? null;
      if (el === current) return;
      current = el;
      window.clearTimeout(timer);
      setTip(null);
      if (el && el.dataset.tip) timer = window.setTimeout(() => current === el && show(el), 420);
    };
    const hide = () => {
      window.clearTimeout(timer);
      current = null;
      setTip(null);
    };
    window.addEventListener('pointerover', over);
    window.addEventListener('pointerdown', hide);
    window.addEventListener('wheel', hide, { passive: true });
    window.addEventListener('keydown', hide);
    return () => {
      window.removeEventListener('pointerover', over);
      window.removeEventListener('pointerdown', hide);
      window.removeEventListener('wheel', hide);
      window.removeEventListener('keydown', hide);
    };
  }, []);

  if (!tip) return null;
  return (
    <div className={`tooltip tooltip--${tip.side}`} style={{ left: tip.x, top: tip.y }} role="tooltip">
      {tip.text}
    </div>
  );
}
