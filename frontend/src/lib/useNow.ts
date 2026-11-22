import { useEffect, useState } from 'react';

/**
 * The current time as React state, refreshed on an interval. Reading Date.now() during render
 * makes output unpredictable; this keeps time-based UI ("demo has ended", "now" markers) pure.
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
