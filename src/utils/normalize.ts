/**
 * Normalizes extracted page content so that cosmetic changes (line endings,
 * indentation, repeated whitespace, empty lines) do not produce change events.
 *
 * - normalizes line endings to "\n"
 * - collapses repeated whitespace inside each line to a single space
 * - trims each line and drops empty lines
 */
export function normalizeContent(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}
