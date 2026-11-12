import { useState, type FormEvent, type ReactElement } from 'react';
import { api, ApiError, formatValidationDetails } from '../api/client.js';
import type { Monitor, SelectorType, TestExtractionResult } from '../types.js';
import { useI18n } from '../i18n.js';
import { Icon, Segmented } from './ui.js';

export interface MonitorFormValues {
  name: string;
  url: string;
  selector: string;
  selector_type: SelectorType;
  check_interval_seconds: number;
  webhook_url: string;
  notify_email: string;
  enabled: boolean;
}

export const INTERVAL_PRESETS: number[] = [300, 900, 1800, 3600, 21600, 86400];

const EMPTY_FORM: MonitorFormValues = {
  name: '',
  url: '',
  selector: '',
  selector_type: 'css',
  check_interval_seconds: 300,
  webhook_url: '',
  notify_email: '',
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
    notify_email: monitor.notify_email ?? '',
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
  const { t, interval } = useI18n();
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
      setError(describeError(err, t));
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
      setError(describeError(err, t));
      setSaving(false);
    }
  };

  const selectorOptions: Array<{ value: SelectorType; label: string }> = [
    { value: 'css', label: 'CSS' },
    { value: 'xpath', label: 'XPath' },
    { value: 'text', label: 'Text' },
  ];

  return (
    <form className="monitor-form" onSubmit={(event) => void handleSubmit(event)}>
      <section className="card form-section">
        <header className="section-head">
          <span className="section-icon">
            <Icon name="search" size={17} />
          </span>
          <h2>{t('form.sectionTarget')}</h2>
        </header>

        <label className="field">
          <span>{t('form.name')}</span>
          <input
            value={values.name}
            onChange={(event) => set('name', event.target.value)}
            placeholder={t('form.namePlaceholder')}
            required
            maxLength={200}
            autoComplete="off"
          />
        </label>

        <label className="field">
          <span>{t('form.url')}</span>
          <input
            value={values.url}
            onChange={(event) => set('url', event.target.value)}
            placeholder={t('form.urlPlaceholder')}
            type="url"
            required
            autoComplete="off"
            spellCheck={false}
          />
          <small>{t('form.urlHint')}</small>
        </label>

        <div className="field-row">
          <label className="field">
            <span>{t('form.selector')}</span>
            <input
              value={values.selector}
              onChange={(event) => set('selector', event.target.value)}
              placeholder={t('form.selectorPlaceholder')}
              required
              autoComplete="off"
              spellCheck={false}
              className="mono"
            />
          </label>
          <div className="field">
            <span>{t('form.selectorType')}</span>
            <Segmented
              value={values.selector_type}
              options={selectorOptions}
              onChange={(value) => set('selector_type', value)}
              ariaLabel={t('form.selectorType')}
            />
          </div>
        </div>
      </section>

      <section className="card form-section">
        <header className="section-head">
          <span className="section-icon">
            <Icon name="clock" size={17} />
          </span>
          <h2>{t('form.sectionSchedule')}</h2>
        </header>

        <label className="field">
          <span>{t('form.interval')}</span>
          <select
            value={values.check_interval_seconds}
            onChange={(event) => set('check_interval_seconds', Number(event.target.value))}
          >
            {INTERVAL_PRESETS.map((preset) => (
              <option key={preset} value={preset}>
                {interval(preset)}
              </option>
            ))}
          </select>
        </label>

        <label className="switch-row">
          <input
            type="checkbox"
            checked={values.enabled}
            onChange={(event) => set('enabled', event.target.checked)}
          />
          <span className="switch" aria-hidden="true" />
          <span>{t('form.enabled')}</span>
        </label>
      </section>

      <section className="card form-section">
        <header className="section-head">
          <span className="section-icon">
            <Icon name="bell" size={17} />
          </span>
          <h2>{t('form.sectionNotify')}</h2>
        </header>

        <label className="field">
          <span>{t('form.webhook')}</span>
          <input
            value={values.webhook_url}
            onChange={(event) => set('webhook_url', event.target.value)}
            placeholder={t('form.webhookPlaceholder')}
            type="url"
            autoComplete="off"
            spellCheck={false}
            className="mono"
          />
          <small>{t('form.webhookHint')}</small>
        </label>

        <label className="field">
          <span>{t('form.email')}</span>
          <input
            value={values.notify_email}
            onChange={(event) => set('notify_email', event.target.value)}
            placeholder={t('form.emailPlaceholder')}
            type="email"
            autoComplete="off"
          />
          <small>{t('form.emailHint')}</small>
        </label>
      </section>

      {error !== null && (
        <div className="alert alert-error" role="alert">
          <Icon name="alert" size={18} />
          <span>{error}</span>
        </div>
      )}

      {testResult !== null && (
        <div className="test-result">
          <div className="test-result-head">
            <span className="test-badge">
              <Icon name="check" size={15} />
            </span>
            <div>
              <strong>{t('form.extractionPreview')}</strong>
              <p className="test-meta">
                {testResult.duration_ms} ms · {t('form.extractionPreviewHint')}
              </p>
            </div>
          </div>
          <pre className="test-content">{testResult.content}</pre>
          <p className="mono-small hash-line">sha256 · {testResult.hash}</p>
        </div>
      )}

      <div className="form-actions">
        <button
          type="button"
          className="btn"
          onClick={() => void runTestExtraction()}
          disabled={testing || values.url === '' || values.selector === ''}
        >
          <Icon name="search" size={16} />
          {testing ? t('action.testing') : t('action.testExtraction')}
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? t('action.working') : submitLabel}
        </button>
      </div>
    </form>
  );
}

export function describeError(
  err: unknown,
  t?: (key: string) => string,
): string {
  if (err instanceof ApiError) {
    if (err.code === 'NETWORK' && t !== undefined) {
      return t('error.network');
    }
    const issues = formatValidationDetails(err.details);
    if (issues.length > 0) {
      return `${err.message} (${issues.join('; ')})`;
    }
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}
