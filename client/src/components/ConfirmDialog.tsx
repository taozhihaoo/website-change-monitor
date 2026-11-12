import { useState, type ReactElement } from 'react';
import { Icon } from './ui.js';
import { useI18n } from '../i18n.js';

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}): ReactElement {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={() => {
        if (!busy) {
          onCancel();
        }
      }}
    >
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-icon">
          <Icon name="alert" size={20} />
        </div>
        <h3>{title}</h3>
        <p>{message}</p>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            {t('action.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              onConfirm();
            }}
          >
            {busy ? t('action.working') : (confirmLabel ?? t('action.delete'))}
          </button>
        </div>
      </div>
    </div>
  );
}
