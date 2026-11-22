/**
 * Return the API's human-readable `detail` message from an RTK Query error, if it sent one.
 * Validation errors (422 arrays) return undefined so callers can show their own guidance.
 */
export function apiErrorDetail(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const payload = (error as { data?: unknown }).data;
  if (!payload || typeof payload !== 'object') return undefined;
  const detail = (payload as { detail?: unknown }).detail;
  return typeof detail === 'string' && detail.trim() ? detail : undefined;
}
