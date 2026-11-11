import React from 'react';
import { useGetMeQuery, useLogoutMutation } from '@/features/auth/authApi';
import { LoginPage } from '@/features/auth/LoginPage';
import { CheckCircle2, Clock, LogOut, ShieldCheck, User as UserIcon } from 'lucide-react';

export const App: React.FC = () => {
  const { data: user, isLoading } = useGetMeQuery();
  const [logout, { isLoading: isLoggingOut }] = useLogoutMutation();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="flex items-center space-x-3 text-slate-500">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-600 border-t-transparent"></div>
          <span className="text-sm font-medium">Validating session...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* App Navigation Bar */}
      <nav className="border-b border-slate-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center space-x-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-xl font-bold text-brand-600 shadow-inner">
              ♞
            </span>
            <div>
              <h1 className="text-base font-bold text-slate-900 leading-tight">Royal Chess Academy</h1>
              <p className="text-xs text-slate-500">Scheduling & Availability System</p>
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <div className="hidden sm:flex items-center space-x-2 text-right">
              <div>
                <div className="text-xs font-semibold text-slate-800">{user.full_name}</div>
                <div className="text-[11px] uppercase tracking-wider text-brand-600 font-bold">{user.role}</div>
              </div>
            </div>
            <button
              onClick={() => logout()}
              disabled={isLoggingOut}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </nav>

      {/* Main Container */}
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200/80">
          <div className="flex items-center justify-between border-b border-slate-100 pb-5">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Session Authenticated</h2>
              <p className="text-sm text-slate-500">
                You are securely signed in with an Argon2id verified session cookie.
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Active Session
            </span>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-xl border border-slate-200 p-5 bg-slate-50/50">
              <div className="flex items-center gap-3 text-slate-700 mb-2">
                <UserIcon className="h-5 w-5 text-brand-600" />
                <h3 className="text-sm font-semibold">User Identity</h3>
              </div>
              <p className="text-xs text-slate-600">{user.full_name}</p>
              <p className="text-xs text-slate-400 font-mono mt-1">{user.email}</p>
            </div>

            <div className="rounded-xl border border-slate-200 p-5 bg-slate-50/50">
              <div className="flex items-center gap-3 text-slate-700 mb-2">
                <ShieldCheck className="h-5 w-5 text-emerald-600" />
                <h3 className="text-sm font-semibold">Security Role</h3>
              </div>
              <p className="text-xs text-slate-600 font-medium capitalize">{user.role}</p>
              <p className="text-xs text-slate-400 mt-1">Full access RBAC policy active</p>
            </div>

            <div className="rounded-xl border border-slate-200 p-5 bg-slate-50/50">
              <div className="flex items-center gap-3 text-slate-700 mb-2">
                <Clock className="h-5 w-5 text-amber-600" />
                <h3 className="text-sm font-semibold">Assigned Timezone</h3>
              </div>
              <p className="text-xs text-slate-600 font-medium">
                {user.instructor_profile?.timezone || 'Asia/Kolkata (Academy Default)'}
              </p>
              <p className="text-xs text-slate-400 mt-1">Used for recurring availability parsing</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;
