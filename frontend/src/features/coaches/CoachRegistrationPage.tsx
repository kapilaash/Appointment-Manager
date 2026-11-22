import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { getCountryCode } from '@vvo/tzdb';
import { useRegisterCoachMutation, useValidateCoachInvitationMutation } from './coachApi';
import { TimeZoneSelect } from '../../components/ui/TimeZoneSelect';

export function CoachRegistrationPage() {
  const token = useMemo(() => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '', []);
  const [validateInvitation, invite] = useValidateCoachInvitationMutation();
  const [register, result] = useRegisterCoachMutation();
  const [fullName, setFullName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || '');
  const [countryCode, setCountryCode] = useState(
    getCountryCode(Intl.DateTimeFormat().resolvedOptions().timeZone || '') ?? '',
  );
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [validationError, setValidationError] = useState('');

  useEffect(() => {
    if (!token) return; // shown below without an extra render
    void validateInvitation({ token })
      .unwrap()
      .catch(() => {
        setValidationError(
          'This invitation is invalid, expired, or already used. Ask the academy admin for a new link.',
        );
      });
  }, [token, validateInvitation]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setValidationError('');
    if (password !== confirmPassword) {
      setValidationError('Passwords do not match.');
      return;
    }
    try {
      await register({
        token,
        full_name: fullName,
        display_name: displayName || fullName,
        country_code: countryCode,
        timezone,
        password,
      }).unwrap();
      window.history.replaceState({}, document.title, window.location.pathname);
    } catch {
      setValidationError('Registration failed. The invitation may have expired or been used.');
    }
  }

  const error =
    validationError ||
    (!token ? 'This invitation link is missing its token. Ask the academy admin for a new link.' : '') ||
    (invite.isError ? 'This invitation is invalid or expired.' : '');
  return (
    <main className="grid min-h-screen place-items-center bg-neutral-50 px-4 py-10">
      <section className="w-full max-w-lg rounded-2xl border border-neutral-200 bg-surface p-7 shadow-sm sm:p-9">
        <p className="text-sm font-semibold text-accent-700">Chess Academy staff</p>
        <h1 className="mt-2 text-2xl font-semibold text-heading">Coach registration</h1>
        {invite.data && !result.isSuccess && (
          <p className="mt-2 text-sm text-neutral-600">
            Invitation for <strong>{invite.data.email}</strong>
          </p>
        )}
        {invite.isLoading && <p className="mt-5 text-sm text-neutral-500">Checking your invitation…</p>}
        {result.isSuccess ? (
          <div className="mt-6 rounded-xl bg-success-50 p-4 text-sm text-success-800" role="status">
            Your coach account is ready.{' '}
            <a className="font-semibold underline" href="/">
              Sign in
            </a>{' '}
            with your email and new password.
          </div>
        ) : invite.data ? (
          <form className="mt-6 space-y-4" onSubmit={submit}>
            <label className="block text-sm font-medium text-neutral-700">
              Full name
              <input
                required
                maxLength={150}
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2.5"
              />
            </label>
            <label className="block text-sm font-medium text-neutral-700">
              Name shown to students
              <input
                maxLength={150}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={fullName || 'Your name'}
                className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2.5"
              />
            </label>
            <TimeZoneSelect
              required
              countryCode={countryCode}
              timezone={timezone}
              onCountryCodeChange={setCountryCode}
              onTimezoneChange={setTimezone}
              countryLabel="Country where you live"
              timezoneLabel="Coach time zone"
            />
            <label className="block text-sm font-medium text-neutral-700">
              Create password
              <input
                required
                minLength={12}
                maxLength={128}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2.5"
              />
              <span className="mt-1 block text-xs text-neutral-500">
                Use at least 12 characters. Only you can know this password.
              </span>
            </label>
            <label className="block text-sm font-medium text-neutral-700">
              Confirm password
              <input
                required
                minLength={12}
                maxLength={128}
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2.5"
              />
            </label>
            {error && (
              <p role="alert" className="rounded-lg bg-danger-50 p-3 text-sm text-danger-700">
                {error}
              </p>
            )}
            <button
              disabled={result.isLoading || !password || password !== confirmPassword}
              className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-on-accent disabled:opacity-50"
            >
              {result.isLoading ? 'Creating account…' : 'Create coach account'}
            </button>
          </form>
        ) : error ? (
          <p role="alert" className="mt-5 rounded-lg bg-danger-50 p-3 text-sm text-danger-700">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  );
}
