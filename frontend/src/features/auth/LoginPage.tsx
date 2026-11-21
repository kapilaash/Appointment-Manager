import React, { useState } from 'react';
import { Crown, Lock, Mail, ShieldAlert } from 'lucide-react';
import { useLoginMutation } from './api';
import { formatLoginError } from './formatLoginError';

export const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [login, { isLoading, error }] = useLoginMutation();

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await login({ email: email.trim(), password }).unwrap();
    } catch {
      // RTK Query keeps the error available for the inline message below.
    }
  };

  const errorMessage = error ? formatLoginError(error) : null;

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-4 py-8 sm:px-6 sm:py-12">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#312e81]/55 via-slate-950 to-slate-950" />
      <section aria-labelledby="login-heading" className="ui-enter relative w-full max-w-md rounded-3xl border border-white/10 bg-surface p-6 shadow-2xl shadow-black/25 sm:p-9">
        <header className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100">
            <Crown aria-hidden="true" className="h-7 w-7" />
          </div>
          <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-700">Thirumal Chess Academy</p>
          <h1 id="login-heading" className="mt-2 text-3xl font-bold tracking-tight text-heading">Welcome back</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">Sign in to manage your coaching sessions and availability.</p>
        </header>

        {errorMessage && (
          <div role="alert" aria-live="polite" className="mt-6 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <ShieldAlert aria-hidden="true" className="mt-0.5 h-5 w-5 flex-shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        <form className="mt-7 space-y-5" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="login-email" className="block text-sm font-semibold text-slate-800">Email address</label>
            <div className="relative mt-2">
              <Mail aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id="login-email"
                name="email"
                type="email"
                autoComplete="username"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                className="block min-h-12 w-full rounded-xl border border-slate-300 bg-surface py-3 pl-11 pr-3 text-base text-heading placeholder:text-slate-400 shadow-sm transition focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-500/15"
              />
            </div>
          </div>

          <div>
            <label htmlFor="login-password" className="block text-sm font-semibold text-slate-800">Password</label>
            <div className="relative mt-2">
              <Lock aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id="login-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="block min-h-12 w-full rounded-xl border border-slate-300 bg-surface py-3 pl-11 pr-3 text-base text-heading shadow-sm transition focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-500/15"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="flex min-h-12 w-full items-center justify-center rounded-xl bg-action px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-action-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700 disabled:cursor-wait disabled:opacity-60"
          >
            {isLoading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-600">
          Coach having trouble signing in?{' '}
          <a href="/forgot/coach" className="rounded font-semibold text-indigo-700 underline decoration-indigo-300 underline-offset-4 hover:text-indigo-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600">
            Reset your password
          </a>
        </p>
      </section>
    </main>
  );
};
