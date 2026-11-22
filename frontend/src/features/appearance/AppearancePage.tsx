import { Check, MonitorSmartphone } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { useAppearance, type ThemePreference } from './ThemeContext';

type Swatch = { page: string; card: string; accent: string; ink: string };
type ThemeOption = { id: ThemePreference; name: string; description: string; swatch: Swatch; nightSwatch?: Swatch };

const studio: Swatch = { page: '#f8fafc', card: '#ffffff', accent: '#4f46e5', ink: '#0f172a' };
const blackWhite: Swatch = { page: '#09090b', card: '#18181b', accent: '#f4f4f5', ink: '#fafafa' };

const options: ThemeOption[] = [
  { id: 'light', name: 'Studio', description: 'A crisp neutral canvas with confident indigo accents.', swatch: studio },
  {
    id: 'classic',
    name: 'Classic Chess',
    description: 'Warm ivory, forest green, and restrained brass.',
    swatch: { page: '#f7f3e8', card: '#fffdf6', accent: '#286542', ink: '#171613' },
  },
  {
    id: 'dark',
    name: 'Black & White',
    description: 'Ink-dark surfaces with clean, high-contrast silver accents.',
    swatch: blackWhite,
  },
  {
    id: 'system',
    name: 'Match my device',
    description: 'Studio by day, Black & White when your device is in dark mode.',
    swatch: studio,
    nightSwatch: blackWhite,
  },
];

function Preview({ swatch }: { swatch: Swatch }) {
  return (
    <span className="flex flex-1 p-1" style={{ backgroundColor: swatch.page }}>
      <span
        className="m-1 flex flex-1 items-center rounded-lg p-2.5 shadow-sm"
        style={{ backgroundColor: swatch.card }}
      >
        <span className="h-2 w-8 rounded-full" style={{ backgroundColor: swatch.ink }} />
      </span>
      <span className="m-1 w-3 rounded-lg" style={{ backgroundColor: swatch.accent }} />
    </span>
  );
}

export function AppearancePage() {
  const { preference, setPreference } = useAppearance();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight text-heading">Appearance</h2>
        <p className="mt-1 text-sm text-slate-500">
          Choose how your workspace looks. Your choice is saved to your account, so it follows you to every device.
          Themes fade in gently.
        </p>
      </header>

      <Card className="p-5 sm:p-6">
        <fieldset>
          <legend className="font-semibold text-slate-900">Workspace theme</legend>
          <p className="mt-1 text-sm text-slate-500">
            The selected colors apply across your dashboard, forms, tables, and calendar.
          </p>
          <div role="radiogroup" aria-label="Workspace theme" className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {options.map((option) => {
              const selected = preference === option.id;
              return (
                <label
                  key={option.id}
                  className={`group relative cursor-pointer rounded-2xl border p-3 text-left transition duration-200 hover:-translate-y-0.5 hover:shadow-md has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-indigo-600 motion-reduce:hover:translate-y-0 ${selected ? 'border-indigo-600 shadow-sm ring-2 ring-indigo-500' : 'border-slate-200 hover:border-indigo-300'}`}
                >
                  <input
                    type="radio"
                    name="workspace-theme"
                    value={option.id}
                    checked={selected}
                    onChange={() => setPreference(option.id)}
                    aria-labelledby={`theme-${option.id}-name`}
                    aria-describedby={`theme-${option.id}-description`}
                    // Invisible but covers the whole card, so any click or tap on the card selects it.
                    className="absolute inset-0 z-10 m-0 h-full w-full cursor-pointer appearance-none rounded-2xl opacity-0"
                  />
                  <span
                    aria-hidden="true"
                    className="mb-3 flex h-20 overflow-hidden rounded-xl border transition-transform duration-300 group-hover:scale-[1.015] motion-reduce:group-hover:scale-100"
                    style={{ borderColor: option.swatch.accent }}
                  >
                    <Preview swatch={option.swatch} />
                    {option.nightSwatch && <Preview swatch={option.nightSwatch} />}
                  </span>
                  <span className="flex items-center justify-between gap-2 text-sm font-semibold text-slate-900">
                    <span id={`theme-${option.id}-name`} className="flex items-center gap-1.5">
                      {option.id === 'system' && <MonitorSmartphone size={15} aria-hidden="true" />}
                      {option.name}
                    </span>
                    {selected && <Check aria-hidden="true" size={16} className="text-indigo-600" />}
                  </span>
                  <span id={`theme-${option.id}-description`} className="mt-1 block text-xs leading-5 text-slate-500">
                    {option.description}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </Card>
    </div>
  );
}
