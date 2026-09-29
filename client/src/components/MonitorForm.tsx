import { useState, type FormEvent, type ReactElement } from 'react';
import { api, ApiError, formatValidationDetails } from '../api/client.js';
import type { Monitor, SelectorType, TestExtractionResult } from '../types.js';
import { Spinner } from './ui.js';

export interface MonitorFormValues {
  name: string;
  url: string;
  selector: string;
  selector_type: SelectorType;
  check_interval_seconds: number;
  webhook_url: string;
  enabled: boolean;
}

export const INTERVAL_PRESETS: Array<{ label: string; value: number }> = [
  { label: '5 minutes', value: 300 },
  { label: '15 minutes', value: 900 },
  { label: '30 minutes', value: 1800 },
  { label: '1 hour', value: 3600 },
  { label: '6 hours', value: 21600 },
  { label: '24 hours', value: 86400 },
];

const EMPTY_FORM: MonitorFormValues = {
  name: '',
  url: '',
  selector: '',
  selector_type: 'css',
  check_interval_seconds: 300,
  webhook_url: '',
  enabled: true,
};

function toFormValues(monitor: Monitor): MonitorFormValues {
  return {
    name: monitor.name,
    url: monitor.url,
    selector: monitor.selector,
    selector_type: monitor.selector_type,
    check_interval_seconds: monitor.check_interval_seconds,
    webhook_url: monitor.webhook_url ?? '',
    enabled: monitor.enabled,
  };
}

/**
 * Shared form for creating and editing monitors. The "Test extraction" button
 * runs the server-side preview (nothing is persisted) so a broken selector
 * can be caught before saving.
 */
export function MonitorForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial?: Monitor;
  submitLabel: string;
  onSubmit: (values: MonitorFormValues) => Promise<void>;
}): ReactElement {
  const [values, setValues] = useState<MonitorFormValues>(
    initial === undefined ? EMPTY_FORM : toFormValues(initial),
  );
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<TestExtractionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof MonitorFormValues>(key: K, value: MonitorFormValues[K]): void => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const runTestExtraction = async (): Promise<void> => {
    setTesting(true);
    setError(null);
    setTestResult(null);
    try {
      const result = await api.post<TestExtractionResult>('/monitors/test-extraction', {
        url: values.url,
        selector: values.selector,
        selector_type: values.selector_type,
      });
      setTestResult(result);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSubmit(values);
    } catch (err) {
      setError(describeError(err));
      setSaving(false);
    }
  };

  return (
    <form className="monitor-form card" onSubmit={(event) => void handleSubmit(event)}>
      <label>
        Name
        <input
          value={values.name}
          onChange={(event) => set('name', event.target.value)}
          placeholder="Acme product price"
          required
          maxLength={200}
        />
      </label>

      <label>
        URL
        <input
          value={values.url}
          onChange={(event) => set('url', event.target.value)}
          placeholder="https://example.com/product"
          type="url"
          required
        />
        <small>Public pages only — localhost and private-network targets are rejected.</small>
      </label>

      <div className="form-row">
        <label>
          Selector
          <input
            value={values.selector}
            onChange={(event) => set('selector', event.target.value)}
            placeholder=".product-price"
            required
          />
        </label>
        <label>
          Selector type
          <select
            value={values.selector_type}
            onChange={(event) => set('selector_type', event.target.value as SelectorType)}
          >
            <option value="css">CSS</option>
            <option value="xpath">XPath</option>
            <option value="text">Text</option>
          </select>
        </label>
      </div>

      <label>
        Check interval
        <select
          value={values.check_interval_seconds}
          onChange={(event) => set('check_interval_seconds', Number(event.target.value))}
        >
          {INTERVAL_PRESETS.map((preset) => (
            <option key={preset.value} value={preset.value}>
              {preset.label}
            </option>
          ))}
        </select>
      </label>

      <label>
        Webhook URL (optional)
        <input
          value={values.webhook_url}
          onChange={(event) => set('webhook_url', event.target.value)}
          placeholder="https://hooks.example.com/…"
          type="url"
        />
        <small>Receives a JSON POST whenever a change is detected.</small>
      </label>

      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={values.enabled}
          onChange={(event) => set('enabled', event.target.checked)}
        />
        Enabled (scheduled checks run only when enabled)
      </label>

      {error !== null && (
        <div className="error-box" role="alert">
          <strong>Error:</strong> {error}
        </div>
      )}

      {testResult !== null && (
        <div className="test-result">
          <p>
            <strong>Extraction preview</strong> ({testResult.duration_ms} ms) — this normalized
            text is what will be monitored and hashed:
          </p>
          <pre className="test-content">{testResult.content}</pre>
          <p className="mono-small">sha256: {testResult.hash}</p>
        </div>
      )}

      <div className="form-actions">
        <button type="button" className="btn" onClick={() => void runTestExtraction()} disabled={testing || values.url === '' || values.selector === ''}>
          {testing ? 'Testing…' : 'Test extraction'}
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}

export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    const issues = formatValidationDetails(err.details);
    if (issues.length > 0) {
      return `${err.message} (${issues.join('; ')})`;
    }
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

export function TestingSpinner(): ReactElement {
  return <Spinner label="Running extraction in the browser…" />;
}
