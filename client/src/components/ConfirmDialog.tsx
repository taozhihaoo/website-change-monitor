import { useState, type ReactElement } from 'react';

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Delete',
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}): ReactElement {
  const [busy, setBusy] = useState(false);
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal">
        <h3>{title}</h3>
        <p>{message}</p>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
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
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
