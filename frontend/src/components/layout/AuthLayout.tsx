import type { ReactNode } from 'react';
import { Crown } from 'lucide-react';

/** Shared frame for sign-in, forgot-password and reset-password screens. */
export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-4 py-8 sm:px-6 sm:py-12">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#312e81]/55 via-slate-950 to-slate-950" />
      <section aria-labelledby="auth-heading" className="ui-enter relative w-full max-w-md rounded-3xl border border-white/10 bg-surface p-6 shadow-2xl shadow-black/25 sm:p-9">
        <header className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100">
            <Crown aria-hidden="true" className="h-7 w-7" />
          </div>
          <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-700">Thirumal Chess Academy</p>
          <h1 id="auth-heading" className="mt-2 text-3xl font-bold tracking-tight text-heading">{title}</h1>
          {subtitle && <p className="mt-2 text-sm leading-6 text-slate-600">{subtitle}</p>}
        </header>
        {children}
        {footer && <div className="mt-6 text-center text-sm text-slate-600">{footer}</div>}
      </section>
    </main>
  );
}
