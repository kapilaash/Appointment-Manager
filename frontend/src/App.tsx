import React from 'react';

export const App: React.FC = () => {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6 text-center">
      <div className="rounded-2xl bg-white p-8 shadow-xl ring-1 ring-slate-100 max-w-lg w-full">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 mb-6 text-3xl font-bold shadow-inner">
          ♞
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          Royal Chess Academy
        </h1>
        <p className="mt-3 text-sm text-slate-600">
          Demo Class Scheduling Engine & Multi-Instructor Availability Platform.
        </p>

        <div className="mt-6 rounded-lg bg-slate-50 p-4 border border-slate-200/80 text-left">
          <div className="flex items-center space-x-2">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-700">
              System Core Ready
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-500 leading-relaxed">
            FastAPI + PostgreSQL GiST ranges + ARQ background workers + React RTK Query pipeline initialized.
          </p>
        </div>
      </div>
    </div>
  );
};

export default App;
