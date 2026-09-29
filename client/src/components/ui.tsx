import { useState, type ReactElement } from 'react';
import { setApiKey } from '../api/client.js';

export function Spinner({ label = 'Loading…' }: { label?: string }): ReactElement {
  return (
    <div className="spinner-row" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

/**
 * Minimal unlock form shown when the server responds 401 (APP_API_KEY set).
 * The key is kept in localStorage and sent as a Bearer token — deliberately
 * not an auth framework for a single-user tool.
 */
export function ApiKeyPrompt({ onSaved }: { onSaved: () => void }): ReactElement {
  const [value, setValue] = useState('');
  return (
    <div className="card apikey-card">
      <h2>API key required</h2>
      <p className="page-intro">
        This instance is protected with an API key (<code>APP_API_KEY</code>). Enter it once —
        it is stored in this browser and sent as a Bearer token.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setApiKey(value.trim());
          onSaved();
        }}
      >
        <label>
          API key
          <input
            type="password"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            required
            autoFocus
          />
        </label>
        <button type="submit" className="btn btn-primary">
          Save and continue
        </button>
      </form>
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }): ReactElement {
  return (
    <div className="error-box" role="alert">
      <strong>Error:</strong> {message}
      {onRetry !== undefined && (
        <button type="button" className="btn btn-small" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }): ReactElement {
  return (
    <div className="empty-state">
      <p className="empty-title">{title}</p>
      {hint !== undefined && <p className="empty-hint">{hint}</p>}
    </div>
  );
}

const STATUS_LABELS: Record<string, string> = {
  baseline: 'baseline',
  unchanged: 'unchanged',
  changed: 'changed',
  error: 'error',
};

export function StatusBadge({ status }: { status: string | null }): ReactElement {
  if (status === null) {
    return <span className="badge badge-idle">never checked</span>;
  }
  return <span className={`badge badge-${status}`}>{STATUS_LABELS[status] ?? status}</span>;
}

export function EnabledBadge({ enabled }: { enabled: boolean }): ReactElement {
  return (
    <span className={`badge ${enabled ? 'badge-enabled' : 'badge-disabled'}`}>
      {enabled ? 'enabled' : 'disabled'}
    </span>
  );
}

export function DeliveryBadge({ status }: { status: string }): ReactElement {
  return <span className={`badge badge-delivery-${status}`}>{status}</span>;
}
