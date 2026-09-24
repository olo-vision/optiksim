/**
 * Basis-Bedienelemente (Buttons, Schalter, Segmente, Abschnitte, Badges).
 */
import { useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ChevronRight } from 'lucide-react';

interface IconButtonProps {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  variant?: 'ghost' | 'solid' | 'accent' | 'danger';
  size?: 'sm' | 'md';
  tipSide?: 'bottom' | 'top' | 'left' | 'right';
  text?: string;
  className?: string;
}

export function IconButton({ icon: Icon, label, shortcut, active, disabled, onClick, variant = 'ghost', size = 'md', tipSide = 'bottom', text, className }: IconButtonProps) {
  return (
    <button
      type="button"
      className={`icon-btn icon-btn--${variant} icon-btn--${size}${active ? ' is-active' : ''}${text ? ' icon-btn--text' : ''}${className ? ` ${className}` : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      data-tip={shortcut ? `${label}  ·  ${shortcut}` : label}
      data-tip-side={tipSide}
    >
      <Icon size={size === 'sm' ? 14 : 16} strokeWidth={1.75} />
      {text && <span>{text}</span>}
    </button>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <label className={`toggle${disabled ? ' is-disabled' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle__track">
        <span className="toggle__thumb" />
      </span>
      {label && <span className="toggle__label">{label}</span>}
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
}: {
  value: T;
  options: Array<{ value: T; label: string; icon?: LucideIcon; tip?: string }>;
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <div className={`segmented segmented--${size}`} role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={`segmented__item${value === o.value ? ' is-active' : ''}`}
          onClick={() => onChange(o.value)}
          data-tip={o.tip}
        >
          {o.icon && <o.icon size={14} strokeWidth={1.8} />}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Section({ title, children, defaultOpen = true, right, badge }: { title: string; children: ReactNode; defaultOpen?: boolean; right?: ReactNode; badge?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`section${open ? ' is-open' : ''}`}>
      <header className="section__header">
        <button type="button" className="section__toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          <ChevronRight size={13} className="section__chevron" />
          <span className="section__title">{title}</span>
          {badge}
        </button>
        {right && <div className="section__right">{right}</div>}
      </header>
      {open && <div className="section__body">{children}</div>}
    </section>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'warn' | 'dev' | 'ok' }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function Divider() {
  return <div className="divider" />;
}
