import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';
import { useSaveThemePreferenceMutation } from '../auth/api';

/** A concrete palette applied to the page. */
export type AppTheme = 'light' | 'classic' | 'dark';
/** What the user chose; "system" follows the device's light/dark setting. */
export type ThemePreference = AppTheme | 'system';

type AppearanceContextValue = {
  preference: ThemePreference;
  theme: AppTheme;
  setPreference: (preference: ThemePreference) => void;
};

/** Device-wide cache read by public/theme-init.js before React loads. Keep the key in sync. */
const STORAGE_KEY = 'thirumal-theme';
const THEME_COLORS: Record<AppTheme, string> = { light: '#f8fafc', classic: '#f7f3e8', dark: '#09090b' };
const PREFERENCES: ThemePreference[] = ['light', 'classic', 'dark', 'system'];
/** Long enough to feel calm; must match the view-transition duration in globals.css. */
const TRANSITION_MS = 700;

const AppearanceContext = createContext<AppearanceContextValue | null>(null);
const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

function isPreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && PREFERENCES.includes(value as ThemePreference);
}

function readStoredPreference(userId: string): ThemePreference {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isPreference(stored)) return stored;
    // One-time migration from the earlier per-user, browser-only key.
    const legacy = window.localStorage.getItem(`thirumal-appearance:${userId}`);
    if (isPreference(legacy)) return legacy;
  } catch {
    // Storage can be unavailable (private mode, blocked cookies); fall back to the default.
  }
  return 'light';
}

function subscribeToDeviceScheme(onChange: () => void) {
  const query = darkQuery();
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Apply a palette. Theme changes cross-fade slowly so the switch is easy on the eyes:
 * the View Transitions API fades one composited snapshot of the page (cheap, even on
 * busy pages); older browsers fall back to a short CSS colour transition on surfaces.
 */
function applyTheme(theme: AppTheme) {
  const root = document.documentElement;
  if (root.dataset.theme === theme) return;
  const commit = () => {
    root.dataset.theme = theme;
    root.style.colorScheme = theme === 'dark' ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
  };
  if (!root.dataset.theme || prefersReducedMotion()) {
    commit();
    return;
  }
  if (typeof document.startViewTransition === 'function') {
    root.classList.add('theme-view-transition');
    const transition = document.startViewTransition(() => flushSync(commit));
    void transition.finished.finally(() => root.classList.remove('theme-view-transition'));
    return;
  }
  root.classList.add('theme-transitioning');
  // Read a style so the transition rules attach before the colour tokens change.
  window.getComputedStyle(root).getPropertyValue('--surface');
  commit();
  window.setTimeout(() => root.classList.remove('theme-transitioning'), TRANSITION_MS);
}

export function ThemeProvider({
  userId,
  savedPreference,
  savedAt,
  children,
}: {
  userId: string;
  /** The preference stored on the account, so it follows the user across devices. */
  savedPreference: ThemePreference | null | undefined;
  /** When the account data carrying savedPreference was requested (ms since epoch). */
  savedAt: number | undefined;
  children: ReactNode;
}) {
  const [preference, setPreferenceState] = useState<ThemePreference>(
    () => savedPreference ?? readStoredPreference(userId),
  );
  // Adopt a preference saved on another device when the account data refreshes, but never let
  // a response that was requested before the user's latest choice undo that choice.
  const [localChangedAt, setLocalChangedAt] = useState(0);
  const serverKey = `${savedPreference ?? ''}|${savedAt ?? 0}`;
  const [lastServerKey, setLastServerKey] = useState(serverKey);
  if (serverKey !== lastServerKey) {
    setLastServerKey(serverKey);
    if (savedPreference && (savedAt ?? 0) > localChangedAt) setPreferenceState(savedPreference);
  }
  const deviceIsDark = useSyncExternalStore(
    subscribeToDeviceScheme,
    () => darkQuery().matches,
    () => false,
  );
  const theme: AppTheme = preference === 'system' ? (deviceIsDark ? 'dark' : 'light') : preference;
  const [savePreference] = useSaveThemePreferenceMutation();

  useLayoutEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Cache on this device so the next visit (and the sign-in page) paints the right theme at once.
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // The theme still applies for this visit when storage is unavailable.
    }
  }, [preference]);

  // Saves go out one at a time and only the latest pending choice is sent, so quick
  // successive clicks reach the server in order and the last one always wins.
  const queuedSave = useRef<ThemePreference | null>(null);
  const saving = useRef(false);
  const flushSaves = useCallback(async () => {
    if (saving.current) return;
    saving.current = true;
    try {
      while (queuedSave.current) {
        const next = queuedSave.current;
        queuedSave.current = null;
        // Best effort: the local choice already applies even if saving to the account fails.
        await savePreference({ theme: next })
          .unwrap()
          .catch(() => undefined);
      }
    } finally {
      saving.current = false;
    }
  }, [savePreference]);

  const setPreference = useCallback(
    (next: ThemePreference) => {
      setPreferenceState(next);
      setLocalChangedAt(Date.now());
      queuedSave.current = next;
      void flushSaves();
    },
    [flushSaves],
  );

  const value = useMemo(() => ({ preference, theme, setPreference }), [preference, theme, setPreference]);
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- this hook is the public consumer API for ThemeProvider.
export function useAppearance() {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error('useAppearance must be used inside ThemeProvider');
  return value;
}
