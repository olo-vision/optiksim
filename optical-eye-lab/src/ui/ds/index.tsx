/**
 * Design-System der Anwendungsseiten (Phase 3).
 * Baut auf den Tokens aus styles/tokens.css auf; der Simulator nutzt weiterhin ui/common.
 */
import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Search, X } from 'lucide-react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  loading?: boolean;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon: Icon, iconRight: IconR, loading, block, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`ds-btn ds-btn--${variant} ds-btn--${size}${block ? ' ds-btn--block' : ''}${loading ? ' is-loading' : ''}${className ? ` ${className}` : ''}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <span className="ds-spinner" aria-hidden /> : Icon && <Icon size={size === 'sm' ? 14 : 16} strokeWidth={1.9} />}
      {children && <span>{children}</span>}
      {IconR && <IconR size={size === 'sm' ? 14 : 16} strokeWidth={1.9} />}
    </button>
  );
});

export function Field({ label, hint, error, children, htmlFor, optional }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string; optional?: boolean }) {
  return (
    <div className={`ds-field${error ? ' has-error' : ''}`}>
      <label className="ds-field__label" htmlFor={htmlFor}>
        {label}
        {optional && <span className="ds-field__optional">optional</span>}
      </label>
      {children}
      {error ? (
        <p className="ds-field__error" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="ds-field__hint">{hint}</p>
      )}
    </div>
  );
}

export const TextField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode; error?: string | null; optional?: boolean }>(function TextField(
  { label, hint, error, optional, id, className, ...rest },
  ref,
) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={fid} optional={optional}>
      <input ref={ref} id={fid} className={`ds-input${className ? ` ${className}` : ''}`} aria-invalid={!!error} {...rest} />
    </Field>
  );
});

export function TextArea({ label, hint, error, optional, id, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: ReactNode; error?: string | null; optional?: boolean }) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={fid} optional={optional}>
      <textarea id={fid} className="ds-input ds-textarea" {...rest} />
    </Field>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
  id,
  ...rest
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> & {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; disabled?: boolean }>;
  onChange: (v: T) => void;
  hint?: ReactNode;
}) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Field label={label} hint={hint} htmlFor={fid}>
      <select id={fid} className="ds-input ds-select" value={value} onChange={(e) => onChange(e.target.value as T)} {...rest}>
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Suchen …', autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean }) {
  return (
    <div className="ds-search">
      <Search size={15} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} autoFocus={autoFocus} onKeyDown={(e) => e.key === 'Escape' && onChange('')} />
      {value && (
        <button type="button" className="ds-search__clear" onClick={() => onChange('')} aria-label="Suche leeren">
          <X size={14} />
        </button>
      )}
    </div>
  );
}

export function Card({ children, className, padded = true, onClick }: { children: ReactNode; className?: string; padded?: boolean; onClick?: () => void }) {
  return (
    <div className={`ds-card${padded ? ' ds-card--padded' : ''}${onClick ? ' is-clickable' : ''}${className ? ` ${className}` : ''}`} onClick={onClick}>
      {children}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, text, action }: { icon: LucideIcon; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="ds-empty">
      <div className="ds-empty__icon">
        <Icon size={26} strokeWidth={1.4} />
      </div>
      <h3 className="ds-empty__title">{title}</h3>
      {text && <p className="ds-empty__text">{text}</p>}
      {action && <div className="ds-empty__action">{action}</div>}
    </div>
  );
}

export function Avatar({ name, color, src, size = 32 }: { name: string; color?: string; src?: string; size?: number }) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join('') || '?';
  return (
    <span className="ds-avatar" style={{ width: size, height: size, fontSize: size * 0.38, background: src ? undefined : color }} aria-hidden>
      {src ? <img src={src} alt="" /> : initials}
    </span>
  );
}

export function Pill({ children, tone = 'neutral', icon: Icon }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'dev'; icon?: LucideIcon }) {
  return (
    <span className={`ds-pill ds-pill--${tone}`}>
      {Icon && <Icon size={11} strokeWidth={2} />}
      {children}
    </span>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="page-header">
      <div className="page-header__text">
        {eyebrow && <div className="page-header__eyebrow">{eyebrow}</div>}
        <h1 className="page-header__title">{title}</h1>
        {subtitle && <p className="page-header__subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: Array<{ value: T; label: string; count?: number; icon?: LucideIcon }> }) {
  return (
    <div className="ds-tabs" role="tablist">
      {items.map((it) => (
        <button key={it.value} type="button" role="tab" aria-selected={value === it.value} className={`ds-tab${value === it.value ? ' is-active' : ''}`} onClick={() => onChange(it.value)}>
          {it.icon && <it.icon size={14} strokeWidth={1.9} />}
          {it.label}
          {it.count !== undefined && <span className="ds-tab__count">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label, description, disabled, badge }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: ReactNode; disabled?: boolean; badge?: ReactNode }) {
  const id = useId();
  return (
    <div className={`ds-switch-row${disabled ? ' is-disabled' : ''}`}>
      <label htmlFor={id} className="ds-switch-row__text">
        <span className="ds-switch-row__label">
          {label} {badge}
        </span>
        {description && <span className="ds-switch-row__desc">{description}</span>}
      </label>
      <label className="toggle">
        <input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span className="toggle__track">
          <span className="toggle__thumb" />
        </span>
      </label>
    </div>
  );
}

export function SettingRow({ label, description, children, badge }: { label: string; description?: ReactNode; children: ReactNode; badge?: ReactNode }) {
  return (
    <div className="ds-setting-row">
      <div className="ds-setting-row__text">
        <span className="ds-setting-row__label">
          {label} {badge}
        </span>
        {description && <span className="ds-setting-row__desc">{description}</span>}
      </div>
      <div className="ds-setting-row__control">{children}</div>
    </div>
  );
}

export function Notice({ tone = 'info', icon: Icon, children, title }: { tone?: 'info' | 'warn' | 'ok'; icon?: LucideIcon; children: ReactNode; title?: string }) {
  return (
    <div className={`ds-notice ds-notice--${tone}`}>
      {Icon && <Icon size={16} strokeWidth={1.9} className="ds-notice__icon" />}
      <div>
        {title && <strong className="ds-notice__title">{title}</strong>}
        <div className="ds-notice__body">{children}</div>
      </div>
    </div>
  );
}
