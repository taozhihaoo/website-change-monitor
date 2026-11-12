import type { DiffResult } from '../types.js';
import { useI18n } from '../i18n.js';

/**
 * Renders the change payload (added/removed blocks) produced by the server's
 * diff service. Added lines are green, removed lines red — with a gutter so
 * the blocks read like a real unified diff.
 */
export function DiffView({ diff }: { diff: DiffResult }): React.ReactElement {
  const { t } = useI18n();
  if (diff.changes.length === 0) {
    return <p className="diff-empty">{t('monitor.noChanges')}</p>;
  }
  return (
    <div className="diff-view">
      <div className="diff-summary">
        <span className="diff-pill diff-pill-added">+{diff.added}</span>
        <span className="diff-pill diff-pill-removed">−{diff.removed}</span>
        <span className="diff-caption">{t('monitor.diff')}</span>
      </div>
      <div className="diff-body">
        {diff.changes.map((change, index) => (
          <div key={index} className={`diff-block diff-${change.type}`}>
            <span className="diff-gutter" aria-hidden="true">
              {change.type === 'added' ? '+' : '−'}
            </span>
            <pre className="diff-code">{change.value}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}
