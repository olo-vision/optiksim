/**
 * Modale Dialoge und Dropdown-Menüs.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
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
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
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
    <div className="menu" ref={ref}>
      <div onClick={() => setOpen(!open)}>{trigger(open)}</div>
      {open && (
        <div className={`menu__popover menu__popover--${align}${direction === 'up' ? ' menu__popover--up' : ''}`} style={{ width }} role="menu" aria-label={label}>
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
        </div>
      )}
    </div>
  );
}
