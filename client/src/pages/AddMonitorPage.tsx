import { type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { MonitorForm, type MonitorFormValues } from '../components/MonitorForm.js';

export function AddMonitorPage(): ReactElement {
  const navigate = useNavigate();

  const create = async (values: MonitorFormValues): Promise<void> => {
    const result = await api.post<{ monitor: { id: string } }>('/monitors', {
      name: values.name,
      url: values.url,
      selector: values.selector,
      selector_type: values.selector_type,
      check_interval_seconds: values.check_interval_seconds,
      webhook_url: values.webhook_url === '' ? null : values.webhook_url,
      enabled: values.enabled,
    });
    navigate(`/monitors/${result.monitor.id}`);
  };

  return (
    <div className="narrow">
      <div className="page-header">
        <h1>Add monitor</h1>
      </div>
      <p className="page-intro">
        Point the monitor at a public page, pick the content to watch, and use “Test extraction”
        to verify the selector before saving.
      </p>
      <MonitorForm submitLabel="Create monitor" onSubmit={create} />
    </div>
  );
}
