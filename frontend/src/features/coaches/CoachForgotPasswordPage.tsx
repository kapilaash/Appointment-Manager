import { useState, type FormEvent } from 'react';
import { useRequestCoachPasswordResetMutation } from './coachApi';

export function CoachForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [requestReset, result] = useRequestCoachPasswordResetMutation();

  async function submit(event: FormEvent) {
    event.preventDefault();
    try { await requestReset({ email }).unwrap(); }
    catch { /* The generic message prevents account discovery. */ }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-4 py-10">
      <form onSubmit={(event) => void submit(event)} className="w-full max-w-md rounded-2xl border border-slate-200 bg-surface p-7 shadow-sm sm:p-9">
        <p className="text-sm font-semibold text-indigo-700">Chess Academy staff</p>
        <h1 className="mt-2 text-2xl font-semibold text-heading">Forgot your password?</h1>
        {result.isSuccess ? (
          <div role="status" className="mt-5 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800">If an active coach account matches that email, password reset instructions will be sent.</div>
        ) : (
          <>
            <p className="mt-2 text-sm text-slate-600">Enter your coach account email and we’ll send a one time reset link.</p>
            <label className="mt-6 block text-sm font-medium text-slate-700">Coach account email
              <input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5" />
            </label>
            {result.isError && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">The reset request could not be sent. Please wait a moment and try again.</p>}
            <button disabled={result.isLoading} className="mt-6 w-full rounded-lg bg-action px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{result.isLoading ? 'Sending…' : 'Send reset link'}</button>
          </>
        )}
        <a className="mt-5 inline-block text-sm font-medium text-indigo-700 underline" href="/">Return to sign in</a>
      </form>
    </main>
  );
}
