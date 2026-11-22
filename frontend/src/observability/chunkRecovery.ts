const RELOAD_KEY = 'thirumal-chunk-reload-at';
const RELOAD_COOLDOWN_MS = 60_000;

/** True for the errors browsers raise when a lazily loaded code chunk is missing. */
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(
    message,
  );
}

/**
 * After a new release, tabs opened earlier may request code files that no longer exist.
 * Reload once to pick up the new release; the cooldown prevents a reload loop if the
 * server is genuinely down. Returns false when a reload was already attempted recently.
 */
export function reloadForNewRelease(): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(RELOAD_KEY) ?? '0');
    if (Date.now() - last < RELOAD_COOLDOWN_MS) return false;
    window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // Without storage we cannot guard against loops, so do not auto-reload.
    return false;
  }
  window.location.reload();
  return true;
}

/** Vite fires this event when preloading a chunk fails; recover before the user sees an error. */
export function installChunkRecovery(): void {
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadForNewRelease()) event.preventDefault();
  });
}
