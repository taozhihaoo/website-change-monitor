import { useState, type ReactElement, type ReactNode } from 'react';
import { setApiKey } from '../api/client.js';
import { useI18n } from '../i18n.js';

export type IconName =
  | 'radar'
  | 'grid'
  | 'plus'
  | 'refresh'
  | 'play'
  | 'pencil'
  | 'trash'
  | 'globe'
  | 'clock'
  | 'pulse'
  | 'alert'
  | 'check'
  | 'chevron'
  | 'arrow-left'
  | 'sun'
  | 'moon'
  | 'bell'
  | 'link'
  | 'mail'
  | 'code'
  | 'diff'
  | 'shield'
  | 'key'
  | 'external'
  | 'search';

const ICON_PATHS: Record<IconName, ReactNode> = {
  radar: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 12 19 5" />
      <circle cx="16.5" cy="7.5" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  grid: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  refresh: (
    <>
      <path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" />
      <path d="M4 4v4h4" />
      <path d="M4 13a8 8 0 0 0 14.3 4.9L20 16" />
      <path d="M20 20v-4h-4" />
    </>
  ),
  play: <path d="M8 5.5v13l11-6.5-11-6.5Z" />,
  pencil: (
    <>
      <path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z" />
      <path d="m13.5 6.5 3 3" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6.5 7 7.5 20h9l1-13" />
      <path d="M10.5 11v5M13.5 11v5" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3.5 9.5h17M3.5 14.5h17" />
      <path d="M12 3c2.6 2.6 3.8 6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-6-3.8-9S9.4 5.6 12 3Z" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  pulse: <path d="M3 12h4l2.5-6 4 12 2.5-6h5" />,
  alert: (
    <>
      <path d="M12 4 2.8 20h18.4L12 4Z" />
      <path d="M12 10v4.5" />
      <circle cx="12" cy="17.3" r=".9" fill="currentColor" stroke="none" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  'arrow-left': <path d="M19 12H5m0 0 6-6m-6 6 6 6" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />,
  bell: (
    <>
      <path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6Z" />
      <path d="M10 19a2.2 2.2 0 0 0 4 0" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7L11.4 7" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 0 0 5.7 5.7L12.6 17" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m4 7 8 6 8-6" />
    </>
  ),
  code: <path d="m8.5 8-4 4 4 4M15.5 8l4 4-4 4M13.5 5.5l-3 13" />,
  diff: (
    <>
      <path d="M6 4v16M18 4v16" />
      <path d="M9.5 8h3M9.5 12h3M9.5 16h3" />
      <path d="M15 10h3M15 14h3" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 4.5 6v6c0 4.6 3.2 7.9 7.5 9 4.3-1.1 7.5-4.4 7.5-9V6L12 3Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  key: (
    <>
      <circle cx="8.5" cy="8.5" r="4" />
      <path d="m11.4 11.4 8.1 8.1M16 16l2-2M18.5 18.5l2-2" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="m20 4-9 9" />
      <path d="M18 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </>
  ),
};

export function Icon({
  name,
  size = 18,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}): ReactElement {
  return (
    <svg
      className={className === undefined ? 'icon' : `icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

export function BrandMark({ size = 34 }: { size?: number }): ReactElement {
  return (
    <span className="brand-mark" style={{ width: size, height: size }}>
      <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
        <defs>
          <linearGradient id="brandGradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--accent-1)" />
            <stop offset="100%" stopColor="var(--accent-2)" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="9" fill="url(#brandGradient)" />
        <circle cx="16" cy="16" r="8.2" fill="none" stroke="rgba(255,255,255,.92)" strokeWidth="1.6" />
        <circle cx="16" cy="16" r="4" fill="none" stroke="rgba(255,255,255,.62)" strokeWidth="1.4" />
        <path d="M16 16 22.6 9.4" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="21.2" cy="10.8" r="1.7" fill="#fff" />
      </svg>
    </span>
  );
}

export function Spinner({ label }: { label?: string }): ReactElement {
  const { t } = useI18n();
  return (
    <div className="spinner-row" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label ?? t('dashboard.loading')}</span>
    </div>
  );
}

export function ApiKeyPrompt({ onSaved }: { onSaved: () => void }): ReactElement {
  const { t } = useI18n();
  const [value, setValue] = useState('');
  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <div className="auth-icon">
          <Icon name="key" size={22} />
        </div>
        <h2>{t('auth.title')}</h2>
        <p className="page-intro">{t('auth.intro')}</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setApiKey(value.trim());
            onSaved();
          }}
        >
          <label className="field">
            <span>{t('auth.label')}</span>
            <input
              type="password"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              required
              autoFocus
              autoComplete="off"
            />
          </label>
          <button type="submit" className="btn btn-primary btn-block">
            {t('action.save')}
          </button>
        </form>
      </div>
    </div>
  );
}

export function ErrorBox({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}): ReactElement {
  const { t } = useI18n();
  return (
    <div className="alert alert-error" role="alert">
      <Icon name="alert" size={18} />
      <span>
        <strong>{t('error.title')}:</strong> {message}
      </span>
      {onRetry !== undefined && (
        <button type="button" className="btn btn-small" onClick={onRetry}>
          {t('action.retry')}
        </button>
      )}
    </div>
  );
}

export function InfoMessage({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="alert alert-info" role="status">
      <Icon name="check" size={18} />
      <span>{children}</span>
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  icon = 'search',
  action,
}: {
  title: string;
  hint?: string;
  icon?: IconName;
  action?: ReactNode;
}): ReactElement {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon name={icon} size={26} />
      </div>
      <p className="empty-title">{title}</p>
      {hint !== undefined && <p className="empty-hint">{hint}</p>}
      {action !== undefined && <div className="empty-action">{action}</div>}
    </div>
  );
}

const STATUS_LABELS: Record<string, string> = {
  baseline: 'status.baseline',
  unchanged: 'status.unchanged',
  changed: 'status.changed',
  error: 'status.error',
};

export function StatusBadge({ status }: { status: string | null }): ReactElement {
  const { t } = useI18n();
  if (status === null) {
    return (
      <span className="badge badge-idle">
        <span className="dot" />
        {t('status.never')}
      </span>
    );
  }
  const key = STATUS_LABELS[status];
  return (
    <span className={`badge badge-${status}`}>
      <span className="dot" />
      {key === undefined ? status : t(key)}
    </span>
  );
}

export function EnabledBadge({ enabled }: { enabled: boolean }): ReactElement {
  const { t } = useI18n();
  return (
    <span className={`badge badge-plain ${enabled ? 'badge-enabled' : 'badge-disabled'}`}>
      {enabled ? t('status.enabled') : t('status.disabled')}
    </span>
  );
}

const DELIVERY_KEYS: Record<string, string> = {
  pending: 'status.pending',
  sent: 'status.sent',
  failed: 'status.failed',
};

export function DeliveryBadge({ status }: { status: string }): ReactElement {
  const { t } = useI18n();
  const key = DELIVERY_KEYS[status];
  return (
    <span className={`badge badge-plain badge-delivery-${status}`}>
      {key === undefined ? status : t(key)}
    </span>
  );
}

export function StatCard({
  icon,
  label,
  value,
  tone = 'default',
  hint,
  compact = false,
}: {
  icon: IconName;
  label: string;
  value: string | number;
  tone?: 'default' | 'accent' | 'success' | 'danger' | 'warning';
  hint?: string | undefined;
  compact?: boolean;
}): ReactElement {
  return (
    <div className={`stat-card tone-${tone}`}>
      <div className="stat-top">
        <span className="stat-icon">
          <Icon name={icon} size={17} />
        </span>
        <span className="stat-label">{label}</span>
      </div>
      <span className={compact ? 'stat-value stat-value-compact' : 'stat-value'}>{value}</span>
      {hint !== undefined && <span className="stat-hint">{hint}</span>}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  ariaLabel: string;
}): ReactElement {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.value === value ? 'segmented-item is-active' : 'segmented-item'}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
