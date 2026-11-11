import React, { useState } from 'react';
import { useLoginMutation } from './authApi';
import { Lock, Mail, ShieldAlert } from 'lucide-react';

export const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [login, { isLoading, error }] = useLoginMutation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login({ email, password }).unwrap();
    } catch {
      // RTK Query tracks the error in state
    }
  };

  const errorMessage =
    error && 'data' in error
      ? (error.data as { detail?: string })?.detail || 'Login failed. Please check your credentials.'
      : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8 rounded-2xl bg-white p-8 shadow-xl ring-1 ring-slate-100">
        <div>
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-50 text-3xl shadow-inner">
            ♞
          </div>
          <h2 className="mt-6 text-center text-3xl font-extrabold tracking-tight text-slate-900">
            Sign In
          </h2>
          <p className="mt-2 text-center text-sm text-slate-600">
            Royal Chess Academy Demo Scheduling Portal
          </p>
        </div>

        {errorMessage && (
          <div className="flex items-center gap-2 rounded-lg bg-red-50 p-4 text-sm text-red-700 border border-red-200">
            <ShieldAlert className="h-5 w-5 flex-shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
          <div>
            <label className="block text-sm font-medium text-slate-700">Email Address</label>
            <div className="relative mt-1">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                <Mail className="h-4 w-4 text-slate-400" />
              </div>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@chessacademy.com"
                className="block w-full rounded-lg border border-slate-300 py-2.5 pl-10 pr-3 text-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">Password</label>
            <div className="relative mt-1">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                <Lock className="h-4 w-4 text-slate-400" />
              </div>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="block w-full rounded-lg border border-slate-300 py-2.5 pl-10 pr-3 text-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="flex w-full justify-center rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-50 transition-colors"
          >
            {isLoading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div className="rounded-lg bg-slate-50 p-4 text-xs text-slate-500 border border-slate-200">
          <p className="font-semibold text-slate-700 mb-1">Testing or First Boot?</p>
          <p>
            Seed the super administrator account via the backend CLI:
          </p>
          <code className="mt-1.5 block rounded bg-slate-200/70 p-2 font-mono text-[11px] text-slate-800 break-all select-all">
            python -m app.cli seed-admin --email admin@chessacademy.com
          </code>
        </div>
      </div>
    </div>
  );
};
