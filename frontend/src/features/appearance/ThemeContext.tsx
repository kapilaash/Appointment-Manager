import { createContext, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';

export type AppTheme = 'light' | 'classic' | 'dark';

type AppearanceContextValue = {
  theme: AppTheme;
  setTheme: (theme: AppTheme) => void;
};

const AppearanceContext = createContext<AppearanceContextValue | null>(null);
const validThemes: AppTheme[] = ['light', 'classic', 'dark'];
const legacyThemes: Record<string, AppTheme> = {
  ocean: 'light',
  lavender: 'light',
  wood: 'light',
  graphite: 'light',
  espresso: 'light',
};

function storageKey(userId: string) {
  return `thirumal-appearance:${userId}`;
}

function readTheme(userId: string): AppTheme {
  try {
    const savedTheme = window.localStorage.getItem(storageKey(userId));
    if (validThemes.includes(savedTheme as AppTheme)) return savedTheme as AppTheme;
    return savedTheme ? legacyThemes[savedTheme] ?? 'light' : 'light';
  } catch {
    return 'light';
  }
}

export function ThemeProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [theme, setTheme] = useState<AppTheme>(() => readTheme(userId));

  useLayoutEffect(() => {
    const root = document.documentElement;
    const switchingTheme = Boolean(root.dataset.theme && root.dataset.theme !== theme);
    if (switchingTheme) {
      root.classList.add('theme-transitioning');
      // Commit transition rules against the old tokens before changing them.
      window.getComputedStyle(root).getPropertyValue('--surface');
    }
    root.dataset.theme = theme;
    root.style.colorScheme = theme === 'dark' ? 'dark' : 'light';
    const transitionTimer = switchingTheme
      ? window.setTimeout(() => root.classList.remove('theme-transitioning'), 300)
      : undefined;
    try {
      window.localStorage.setItem(storageKey(userId), theme);
    } catch {
      // The selected theme still applies for this session when storage is unavailable.
    }
    return () => {
      if (transitionTimer !== undefined) window.clearTimeout(transitionTimer);
    };
  }, [theme, userId]);

  const value = useMemo(() => ({ theme, setTheme }), [theme]);
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- this hook is the public consumer API for ThemeProvider.
export function useAppearance() {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error('useAppearance must be used inside ThemeProvider');
  return value;
}
