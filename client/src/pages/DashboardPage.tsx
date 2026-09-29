import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { api, formatDateTime, formatInterval } from '../api/client.js';
import type { MonitorWithSummary, Stats } from '../types.js';
import { EmptyState, EnabledBadge, ErrorBox, Spinner, StatusBadge } from '../components/ui.js';

export function DashboardPage(): ReactElement {
  const [stats, setStats] = useState<Stats | null>(null);
  const [monitors, setMonitors] = useState<MonitorWithSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [runMessage, setRunMessage] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [statsResult, listResult] = await Promise.all([
        api.get<Stats>('/stats'),
        api.get<{ monitors: MonitorWithSummary[] }>('/monitors'),
      ]);
      setStats(statsResult);
      setMonitors(listResult.monitors);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [load]);

  const runNow = async (monitor: MonitorWithSummary): Promise<void> => {
    setRunningId(monitor.id);
    setRunMessage(null);
    try {
      const result = await api.post<{ run: { status: string } }>(
        `/monitors/${monitor.id}/run?wait=1`,
      );
      setRunMessage(`"${monitor.name}": ${result.run.status}`);
      await load();
    } catch (err) {
      setRunMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setRunningId(null);
    }
  };

  if (monitors === null && error === null) {
    return <Spinner label="Loading dashboard…" />;
  }

  return (
    <div>
      <div className="page-header">
        <h1>Dashboard</h1>
        <div className="page-actions">
          <button type="button" className="btn" onClick={() => void load()}>
            Refresh
          </button>
          <Link to="/monitors/new" className="btn btn-primary">
            Add monitor
          </Link>
        </div>
      </div>

      {error !== null && <ErrorBox message={error} onRetry={() => void load()} />}

      {stats !== null && (
        <div className="stats-grid">
          <div className="stat-card">
            <span className="stat-value">{stats.total_monitors}</span>
            <span className="stat-label">Monitors</span>
          </div>
          <div className="stat-card">
            <span className="stat-value">{stats.active_monitors}</span>
            <span className="stat-label">Active</span>
          </div>
          <div className="stat-card">
            <span className="stat-value">{stats.failed_monitors}</span>
            <span className="stat-label">Failing</span>
          </div>
          <div className="stat-card">
            <span className="stat-value">{stats.changes_detected}</span>
            <span className="stat-label">Changes detected</span>
          </div>
          <div className="stat-card">
            <span className="stat-value stat-time">{formatDateTime(stats.last_check_at)}</span>
            <span className="stat-label">Last check</span>
          </div>
        </div>
      )}

      {runMessage !== null && <p className="info-message">{runMessage}</p>}

      {monitors !== null && monitors.length === 0 ? (
        <EmptyState
          title="No monitors yet"
          hint="Add a monitor to start watching a page for changes."
        />
      ) : (
        monitors !== null && (
          <div className="table-wrap card">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>URL</th>
                  <th>Status</th>
                  <th>Last checked</th>
                  <th>Last changed</th>
                  <th>Next check</th>
                  <th>Interval</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {monitors.map((monitor) => (
                  <tr key={monitor.id}>
                    <td>
                      <Link to={`/monitors/${monitor.id}`} className="monitor-link">
                        {monitor.name}
                      </Link>
                      <div className="badges-row">
                        <EnabledBadge enabled={monitor.enabled} />
                      </div>
                    </td>
                    <td className="mono-small url-cell" title={monitor.url}>
                      {monitor.url}
                    </td>
                    <td>
                      <StatusBadge status={monitor.last_check_status} />
                    </td>
                    <td>{formatDateTime(monitor.last_check_at)}</td>
                    <td>{formatDateTime(monitor.last_change_at)}</td>
                    <td>{formatDateTime(monitor.next_check_at)}</td>
                    <td>{formatInterval(monitor.check_interval_seconds)}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-small"
                        disabled={runningId === monitor.id}
                        onClick={() => void runNow(monitor)}
                      >
                        {runningId === monitor.id ? 'Checking…' : 'Run now'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
