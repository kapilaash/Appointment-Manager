import { useState } from 'react';
import { Save } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { useMeQuery } from '../auth/api';
import { AppearancePage } from '../appearance/AppearancePage';
import { useSaveSettingsMutation, useSettingsQuery } from '../appointments/api';

type Settings = {
  demo_duration_minutes: number;
  slot_interval_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
};

const defaults: Settings = {
  demo_duration_minutes: 60,
  slot_interval_minutes: 30,
  buffer_before_minutes: 0,
  buffer_after_minutes: 0,
};

const fields: { key: keyof Settings; label: string; min: number; max: number }[] = [
  { key: 'demo_duration_minutes', label: 'Class duration (minutes)', min: 15, max: 180 },
  { key: 'slot_interval_minutes', label: 'Start time interval (minutes)', min: 5, max: 180 },
  { key: 'buffer_before_minutes', label: 'Buffer before class (minutes)', min: 0, max: 120 },
  { key: 'buffer_after_minutes', label: 'Buffer after class (minutes)', min: 0, max: 120 },
];

export function SettingsPage() {
  const currentUser = useMeQuery();
  if (currentUser.data?.role === 'instructor') return <AppearancePage />;
  if (!currentUser.data)
    return (
      <div role="status" className="grid min-h-64 place-items-center text-sm text-slate-500">
        Loading settings…
      </div>
    );
  return <AcademySettingsPage />;
}

function AcademySettingsPage() {
  const query = useSettingsQuery();
  const [save, result] = useSaveSettingsMutation();
  const [values, setValues] = useState<Settings>(defaults);

  const [loaded, setLoaded] = useState(query.data);
  if (query.data && query.data !== loaded) {
    setLoaded(query.data);
    setValues(query.data);
  }

  function change(key: keyof Settings, value: string) {
    setValues((current) => ({ ...current, [key]: Number(value) }));
  }

  async function saveValues() {
    try {
      await save(values).unwrap();
    } catch {
      // The mutation error state is shown inline.
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight text-heading">Settings</h2>
        <p className="mt-1 text-sm text-slate-500">Choose your appearance and set the academy’s booking defaults.</p>
      </header>

      <AppearancePage />

      <Card className="p-5 sm:p-6">
        <h3 className="font-semibold text-slate-900">Demo class defaults</h3>
        <p className="mt-1 text-sm text-slate-500">
          Changes are saved in the database and apply to new availability searches.
        </p>
        {query.isError && (
          <p role="alert" className="mt-4 text-sm text-rose-700">
            Settings could not be loaded.
          </p>
        )}
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {fields.map(({ key, label, min, max }) => (
            <label key={key} className="text-sm font-medium text-slate-700">
              {label}
              <input
                type="number"
                min={min}
                max={max}
                value={values[key]}
                onChange={(event) => change(key, event.target.value)}
                className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-2.5"
              />
            </label>
          ))}
        </div>
        {result.isError && (
          <p role="alert" className="mt-4 text-sm text-rose-700">
            Settings could not be saved. Check the allowed ranges and try again.
          </p>
        )}
        {result.isSuccess && (
          <p role="status" className="mt-4 text-sm text-emerald-700">
            Settings saved.
          </p>
        )}
        <div className="mt-5 flex justify-end">
          <Button
            className="w-full sm:w-auto"
            onClick={() => void saveValues()}
            disabled={result.isLoading || query.isLoading}
          >
            <Save size={15} />
            {result.isLoading ? 'Saving…' : 'Save settings'}
          </Button>
        </div>
      </Card>

      <Card className="p-5 sm:p-6">
        <h3 className="font-semibold text-slate-900">Booking notifications</h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Booking emails are queued with the appointment and sent by the background worker. Local Docker mail is
          captured in Mailpit at <span className="font-medium">http://localhost:8025</span>; production uses the SMTP
          server configured for the backend.
        </p>
        <p className="mt-3 text-xs leading-5 text-slate-500">
          The academy coordinates meeting details separately. Google Calendar and automatic meeting links are not
          enabled in this version.
        </p>
      </Card>
    </div>
  );
}
