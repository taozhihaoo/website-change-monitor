import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import type { MonitorWithSummary, Stats } from '../types.js';
import { useI18n } from '../i18n.js';
import {
  ApiKeyPrompt,
  EmptyState,
  EnabledBadge,
  ErrorBox,
  Icon,
  InfoMessage,
  Spinner,
  StatCard,
  StatusBadge,
} from '../components/ui.js';

export function DashboardPage(): ReactElement {
  const { t, dateTime, dateTimeShort, interval, number } = useI18n();
  const [stats, setStats] = useState<Stats | null>(null);
  const [monitors, setMonitors] = useState<MonitorWithSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [statsResult, listResult] = await Promise.all([
        api.get<Stats>('/stats'),
        api.get<{ monitors: MonitorWithSummary[] }>('/monitors'),
      ]);
      setStats(statsResult);
      setMonitors(listResult.monitors);
      setError(null);
      setAuthRequired(false);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'UNAUTHORIZED') {
        setAuthRequired(true);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [load]);

  const refresh = async (): Promise<void> => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const runNow = async (monitor: MonitorWithSummary): Promise<void> => {
    setRunningId(monitor.id);
    setRunMessage(null);
    try {
      const result = await api.post<{ run: { status: string } }>(
        `/monitors/${monitor.id}/run?wait=1`,
      );
      setRunMessage(
        t('dashboard.runResult', { name: monitor.name, status: result.run.status }),
      );
      await load();
    } catch (err) {
      setRunMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setRunningId(null);
    }
  };

  if (monitors === null && error === null && !authRequired) {
    return <Spinner label={t('dashboard.loading')} />;
  }

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

  return (
    <div className="page">
      <header className="page-header">
        <div className="page-heading">
          <span className="eyebrow">{t('dashboard.eyebrow')}</span>
          <h1>{t('dashboard.title')}</h1>
          <p className="page-intro">{t('dashboard.subtitle')}</p>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void refresh()}
            disabled={refreshing}
          >
            <Icon name="refresh" size={16} className={refreshing ? 'spin-icon' : undefined} />
            {t('action.refresh')}
          </button>
          <Link to="/monitors/new" className="btn btn-primary">
            <Icon name="plus" size={16} />
            {t('action.addMonitor')}
          </Link>
        </div>
      </header>

      {error !== null && <ErrorBox message={error} onRetry={() => void load()} />}
      {runMessage !== null && <InfoMessage>{runMessage}</InfoMessage>}

      {stats !== null && (
        <div className="stats-grid">
          <StatCard
            icon="grid"
            tone="accent"
            label={t('dashboard.stat.monitors')}
            value={number(stats.total_monitors)}
          />
          <StatCard
            icon="pulse"
            tone="success"
            label={t('dashboard.stat.active')}
            value={number(stats.active_monitors)}
          />
          <StatCard
            icon="alert"
            tone="danger"
            label={t('dashboard.stat.failing')}
            value={number(stats.failed_monitors)}
          />
          <StatCard
            icon="diff"
            tone="warning"
            label={t('dashboard.stat.changes')}
            value={number(stats.changes_detected)}
          />
          <StatCard
            icon="clock"
            label={t('dashboard.stat.lastCheck')}
            value={dateTimeShort(stats.last_check_at)}
            compact
          />
        </div>
      )}

      {monitors !== null && monitors.length === 0 ? (
        <EmptyState
          icon="radar"
          title={t('dashboard.empty.title')}
          hint={t('dashboard.empty.hint')}
          action={
            <Link to="/monitors/new" className="btn btn-primary">
              <Icon name="plus" size={16} />
              {t('dashboard.empty.action')}
            </Link>
          }
        />
      ) : (
        monitors !== null && (
          <section className="card table-card">
            <header className="card-head">
              <div>
                <h2>{t('dashboard.table.title')}</h2>
                <p className="card-sub">
                  {t('dashboard.table.count', {
                    n: monitors.length,
                    active: monitors.filter((monitor) => monitor.enabled).length,
                  })}
                </p>
              </div>
            </header>
            <div className="table-wrap">
              <table className="monitor-table">
                <thead>
                  <tr>
                    <th>{t('dashboard.table.name')}</th>
                    <th>{t('dashboard.table.status')}</th>
                    <th>{t('dashboard.table.lastChecked')}</th>
                    <th>{t('dashboard.table.lastChanged')}</th>
                    <th>{t('dashboard.table.nextCheck')}</th>
                    <th>{t('dashboard.table.interval')}</th>
                    <th className="th-actions">{t('dashboard.table.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {monitors.map((monitor) => (
                    <tr key={monitor.id}>
                      <td>
                        <Link to={`/monitors/${monitor.id}`} className="monitor-cell">
                          <span className="monitor-name">
                            {monitor.name}
                            <Icon name="chevron" size={14} className="row-chevron" />
                          </span>
                          <span className="monitor-url mono-small" title={monitor.url}>
                            {monitor.url}
                          </span>
                        </Link>
                        <div className="badges-row">
                          <EnabledBadge enabled={monitor.enabled} />
                        </div>
                      </td>
                      <td>
                        <StatusBadge status={monitor.last_check_status} />
                      </td>
                      <td className="cell-time" title={dateTime(monitor.last_check_at)}>
                        {dateTimeShort(monitor.last_check_at)}
                      </td>
                      <td className="cell-time" title={dateTime(monitor.last_change_at)}>
                        {dateTimeShort(monitor.last_change_at)}
                      </td>
                      <td className="cell-time" title={dateTime(monitor.next_check_at)}>
                        {dateTimeShort(monitor.next_check_at)}
                      </td>
                      <td>
                        <span className="interval-chip">{interval(monitor.check_interval_seconds)}</span>
                      </td>
                      <td className="cell-actions">
                        <button
                          type="button"
                          className="btn btn-small"
                          disabled={runningId === monitor.id}
                          onClick={() => void runNow(monitor)}
                        >
                          <Icon name="play" size={13} />
                          {runningId === monitor.id ? t('action.checking') : t('action.run')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )
      )}
    </div>
  );
}
