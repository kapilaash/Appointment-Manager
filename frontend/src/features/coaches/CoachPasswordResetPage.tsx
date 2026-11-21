import { useMemo, useState, type FormEvent } from 'react';
import { useResetCoachPasswordMutation } from './coachApi';

export function CoachPasswordResetPage() {
  const token = useMemo(() => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '', []);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [reset, result] = useResetCoachPasswordMutation();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirmPassword || !token) return;
    try {
      await reset({ token, password }).unwrap();
      window.history.replaceState({}, document.title, window.location.pathname);
    } catch { /* The generic error below avoids revealing token/account state. */ }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-4 py-10">
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl border border-slate-200 bg-surface p-7 shadow-sm sm:p-9">
        <p className="text-sm font-semibold text-indigo-700">Chess Academy staff</p>
        <h1 className="mt-2 text-2xl font-semibold text-heading">Reset coach password</h1>
        {result.isSuccess ? <div role="status" className="mt-5 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800">Password updated. <a href="/" className="font-semibold underline">Sign in</a> with your new password.</div> : <>
          <label className="mt-6 block text-sm font-medium text-slate-700">New password
            <input required minLength={12} maxLength={128} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5" />
          </label>
          <label className="mt-4 block text-sm font-medium text-slate-700">Confirm new password
            <input required minLength={12} maxLength={128} type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5" />
          </label>
          {result.isError && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">This reset link is invalid, expired, or already used. Ask an admin for a new one.</p>}
          {password !== confirmPassword && confirmPassword && <p role="alert" className="mt-3 text-sm text-red-700">Passwords do not match.</p>}
          <button disabled={!token || password.length < 12 || password !== confirmPassword || result.isLoading} className="mt-6 w-full rounded-lg bg-action px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{result.isLoading ? 'Updating…' : 'Set new password'}</button>
        </>}
      </form>
    </main>
  );
}
