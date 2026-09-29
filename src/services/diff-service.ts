import type { DiffEntry, DiffResult } from '../domain/types.js';
import { diffLines } from 'diff';

function countContentLines(value: string): number {
  return value.split('\n').filter((line) => line.trim().length > 0).length;
}

function ensureTrailingNewline(value: string): string {
  return value.length === 0 || value.endsWith('\n') ? value : `${value}\n`;
}

/**
 * Computes a simple, human-readable line diff between two normalized
 * contents. Output is shaped for direct rendering in the UI (added/removed
 * blocks with line counts).
 */
export function computeDiff(previous: string, current: string): DiffResult {
  // jsdiff treats trailing newlines as part of each chunk; aligning them
  // avoids phantom "line modified" pairs when the last line differs only in
  // newline termination.
  const parts = diffLines(ensureTrailingNewline(previous), ensureTrailingNewline(current));
  const changes: DiffEntry[] = [];
  let added = 0;
  let removed = 0;

  for (const part of parts) {
    if (part.added) {
      const count = countContentLines(part.value);
      if (count > 0) {
        added += count;
        changes.push({ type: 'added', value: part.value.replace(/\n$/, ''), count });
      }
    } else if (part.removed) {
      const count = countContentLines(part.value);
      if (count > 0) {
        removed += count;
        changes.push({ type: 'removed', value: part.value.replace(/\n$/, ''), count });
      }
    }
  }

  return { added, removed, changes };
}
