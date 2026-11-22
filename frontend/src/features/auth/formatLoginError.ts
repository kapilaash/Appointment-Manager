export function formatLoginError(error: unknown): string {
  const fallback = 'We could not sign you in. Check your details and try again.';
  if (!error || typeof error !== 'object') return fallback;

  const value = error as Record<string, unknown>;
  const payload = value.data;
  if (payload && typeof payload === 'object') {
    const detail = (payload as Record<string, unknown>).detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) {
      const messages = detail.map((item) => {
        if (!item || typeof item !== 'object') return String(item);
        const issue = item as Record<string, unknown>;
        const message = typeof issue.msg === 'string' ? issue.msg : 'Invalid value';
        const location = Array.isArray(issue.loc) ? issue.loc.filter((part) => part !== 'body').join(' → ') : '';
        return location ? `${location}: ${message}` : message;
      });
      if (messages.length) return messages.join('. ');
    }
    if (detail && typeof detail === 'object') {
      const message = (detail as Record<string, unknown>).message;
      if (typeof message === 'string') return message;
    }
  }

  if (value.status === 'FETCH_ERROR')
    return 'Could not reach the sign-in service. Check that the app is running and try again.';
  if (value.status === 'PARSING_ERROR') return 'The sign-in service returned an unreadable response. Please try again.';
  if (typeof value.error === 'string') return value.error;
  if (typeof value.message === 'string') return value.message;
  if (typeof value.status === 'number') return `Sign-in failed (HTTP ${value.status}). Please try again.`;
  return fallback;
}
