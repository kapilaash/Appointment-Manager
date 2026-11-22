import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { CalendarDays, CalendarPlus, ChevronDown, CircleHelp, ClipboardCheck, LayoutDashboard, LogOut, Settings, Users, Clock3, Crown, GraduationCap, UserCircle } from 'lucide-react';
import { useLogoutMutation, useMeQuery } from '../../features/auth/api';
import { ThemeProvider } from '../../features/appearance/ThemeContext';
import { usePendingChangeRequestCountQuery } from '../../features/requests/api';
import { LoginPage } from '../../features/auth/LoginPage';
import { Button } from '../ui/Button';
import { MobileWorkspaceNav } from './MobileWorkspaceNav';

const adminLinks = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/book', label: 'Book a demo', icon: CalendarPlus },
  { to: '/requests', label: 'Approvals', icon: ClipboardCheck },
  { to: '/instructors', label: 'Instructors', icon: Users },
  { to: '/coaches', label: 'Coach accounts', icon: Users },
  { to: '/students', label: 'Students', icon: GraduationCap },
  { to: '/availability', label: 'Availability', icon: Clock3 },
  { to: '/profile', label: 'My profile', icon: UserCircle },
  { to: '/appointments', label: 'Appointments', icon: CalendarDays },
  { to: '/settings', label: 'Settings', icon: Settings },
  { to: '/help', label: 'Help & guides', icon: CircleHelp },
];
const instructorLinks = [
  { to: '/', label: 'My dashboard', icon: LayoutDashboard },
  { to: '/calendar', label: 'My classes', icon: CalendarDays },
  { to: '/appointments', label: 'Appointments', icon: CalendarDays },
  { to: '/availability', label: 'Availability', icon: Clock3 },
  { to: '/my-requests', label: 'My requests', icon: ClipboardCheck },
  { to: '/profile', label: 'My profile', icon: UserCircle },
  { to: '/settings', label: 'Settings', icon: Settings },
  { to: '/help', label: 'Help & guides', icon: CircleHelp },
];

export function App() {
  const auth = useMeQuery();
  const [logout] = useLogoutMutation();
  const [menuOpen, setMenuOpen] = useState(false);
  // Admins see how many coach requests await review; coaches see their own waiting requests.
  const pendingCount = usePendingChangeRequestCountQuery(undefined, { skip: !auth.data, pollingInterval: 60_000, skipPollingIfUnfocused: true, refetchOnFocus: true }).data?.pending ?? 0;
  const location = useLocation();
  const navigate = useNavigate();

  async function signOut() {
    setMenuOpen(false);
    try {
      await logout().unwrap();
    } catch {
      // The logout mutation clears the client cache even if the request fails.
    } finally {
      navigate('/', { replace: true });
    }
  }

  if (auth.isLoading) return <div className="grid min-h-screen place-items-center text-sm text-slate-500">Loading your workspace…</div>;
  if (!auth.data) {
    const errorStatus = auth.error && typeof auth.error === 'object' && 'status' in auth.error
      ? auth.error.status
      : undefined;
    if (!auth.isError || errorStatus === 401 || errorStatus === 403) return <LoginPage />;
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 px-4">
        <section role="alert" className="w-full max-w-md rounded-2xl border border-slate-200 bg-surface p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-heading">Workspace temporarily unavailable</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">We couldn’t connect to the academy service. Check your connection, then retry. Your sign-in details are still safe.</p>
          <Button className="mt-5 w-full sm:w-auto" onClick={() => void auth.refetch()} disabled={auth.isFetching}>
            {auth.isFetching ? 'Reconnecting…' : 'Retry connection'}
          </Button>
        </section>
      </main>
    );
  }

  const requestsPath = auth.data.role === 'admin' ? '/requests' : '/my-requests';
  const links = (auth.data.role === 'admin' ? adminLinks : instructorLinks)
    .map((link) => ({ ...link, badge: link.to === requestsPath ? pendingCount : 0 }));
  const title = links.find((link) => link.to === location.pathname)?.label ?? 'Workspace';
  return (
    <ThemeProvider userId={auth.data.id} savedPreference={auth.data.theme_preference}>
    <div className="theme-canvas min-h-screen bg-slate-50">
      <a href="#main-content" className="sr-only z-50 rounded-md bg-surface p-3 text-indigo-700 focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:shadow-lg">Skip to main content</a>
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col overflow-y-auto border-r border-slate-200 bg-surface lg:flex">
        <Link to="/" className="flex h-[76px] items-center gap-3 border-b border-slate-100 px-6"><span className="theme-brand-mark grid h-10 w-10 place-items-center rounded-xl bg-action text-white"><Crown size={19} /></span><span className="text-sm font-semibold leading-tight text-slate-900">Thirumal Chess<br />Academy</span></Link>
        <div className="px-4 pt-7"><p className="px-3 text-[11px] font-semibold uppercase tracking-[.15em] text-slate-400">Workspace</p><nav aria-label="Workspace pages" className="mt-3 space-y-1">{links.map(({ to, label, icon: Icon, badge }) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ${isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}><Icon size={18} strokeWidth={1.8} />{label}{badge > 0 && <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900" aria-label={`${badge} waiting`}>{badge}</span>}</NavLink>)}</nav></div>
        <div className="mt-auto p-4"><div className="rounded-xl bg-slate-50 p-4"><div className="flex items-center gap-2 text-sm font-medium text-slate-800"><CircleHelp size={17} className="text-indigo-600" />Need a hand?</div><p className="mt-1 text-xs leading-5 text-slate-500">Contact your academy administrator for workspace access.</p></div></div>
      </aside>
      <div className="lg:pl-64">
        <header className="sticky top-0 z-10 flex h-[76px] items-center justify-between border-b border-slate-200 bg-surface/95 px-5 backdrop-blur sm:px-8">
          <div><p className="text-xs text-slate-400">Academy workspace</p><h1 className="mt-0.5 text-lg font-semibold text-slate-900">{title}</h1></div>
          <div className="relative flex items-center gap-3">
            <div className="hidden text-right sm:block"><p className="text-sm font-medium text-slate-800">{auth.data.email}</p><p className="text-xs capitalize text-slate-500">{auth.data.role}</p></div>
            <button type="button" onClick={() => setMenuOpen(!menuOpen)} className="relative grid h-11 w-11 place-items-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-700" aria-label="Account menu" aria-haspopup="true" aria-expanded={menuOpen} aria-controls="account-menu"><span aria-hidden="true">{auth.data.email.slice(0, 1).toUpperCase()}</span><ChevronDown size={14} className="absolute -bottom-0.5 -right-0.5 rounded-full bg-surface p-0.5" /></button>
            {menuOpen && <div id="account-menu" role="group" aria-label="Account actions" className="absolute right-0 top-12 z-30 rounded-xl border border-slate-200 bg-surface p-2 shadow-lg"><Button variant="ghost" onClick={() => void signOut()}><LogOut size={16} />Sign out</Button></div>}
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="mx-auto max-w-[1440px] px-4 pt-7 pb-28 outline-none sm:px-8 sm:pt-9 lg:pb-9"><div key={location.pathname} className="page-enter"><Outlet /></div></main>
      </div>
      <MobileWorkspaceNav links={links} />
    </div>
    </ThemeProvider>
  );
}
