import { useMemo, useState, type FormEvent } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { AuthLayout } from '../../components/layout/AuthLayout';
import { PASSWORD_HINT, PasswordField } from '../../components/ui/PasswordField';
import { apiErrorDetail } from '../../lib/apiError';
import { useResetPasswordMutation } from './api';

export function ResetPasswordPage() {
  // The one-time token arrives in the URL fragment, which browsers never send to servers.
  const token = useMemo(() => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '', []);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [reset, result] = useResetPasswordMutation();
  const mismatch = Boolean(confirmPassword) && password !== confirmPassword;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (mismatch || !token) return;
    try {
      await reset({ token, password }).unwrap();
      // Drop the used token from the address bar and browser history.
      window.history.replaceState({}, document.title, window.location.pathname);
    } catch {
      // Shown inline below.
    }
  }

  const failure =
    result.error && 'status' in result.error && result.error.status === 422
      ? (apiErrorDetail(result.error) ?? 'Choose a stronger password.')
      : 'This reset link is invalid, expired, or already used. Request a new one from the sign-in page.';

  return (
    <AuthLayout
      title="Choose a new password"
      subtitle="After saving, you’ll be signed out everywhere and can sign in with the new password."
    >
      {result.isSuccess ? (
        <div
          role="status"
          className="mt-7 flex items-start gap-3 rounded-xl bg-success-50 p-4 text-sm text-success-900"
        >
          <CheckCircle2 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
          <span>
            Password updated.{' '}
            <a href="/" className="font-semibold underline">
              Sign in
            </a>{' '}
            with your new password.
          </span>
        </div>
      ) : !token ? (
        <p role="alert" className="mt-7 rounded-lg bg-danger-50 p-3 text-sm text-danger-700">
          This page needs the link from your reset email.{' '}
          <a href="/forgot-password" className="font-semibold underline">
            Request a new link
          </a>
          .
        </p>
      ) : (
        <form onSubmit={submit} className="mt-7 space-y-5">
          <PasswordField
            label="New password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
            hint={PASSWORD_HINT}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <PasswordField
            label="Confirm new password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
          {mismatch && (
            <p role="alert" className="text-sm text-danger-700">
              Passwords do not match.
            </p>
          )}
          {result.isError && (
            <p role="alert" className="rounded-lg bg-danger-50 p-3 text-sm text-danger-700">
              {failure}
            </p>
          )}
          <button
            type="submit"
            disabled={password.length < 12 || mismatch || result.isLoading}
            className="flex min-h-12 w-full items-center justify-center rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-on-accent shadow-sm hover:bg-accent-hover disabled:opacity-60"
          >
            {result.isLoading ? 'Saving…' : 'Set new password'}
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
