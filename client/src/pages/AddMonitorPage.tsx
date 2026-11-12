import { type ReactElement } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { MonitorForm, type MonitorFormValues } from '../components/MonitorForm.js';
import { Icon } from '../components/ui.js';
import { useI18n } from '../i18n.js';

export function AddMonitorPage(): ReactElement {
  const navigate = useNavigate();
  const { t } = useI18n();

  const create = async (values: MonitorFormValues): Promise<void> => {
    const result = await api.post<{ monitor: { id: string } }>('/monitors', {
      name: values.name,
      url: values.url,
      selector: values.selector,
      selector_type: values.selector_type,
      check_interval_seconds: values.check_interval_seconds,
      webhook_url: values.webhook_url === '' ? null : values.webhook_url,
      notify_email: values.notify_email === '' ? null : values.notify_email,
      enabled: values.enabled,
    });
    navigate(`/monitors/${result.monitor.id}`);
  };

  return (
    <div className="page narrow">
      <p className="breadcrumb">
        <Link to="/">
          <Icon name="arrow-left" size={15} />
          {t('action.back')}
        </Link>
      </p>

      <header className="page-header">
        <div className="page-heading">
          <span className="eyebrow">{t('nav.add')}</span>
          <h1>{t('form.addTitle')}</h1>
          <p className="page-intro">{t('form.addSubtitle')}</p>
        </div>
      </header>

      <MonitorForm submitLabel={t('action.createMonitor')} onSubmit={create} />
    </div>
  );
}
