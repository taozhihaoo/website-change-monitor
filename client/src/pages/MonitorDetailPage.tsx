import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, formatDateTime, formatInterval } from '../api/client.js';
import type {
  ChangeEvent,
  CheckRun,
  MonitorWithSummary,
  Snapshot,
} from '../types.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { MonitorForm, describeError, type MonitorFormValues } from '../components/MonitorForm.js';
import { ApiKeyPrompt, DeliveryBadge, EmptyState, ErrorBox, Spinner, StatusBadge } from '../components/ui.js';
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
      <Spinner label="Loading monitor…" />
    );
  }
  if (data === null) {
    return <Spinner label="Loading monitor…" />;
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
      setMessage(`Check finished: ${result.run.status}`);
      await load();
    } catch (err) {
      setMessage(describeError(err));
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
      setMessage(describeError(err));
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
        .map((entry) => `${entry.provider}: ${entry.delivered ? 'delivered' : 'failed'}`)
        .join(', ');
      setMessage(`Test notification — ${summary}.`);
    } catch (err) {
      setMessage(describeError(err));
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
    setMessage('Monitor updated.');
    await load();
  };

  const deleteMonitor = async (): Promise<void> => {
    setBusy('delete');
    try {
      await api.delete(`/monitors/${monitor.id}`);
      navigate('/');
    } catch (err) {
      setMessage(describeError(err));
      setBusy(null);
      setConfirmingDelete(false);
    }
  };

  return (
    <div>
      <p className="breadcrumb">
        <Link to="/">← All monitors</Link>
      </p>

      <div className="page-header">
        <h1>
          {monitor.name} <StatusBadge status={monitor.last_check_status} />
        </h1>
        <div className="page-actions">
          <button type="button" className="btn" onClick={() => void runNow()} disabled={busy !== null}>
            {busy === 'run' ? 'Checking…' : 'Run now'}
          </button>
          <button type="button" className="btn" onClick={() => void toggleEnabled()} disabled={busy !== null}>
            {monitor.enabled ? 'Disable' : 'Enable'}
          </button>
          <button type="button" className="btn" onClick={() => setEditing((value) => !value)}>
            {editing ? 'Close editor' : 'Edit'}
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => setConfirmingDelete(true)}
            disabled={busy !== null}
          >
            Delete
          </button>
        </div>
      </div>

      {message !== null && <p className="info-message">{message}</p>}
      {error !== null && <ErrorBox message={error} onRetry={() => void load()} />}

      {editing ? (
        <MonitorForm initial={monitor} submitLabel="Save changes" onSubmit={saveEdit} />
      ) : (
        <div className="card config-card">
          <h2>Configuration</h2>
          <dl className="config-list">
            <div>
              <dt>URL</dt>
              <dd>
                <a href={monitor.url} target="_blank" rel="noreferrer">
                  {monitor.url}
                </a>
              </dd>
            </div>
            <div>
              <dt>Selector</dt>
              <dd className="mono">
                {monitor.selector} <span className="badge">{monitor.selector_type}</span>
              </dd>
            </div>
            <div>
              <dt>Interval</dt>
              <dd>
                {formatInterval(monitor.check_interval_seconds)} ({monitor.check_interval_seconds}s)
              </dd>
            </div>
            <div>
              <dt>Schedule</dt>
              <dd>
                Last checked {formatDateTime(monitor.last_check_at)} · Next check{' '}
                {formatDateTime(monitor.next_check_at)}
              </dd>
            </div>
            <div>
              <dt>Webhook</dt>
              <dd>{monitor.webhook_url ?? 'not configured'}</dd>
            </div>
            <div>
              <dt>Notify email</dt>
              <dd>{monitor.notify_email ?? 'not configured'}</dd>
            </div>
          </dl>
          <button
            type="button"
            className="btn btn-small"
            onClick={() => void sendTestNotification()}
            disabled={busy !== null}
          >
            {busy === 'notify' ? 'Sending…' : 'Send test notification'}
          </button>
        </div>
      )}

      <div className="card">
        <h2>Latest extracted content</h2>
        {latestSnapshot === null ? (
          <EmptyState title="No snapshot yet" hint="Run a check to capture the first baseline." />
        ) : (
          <>
            <pre className="content-box">{latestSnapshot.content}</pre>
            <p className="mono-small">
              sha256: {latestSnapshot.content_hash} · captured {formatDateTime(latestSnapshot.checked_at)}
            </p>
          </>
        )}
      </div>

      <div className="card">
        <h2>Change history ({data.changes.length})</h2>
        {data.changes.length === 0 ? (
          <EmptyState title="No changes detected yet" />
        ) : (
          data.changes.map((event) => (
            <details key={event.id} className="change-item">
              <summary>
                <span className="badge badge-changed">changed</span>{' '}
                {formatDateTime(event.detected_at)} · +{event.diff.added} / −{event.diff.removed}
                {event.deliveries.map((delivery) => (
                  <DeliveryBadge key={delivery.id} status={delivery.status} />
                ))}
              </summary>
              <div className="change-body">
                <div className="change-columns">
                  <div>
                    <h3>Previous</h3>
                    <pre className="content-box">{event.previous_content}</pre>
                  </div>
                  <div>
                    <h3>Current</h3>
                    <pre className="content-box">{event.current_content}</pre>
                  </div>
                </div>
                <h3>Diff</h3>
                <DiffView diff={event.diff} />
                {event.deliveries.length > 0 && (
                  <p className="mono-small">
                    notifications:{' '}
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
          ))
        )}
      </div>

      <div className="card">
        <h2>Check history</h2>
        {data.runs.length === 0 ? (
          <EmptyState title="No checks yet" hint="Use “Run now” to trigger the first check." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Trigger</th>
                  <th>Started</th>
                  <th>Duration</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {data.runs.map((run) => (
                  <tr key={run.id}>
                    <td>
                      <StatusBadge status={run.status} />
                    </td>
                    <td>{run.triggered_by}</td>
                    <td>{formatDateTime(run.started_at)}</td>
                    <td>{run.duration_ms} ms</td>
                    <td>
                      {run.error_code !== null ? (
                        <span title={run.error_message ?? ''} className="mono-small">
                          {run.error_code}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {confirmingDelete && (
        <ConfirmDialog
          title="Delete monitor"
          message={`Delete "${monitor.name}"? Its snapshots, change events and check history will be removed. This cannot be undone.`}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => void deleteMonitor()}
        />
      )}
    </div>
  );
}
