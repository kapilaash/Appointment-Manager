import { useState, type FormEvent } from 'react';
import { MailCheck } from 'lucide-react';
import { AuthLayout } from '../../components/layout/AuthLayout';
import { useRequestPasswordResetMutation } from './api';

/** Works for admins and coaches; the reply never reveals whether an account exists. */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [requestReset, result] = useRequestPasswordResetMutation();

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await requestReset({ email: email.trim() }).unwrap();
    } catch {
      // The inline message below covers network problems.
    }
  }

  return (
    <AuthLayout
      title="Forgot your password?"
      subtitle="Enter the email address you sign in with. We’ll email you a link to choose a new password."
      footer={
        <a className="font-semibold text-indigo-700 underline decoration-indigo-300 underline-offset-4" href="/">
          Return to sign in
        </a>
      }
    >
      {result.isSuccess ? (
        <div
          role="status"
          className="mt-7 flex items-start gap-3 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900"
        >
          <MailCheck aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
          <span>
            If an active account matches that email, password reset instructions will be sent. The link works once and
            expires in 30 minutes. Check your spam folder if it does not arrive.
          </span>
        </div>
      ) : (
        <form onSubmit={(event) => void submit(event)} className="mt-7 space-y-5">
          <label className="block text-sm font-semibold text-slate-800">
            Account email
            <input
              required
              type="email"
              autoComplete="username"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-2 block min-h-12 w-full rounded-xl border border-slate-300 bg-surface px-3.5 py-3 text-base text-heading shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-500/15"
            />
          </label>
          <p className="text-xs leading-5 text-slate-500">
            Your username is your email address. If you are unsure which one, ask an academy administrator.
          </p>
          {result.isError && (
            <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
              The reset request could not be sent. Please wait a moment and try again.
            </p>
          )}
          <button
            type="submit"
            disabled={result.isLoading}
            className="flex min-h-12 w-full items-center justify-center rounded-xl bg-action px-4 py-3 text-sm font-semibold text-on-action shadow-sm hover:bg-action-hover disabled:opacity-60"
          >
            {result.isLoading ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
