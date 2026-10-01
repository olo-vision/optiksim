/**
 * Modale Dialoge und Dropdown-Menüs.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';
import { X } from 'lucide-react';

export function Dialog({ title, subtitle, onClose, children, width = 720, footer }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; width?: number; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" style={{ width }} role="dialog" aria-modal="true" aria-label={title}>
        <header className="dialog__header">
          <div>
            <h2 className="dialog__title">{title}</h2>
            {subtitle && <p className="dialog__subtitle">{subtitle}</p>}
          </div>
          <button type="button" className="icon-btn icon-btn--ghost icon-btn--md" onClick={onClose} aria-label="Schließen">
            <X size={16} />
          </button>
        </header>
        <div className="dialog__body">{children}</div>
        {footer && <footer className="dialog__footer">{footer}</footer>}
      </div>
    </div>
  );
}

export interface MenuItem {
  label: string;
  icon?: LucideIcon;
  shortcut?: string;
  onSelect?: () => void;
  disabled?: boolean;
  description?: string;
  separator?: boolean;
  heading?: boolean;
  danger?: boolean;
}

/** Abstand zwischen Auslöser und Menü bzw. Mindestabstand zum Bildschirmrand (px) */
const MENU_GAP = 6;
const MENU_MARGIN = 8;

export interface MenuPlacement {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  up: boolean;
}

/**
 * Position eines Dropdown-Menüs im sichtbaren Bereich (reine Funktion, unit-getestet):
 * – Breite höchstens Viewport minus Rand,
 * – horizontal an der gewünschten Kante ausgerichtet und dann in den Viewport geschoben
 *   (ein Auslöser am rechten Rand klappt dadurch automatisch nach links auf),
 * – vertikal in die gewünschte Richtung, bei zu wenig Platz in die Richtung mit mehr Platz,
 * – Höhe auf den verfügbaren Platz begrenzt (der Inhalt scrollt dann innerhalb des Menüs).
 */
export function computeMenuPosition(
  anchor: { top: number; bottom: number; left: number; right: number },
  content: { width: number; height: number },
  viewport: { width: number; height: number },
  align: 'left' | 'right' = 'left',
  direction: 'down' | 'up' = 'down',
): MenuPlacement {
  const usableW = Math.max(0, viewport.width - 2 * MENU_MARGIN);
  const usableH = Math.max(0, viewport.height - 2 * MENU_MARGIN);
  const width = Math.min(content.width, usableW);
  const preferred = align === 'right' ? anchor.right - width : anchor.left;
  const left = Math.min(Math.max(preferred, MENU_MARGIN), viewport.width - MENU_MARGIN - width);
  const below = viewport.height - MENU_MARGIN - (anchor.bottom + MENU_GAP);
  const above = anchor.top - MENU_GAP - MENU_MARGIN;
  let up = direction === 'up';
  if (up && content.height > above && below > above) up = false;
  else if (!up && content.height > below && above > below) up = true;
  const maxHeight = Math.min(usableH, Math.max(up ? above : below, Math.min(160, usableH)));
  const height = Math.min(content.height, maxHeight);
  let top = up ? anchor.top - MENU_GAP - height : anchor.bottom + MENU_GAP;
  top = Math.min(Math.max(top, MENU_MARGIN), viewport.height - MENU_MARGIN - height);
  return { top: Math.round(top), left: Math.round(left), width: Math.round(width), maxHeight: Math.floor(maxHeight), up };
}

/**
 * Dropdown-Menü. Das Menü wird in document.body gerendert (Portal) und fest im Viewport positioniert:
 * es wird nicht von Karten/Leisten mit overflow:hidden abgeschnitten und ragt nie aus dem Bildschirm.
 * Klicks im Menü (Auslöser und Einträge) werden nicht an umgebende Elemente weitergereicht – z. B. öffnet
 * ein Klick auf „…“ in einer Simulationskarte nicht zusätzlich die Simulation.
 */
export function Menu({
  trigger,
  items,
  align = 'left',
  width = 260,
  direction = 'down',
  label,
}: {
  trigger: (open: boolean) => ReactNode;
  items: MenuItem[];
  align?: 'left' | 'right';
  width?: number;
  direction?: 'down' | 'up';
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<MenuPlacement | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const reposition = useCallback(() => {
    const a = ref.current;
    const p = popRef.current;
    if (!a || !p) return;
    const r = a.getBoundingClientRect();
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = window.innerHeight;
    // Auslöser ganz aus dem Bild gescrollt → Menü schließen statt es irgendwo schweben zu lassen
    if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) {
      setOpen(false);
      return;
    }
    setPlace(computeMenuPosition(r, { width, height: p.scrollHeight }, { width: vw, height: vh }, align, direction));
  }, [align, direction, width]);

  const close = useCallback((focusTrigger = false) => {
    setOpen(false);
    if (focusTrigger) ref.current?.querySelector<HTMLElement>('button, [tabindex]')?.focus();
  }, []);

  useLayoutEffect(() => {
    if (open) reposition();
    else setPlace(null);
  }, [open, reposition, items.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !popRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(true);
      }
    };
    const onMove = () => reposition();
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open, reposition, close]);

  /** Pfeiltasten im geöffneten Menü */
  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    const list = [...(popRef.current?.querySelectorAll<HTMLButtonElement>('.menu__item:not(:disabled)') ?? [])];
    if (!list.length) return;
    e.preventDefault();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : e.key === 'ArrowDown' ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
    list[next].focus();
  };

  const popover = open
    ? createPortal(
        <div
          ref={popRef}
          className={`menu__popover menu__popover--portal${place?.up ? ' menu__popover--above' : ''}`}
          style={place ? { top: place.top, left: place.left, width: place.width, maxHeight: place.maxHeight } : { top: 0, left: 0, width, visibility: 'hidden' }}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
        >
          {items.map((it, i) =>
            it.separator ? (
              <div key={i} className="menu__separator" />
            ) : it.heading ? (
              <div key={i} className="menu__heading">
                {it.label}
              </div>
            ) : (
              <button
                key={i}
                type="button"
                role="menuitem"
                className={`menu__item${it.danger ? ' menu__item--danger' : ''}`}
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onSelect?.();
                }}
              >
                {it.icon && <it.icon size={15} strokeWidth={1.75} className="menu__icon" />}
                <span className="menu__text">
                  <span className="menu__label">{it.label}</span>
                  {it.description && <span className="menu__desc">{it.description}</span>}
                </span>
                {it.shortcut && <span className="menu__shortcut">{it.shortcut}</span>}
              </button>
            ),
          )}
        </div>,
        document.body,
      )
    : null;

  return (
    <div
      className="menu"
      ref={ref}
      // React-Ereignisse aus dem Portal laufen durch diesen Knoten: nicht an Karte/Zeile weitergeben
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
      }}
    >
      <div onClick={() => setOpen((o) => !o)}>{trigger(open)}</div>
      {popover}
    </div>
  );
}
