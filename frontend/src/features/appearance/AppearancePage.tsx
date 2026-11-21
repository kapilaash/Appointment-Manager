import { Check } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { useAppearance, type AppTheme } from './ThemeContext';

const themes: { id: AppTheme; name: string; description: string; page: string; card: string; accent: string; ink: string }[] = [
  { id: 'light', name: 'Studio', description: 'A crisp neutral canvas with confident indigo accents.', page: '#f8fafc', card: '#ffffff', accent: '#4f46e5', ink: '#0f172a' },
  { id: 'classic', name: 'Classic Chess', description: 'Warm ivory, forest green, and restrained brass.', page: '#f7f3e8', card: '#fffdf6', accent: '#286542', ink: '#171613' },
  { id: 'dark', name: 'Black & White', description: 'Ink-dark surfaces with clean, high-contrast silver accents.', page: '#09090b', card: '#18181b', accent: '#f4f4f5', ink: '#fafafa' },
];

export function AppearancePage() {
  const { theme, setTheme } = useAppearance();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight text-heading">Appearance</h2>
        <p className="mt-1 text-sm text-slate-500">Choose how your workspace looks. This preference is saved for your account in this browser.</p>
      </header>

      <Card className="p-5 sm:p-6">
        <fieldset>
          <legend className="font-semibold text-slate-900">Workspace theme</legend>
          <p className="mt-1 text-sm text-slate-500">The selected colors apply across your dashboard, forms, tables, and calendar.</p>
          <div role="group" aria-label="Workspace theme" className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {themes.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={theme === option.id}
                aria-describedby={`theme-${option.id}-description`}
                onClick={() => setTheme(option.id)}
                className={`group rounded-2xl border p-3 text-left transition duration-200 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ${theme === option.id ? 'border-indigo-600 ring-2 ring-indigo-500 shadow-sm' : 'border-slate-200 hover:border-indigo-300'}`}
              >
                <span aria-hidden="true" className="mb-3 flex h-20 overflow-hidden rounded-xl border p-1 transition-transform duration-300 group-hover:scale-[1.015]" style={{ backgroundColor: option.page, borderColor: option.accent }}>
                  <span className="m-1 flex flex-1 items-center rounded-lg p-2.5 shadow-sm" style={{ backgroundColor: option.card }}>
                    <span className="h-2 w-8 rounded-full" style={{ backgroundColor: option.ink }} />
                  </span>
                  <span className="m-1 w-3 rounded-lg" style={{ backgroundColor: option.accent }} />
                </span>
                <span className="flex items-center justify-between gap-2 text-sm font-semibold text-slate-900">
                  {option.name}
                  {theme === option.id && <Check aria-hidden="true" size={16} style={{ color: option.accent }} />}
                </span>
                <span id={`theme-${option.id}-description`} className="mt-1 block text-xs leading-5 text-slate-500">{option.description}</span>
              </button>
            ))}
          </div>
        </fieldset>
      </Card>
    </div>
  );
}
