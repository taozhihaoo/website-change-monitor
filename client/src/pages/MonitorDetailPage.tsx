import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import type { ChangeEvent, CheckRun, MonitorWithSummary, Snapshot } from '../types.js';
import { useI18n } from '../i18n.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { MonitorForm, describeError, type MonitorFormValues } from '../components/MonitorForm.js';
import {
  ApiKeyPrompt,
  DeliveryBadge,
  EmptyState,
  ErrorBox,
  Icon,
  InfoMessage,
  Spinner,
  StatusBadge,
} from '../components/ui.js';
import { DiffView } from '../components/DiffView.js';

interface DetailData {
  monitor: MonitorWithSummary;
  snapshots: Snapshot[];
  changes: ChangeEvent[];
  runs: CheckRun[];
}

export function MonitorDetailPage(): ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t, dateTime, dateTimeShort, interval } = useI18n();
  const [data, setData] = useState<DetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [busy, setBusy] = useState<'run' | 'edit' | 'notify' | 'toggle' | 'delete' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    if (id === undefined) {
      return;
    }
    try {
      const [monitorRes, snapshotRes, changesRes, runsRes] = await Promise.all([
        api.get<{ monitor: MonitorWithSummary }>(`/monitors/${id}`),
        api.get<{ snapshots: Snapshot[] }>(`/monitors/${id}/snapshots?limit=5`),
        api.get<{ changes: ChangeEvent[] }>(`/monitors/${id}/changes?limit=10`),
        api.get<{ runs: CheckRun[] }>(`/monitors/${id}/runs?limit=15`),
      ]);
      setData({
        monitor: monitorRes.monitor,
        snapshots: snapshotRes.snapshots,
        changes: changesRes.changes,
        runs: runsRes.runs,
      });
      setError(null);
      setAuthRequired(false);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'UNAUTHORIZED') {
        setAuthRequired(true);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (id === undefined || (data === null && (error !== null || authRequired))) {
    if (authRequired) {
      return (
        <ApiKeyPrompt
          onSaved={() => {
            setAuthRequired(false);
            void load();
          }}
        />
      );
    }
    return error !== null ? (
      <ErrorBox message={error} onRetry={() => void load()} />
    ) : (
      <Spinner label={t('monitor.loading')} />
    );
  }
  if (data === null) {
    return <Spinner label={t('monitor.loading')} />;
  }

  const { monitor } = data;
  const latestSnapshot = data.snapshots[0] ?? null;

  const runNow = async (): Promise<void> => {
    setBusy('run');
    setMessage(null);
    try {
      const result = await api.post<{ run: { status: string } }>(
        `/monitors/${monitor.id}/run?wait=1`,
      );
      setMessage(t('monitor.checkFinished', { status: result.run.status }));
      await load();
    } catch (err) {
      setMessage(describeError(err, t));
    } finally {
      setBusy(null);
    }
  };

  const toggleEnabled = async (): Promise<void> => {
    setBusy('toggle');
    try {
      await api.patch(`/monitors/${monitor.id}`, { enabled: !monitor.enabled });
      await load();
    } catch (err) {
      setMessage(describeError(err, t));
    } finally {
      setBusy(null);
    }
  };

  const sendTestNotification = async (): Promise<void> => {
    setBusy('notify');
    setMessage(null);
    try {
      const result = await api.post<{ results: Array<{ provider: string; delivered: boolean }> }>(
        `/monitors/${monitor.id}/test-notification`,
      );
      const summary = result.results
        .map((entry) => `${entry.provider}: ${entry.delivered ? t('status.sent') : t('status.failed')}`)
        .join(', ');
      setMessage(t('monitor.testNotification', { summary }));
    } catch (err) {
      setMessage(describeError(err, t));
    } finally {
      setBusy(null);
    }
  };

  const saveEdit = async (values: MonitorFormValues): Promise<void> => {
    await api.patch(`/monitors/${monitor.id}`, {
      name: values.name,
      url: values.url,
      selector: values.selector,
      selector_type: values.selector_type,
      check_interval_seconds: values.check_interval_seconds,
      webhook_url: values.webhook_url === '' ? null : values.webhook_url,
      notify_email: values.notify_email === '' ? null : values.notify_email,
      enabled: values.enabled,
    });
    setEditing(false);
    setMessage(t('monitor.updated'));
    await load();
  };

  const deleteMonitor = async (): Promise<void> => {
    setBusy('delete');
    try {
      await api.delete(`/monitors/${monitor.id}`);
      navigate('/');
    } catch (err) {
      setMessage(describeError(err, t));
      setBusy(null);
      setConfirmingDelete(false);
    }
  };

  const triggerLabel = (trigger: string): string => {
    const labels: Record<string, string> = {
      schedule: t('trigger.schedule'),
      manual: t('trigger.manual'),
      test: t('trigger.test'),
    };
    return labels[trigger] ?? trigger;
  };

  return (
    <div className="page">
      <p className="breadcrumb">
        <Link to="/">
          <Icon name="arrow-left" size={15} />
          {t('action.back')}
        </Link>
      </p>

      <header className="page-header">
        <div className="page-heading">
          <span className="eyebrow">
            {t('nav.dashboard')} <span className="eyebrow-sep">/</span> {monitor.name}
          </span>
          <h1>
            {monitor.name}
            <StatusBadge status={monitor.last_check_status} />
          </h1>
          <p className="page-intro monitor-headline-url">
            <Icon name="globe" size={14} />
            <a href={monitor.url} target="_blank" rel="noreferrer">
              {monitor.url}
              <Icon name="external" size={12} />
            </a>
          </p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn" onClick={() => void runNow()} disabled={busy !== null}>
            <Icon name="play" size={15} />
            {busy === 'run' ? t('action.checking') : t('action.runNow')}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void toggleEnabled()}
            disabled={busy !== null}
          >
            <Icon name={monitor.enabled ? 'clock' : 'pulse'} size={15} />
            {monitor.enabled ? t('action.disable') : t('action.enable')}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setEditing((value) => !value)}>
            <Icon name="pencil" size={15} />
            {editing ? t('action.closeEditor') : t('action.edit')}
          </button>
          <button
            type="button"
            className="btn btn-danger-ghost"
            onClick={() => setConfirmingDelete(true)}
            disabled={busy !== null}
          >
            <Icon name="trash" size={15} />
            {t('action.delete')}
          </button>
        </div>
      </header>

      {message !== null && <InfoMessage>{message}</InfoMessage>}
      {error !== null && <ErrorBox message={error} onRetry={() => void load()} />}

      {editing ? (
        <MonitorForm initial={monitor} submitLabel={t('action.saveChanges')} onSubmit={saveEdit} />
      ) : (
        <section className="card">
          <header className="card-head">
            <div>
              <h2>
                <Icon name="code" size={17} /> {t('monitor.configuration')}
              </h2>
            </div>
            <button
              type="button"
              className="btn btn-small"
              onClick={() => void sendTestNotification()}
              disabled={busy !== null}
            >
              <Icon name="bell" size={14} />
              {busy === 'notify' ? t('action.sending') : t('action.sendTest')}
            </button>
          </header>

          <div className="config-grid">
            <div className="config-item">
              <span className="config-label">
                <Icon name="search" size={14} /> {t('monitor.selector')}
              </span>
              <span className="config-value mono">
                {monitor.selector}
                <span className="type-chip">{monitor.selector_type}</span>
              </span>
            </div>
            <div className="config-item">
              <span className="config-label">
                <Icon name="clock" size={14} /> {t('monitor.interval')}
              </span>
              <span className="config-value">{interval(monitor.check_interval_seconds)}</span>
            </div>
            <div className="config-item">
              <span className="config-label">
                <Icon name="pulse" size={14} /> {t('monitor.schedule')}
              </span>
              <span className="config-value">
                {t('monitor.lastChecked')}: {dateTime(monitor.last_check_at)} ·{' '}
                {t('monitor.nextCheck')}: {dateTime(monitor.next_check_at)}
              </span>
            </div>
            <div className="config-item">
              <span className="config-label">
                <Icon name="link" size={14} /> {t('monitor.webhook')}
              </span>
              <span className="config-value mono-small">
                {monitor.webhook_url ?? t('monitor.notConfigured')}
              </span>
            </div>
            <div className="config-item">
              <span className="config-label">
                <Icon name="mail" size={14} /> {t('monitor.notifyEmail')}
              </span>
              <span className="config-value">
                {monitor.notify_email ?? t('monitor.notConfigured')}
              </span>
            </div>
          </div>
        </section>
      )}

      <section className="card">
        <header className="card-head">
          <h2>
            <Icon name="code" size={17} /> {t('monitor.latestContent')}
          </h2>
          {latestSnapshot !== null && (
            <span className="count-chip">{latestSnapshot.content.length} chars</span>
          )}
        </header>
        {latestSnapshot === null ? (
          <EmptyState
            icon="radar"
            title={t('monitor.noSnapshot')}
            hint={t('monitor.noSnapshotHint')}
            action={
              <button type="button" className="btn btn-primary btn-small" onClick={() => void runNow()}>
                <Icon name="play" size={14} />
                {t('action.runNow')}
              </button>
            }
          />
        ) : (
          <>
            <pre className="content-box">{latestSnapshot.content}</pre>
            <p className="mono-small hash-line">
              <span className="hash-label">sha256</span> {latestSnapshot.content_hash} ·{' '}
              {t('monitor.captured')} {dateTime(latestSnapshot.checked_at)}
            </p>
          </>
        )}
      </section>

      <section className="card">
        <header className="card-head">
          <h2>
            <Icon name="diff" size={17} /> {t('monitor.changeHistory')}
          </h2>
          <span className="count-chip">{data.changes.length}</span>
        </header>
        {data.changes.length === 0 ? (
          <EmptyState
            icon="search"
            title={t('monitor.noChanges')}
            hint={t('monitor.noChangesHint')}
          />
        ) : (
          <div className="timeline">
            {data.changes.map((event) => (
              <details key={event.id} className="change-item">
                <summary>
                  <span className="timeline-dot" aria-hidden="true" />
                  <span className="change-time">{dateTime(event.detected_at)}</span>
                  <span className="diff-pill diff-pill-added">+{event.diff.added}</span>
                  <span className="diff-pill diff-pill-removed">−{event.diff.removed}</span>
                  <span className="change-deliveries">
                    {event.deliveries.map((delivery) => (
                      <DeliveryBadge key={delivery.id} status={delivery.status} />
                    ))}
                  </span>
                  <Icon name="chevron" size={15} className="details-chevron" />
                </summary>
                <div className="change-body">
                  <div className="change-columns">
                    <div>
                      <h3>{t('monitor.previous')}</h3>
                      <pre className="content-box">{event.previous_content}</pre>
                    </div>
                    <div>
                      <h3>{t('monitor.current')}</h3>
                      <pre className="content-box">{event.current_content}</pre>
                    </div>
                  </div>
                  <DiffView diff={event.diff} />
                  {event.deliveries.length > 0 && (
                    <p className="mono-small hash-line">
                      {event.deliveries
                        .map(
                          (delivery) =>
                            `${delivery.provider}=${delivery.status}×${delivery.attempts}${
                              delivery.last_error !== null ? ` (${delivery.last_error})` : ''
                            }`,
                        )
                        .join(', ')}
                    </p>
                  )}
                </div>
              </details>
            ))}
          </div>
        )}
      </section>

      <section className="card table-card">
        <header className="card-head">
          <h2>
            <Icon name="clock" size={17} /> {t('monitor.checkHistory')}
          </h2>
          <span className="count-chip">{data.runs.length}</span>
        </header>
        {data.runs.length === 0 ? (
          <EmptyState icon="clock" title={t('monitor.noChecks')} hint={t('monitor.noChecksHint')} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('dashboard.table.status')}</th>
                  <th>{t('monitor.trigger')}</th>
                  <th>{t('monitor.started')}</th>
                  <th>{t('monitor.duration')}</th>
                  <th>{t('monitor.error')}</th>
                </tr>
              </thead>
              <tbody>
                {data.runs.map((run) => (
                  <tr key={run.id}>
                    <td>
                      <StatusBadge status={run.status} />
                    </td>
                    <td>
                      <span className="trigger-chip">{triggerLabel(run.triggered_by)}</span>
                    </td>
                    <td className="cell-time" title={dateTime(run.started_at)}>
                      {dateTimeShort(run.started_at)}
                    </td>
                    <td className="cell-time">{run.duration_ms} ms</td>
                    <td>
                      {run.error_code !== null ? (
                        <span title={run.error_message ?? ''} className="error-code">
                          {run.error_code}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {confirmingDelete && (
        <ConfirmDialog
          title={t('monitor.deleteTitle')}
          message={t('monitor.deleteMessage', { name: monitor.name })}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => void deleteMonitor()}
        />
      )}
    </div>
  );
}
