import type { DiffResult } from '../types.js';

/**
 * Renders the change payload (added/removed blocks) produced by the server's
 * diff service. Added lines are green, removed lines red.
 */
export function DiffView({ diff }: { diff: DiffResult }): React.ReactElement {
  if (diff.changes.length === 0) {
    return <p className="diff-empty">No line-level changes recorded.</p>;
  }
  return (
    <div className="diff-view">
      <div className="diff-summary">
        <span className="diff-added-count">+{diff.added}</span>{' '}
        <span className="diff-removed-count">−{diff.removed}</span>
      </div>
      {diff.changes.map((change, index) => (
        <pre key={index} className={`diff-block diff-${change.type}`}>
          {change.value}
        </pre>
      ))}
    </div>
  );
}
