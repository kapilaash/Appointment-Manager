import { useState, type FormEvent } from 'react';
import { CalendarDays, Crown } from 'lucide-react';
import { useCsrfQuery, useLoginMutation, useMeQuery, useRequestPasswordResetMutation } from './api';
import { formatLoginError } from './formatLoginError';
import { Button } from '../../components/ui/Button';

export function LoginPage() {
  const { refetch } = useMeQuery();
  const csrf = useCsrfQuery();
  const [login, result] = useLoginMutation();
  const [requestReset, resetResult] = useRequestPasswordResetMutation();
  const [showReset, setShowReset] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (showReset) {
      try { await requestReset({ email }).unwrap(); } catch { /* Keep account existence private. */ }
      return;
    }
    try { await login({ email, password }).unwrap(); await refetch(); } catch { /* API response shown below */ }
  }

  const error = formatLoginError(result.error);

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_.95fr]">
      <aside className="relative hidden overflow-hidden bg-slate-950 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-32 -top-24 h-96 w-96 rounded-full bg-indigo-500/20 blur-3xl" />
        <div className="relative flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl bg-indigo-500"><Crown size={21} /></span><span className="font-semibold">Thirumal Chess Academy</span></div>
        <div className="relative max-w-xl"><p className="text-sm font-semibold uppercase tracking-[.2em] text-indigo-300">Make every first move count</p><h1 className="mt-5 text-5xl font-semibold leading-tight tracking-tight">A thoughtful start to a student’s chess journey.</h1><p className="mt-6 max-w-md text-lg leading-8 text-slate-300">Coordinate instructors, find a time that works, and give every new family a warm welcome.</p></div>
        <p className="relative text-sm text-slate-400">Scheduling workspace · Secure staff access</p>
      </aside>
      <main className="flex items-center justify-center px-6 py-12">
        <form onSubmit={submit} className="w-full max-w-md">
          <div className="mb-8 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700 lg:hidden"><CalendarDays /></div>
          <p className="text-sm font-semibold text-indigo-700">Staff workspace</p><h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Welcome back</h2><p className="mt-2 text-slate-500">Sign in to manage demo classes and instructor schedules.</p>
          <label className="mt-8 block text-sm font-medium text-slate-700">Email address<input autoComplete="username" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 px-3.5 py-3 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" /></label>
          {!showReset && <label className="mt-5 block text-sm font-medium text-slate-700">Password<input autoComplete="current-password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 px-3.5 py-3 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" /></label>}
          {showReset && <p className="mt-5 rounded-lg bg-indigo-50 p-3 text-sm text-indigo-900">Enter your email address. If the account exists, password reset instructions will be sent.</p>}
          {result.isError && <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
          {resetResult.isSuccess && <p role="status" className="mt-4 text-sm text-emerald-700">If the account exists, reset instructions will be sent.</p>}
          {showReset ? <div className="mt-7 flex gap-3"><Button type="button" variant="secondary" onClick={() => setShowReset(false)}>Back</Button><Button disabled={resetResult.isLoading || !csrf.isSuccess}>{resetResult.isLoading ? 'Sending…' : 'Send reset link'}</Button></div> : <><Button disabled={result.isLoading || !csrf.isSuccess} className="mt-7 w-full py-3">{result.isLoading ? 'Signing in…' : 'Sign in'}</Button><button type="button" onClick={() => setShowReset(true)} className="mt-4 w-full text-center text-sm font-medium text-indigo-700">Forgot your password?</button></>}
          <p className="mt-5 text-center text-xs text-slate-400">Your session is protected with secure, server-managed sign-in.</p>
        </form>
      </main>
    </div>
  );
}
