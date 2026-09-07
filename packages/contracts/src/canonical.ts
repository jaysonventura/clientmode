/** Deterministic serialization for identity digests.
 * Object keys are sorted, arrays keep order, and the named field is excluded so a digest
 * is never computed over itself. Non-finite numbers are refused rather than silently coerced.
 */
import { createHash } from 'node:crypto';

export function canonicalize(value: unknown, excludeKey?: string): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('NON_CANONICAL_NUMBER');
    return Number.isInteger(value) ? String(value) : JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(item => canonicalize(item, excludeKey)).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key, item]) => key !== excludeKey && item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item, excludeKey)}`).join(',')}}`;
  }
  throw new Error('NON_CANONICAL_VALUE');
}

export function digest(value: unknown, excludeKey?: string): string {
  return `sha256:${createHash('sha256').update(canonicalize(value, excludeKey), 'utf8').digest('hex')}`;
}
