import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  CalendarDays,
  CalendarPlus,
  ChevronDown,
  CircleHelp,
  ClipboardCheck,
  Clock3,
  Crown,
  GraduationCap,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  Palette,
  Settings,
  UserCircle,
  Users,
} from 'lucide-react';
import { useLogoutMutation, useMeQuery } from '../../features/auth/api';
import { ThemeProvider } from '../../features/appearance/ThemeContext';
import { LoginPage } from '../../features/auth/LoginPage';
import { usePendingChangeRequestCountQuery } from '../../features/requests/api';
import { cn } from '../../lib/cn';
import { Button } from '../ui/Button';
import { PageSkeleton } from '../ui/Skeleton';
import { ToastProvider } from '../ui/Toast';
import { MobileWorkspaceNav } from './MobileWorkspaceNav';
import { OfflineBanner } from './OfflineBanner';

const adminLinks = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/book', label: 'Book a demo', icon: CalendarPlus },
  { to: '/requests', label: 'Approvals', icon: ClipboardCheck },
  { to: '/instructors', label: 'Instructors', icon: Users },
  { to: '/coaches', label: 'Coach accounts', icon: Users },
  { to: '/students', label: 'Students', icon: GraduationCap },
  { to: '/team', label: 'Team availability', icon: LayoutGrid },
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

/** The header title for the current page; nested paths use their closest section. */
function pageTitle(pathname: string, links: { to: string; label: string }[]) {
  const match = links
    .filter((link) => (link.to === '/' ? pathname === '/' : pathname === link.to || pathname.startsWith(`${link.to}/`)))
    .sort((a, b) => b.to.length - a.to.length)[0];
  return match?.label ?? 'Workspace';
}

function initials(name: string | undefined, email: string) {
  const source = name?.trim() || email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[1]?.[0] ?? '') : '')).toUpperCase() || '?';
}

function AccountMenu({
  name,
  email,
  role,
  onSignOut,
}: {
  name: string | undefined;
  email: string;
  role: string;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Close when clicking elsewhere or pressing Escape (focus returns to the trigger).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    containerRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!open) return;
    const items = Array.from(containerRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    }
  }

  const itemClass =
    'flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm font-medium text-neutral-700 transition hover:bg-neutral-100 hover:text-neutral-900 focus:bg-neutral-100 focus:outline-none';
  return (
    <div ref={containerRef} className="relative" onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(!open)}
        className="relative grid h-11 w-11 place-items-center rounded-full bg-accent-100 text-sm font-semibold text-accent-700 ring-offset-2 ring-offset-surface transition hover:ring-2 hover:ring-accent-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
        // Starts with the visible initials so voice-control users can say what they see (WCAG 2.5.3).
        aria-label={`${initials(name, email)}, account menu`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="account-menu"
      >
        <span>{initials(name, email)}</span>
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={cn(
            'absolute -bottom-0.5 -right-0.5 rounded-full bg-surface p-0.5 transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </button>
      {open && (
        <div
          id="account-menu"
          role="menu"
          aria-label="Account"
          className="ui-enter absolute right-0 top-[3.25rem] z-30 w-64 rounded-xl border border-neutral-200 bg-surface p-1.5 shadow-lifted"
        >
          <div className="border-b border-neutral-100 px-3 pb-2.5 pt-2">
            <p className="truncate text-sm font-semibold text-neutral-900">{name || email}</p>
            <p className="truncate text-xs text-neutral-500">
              {email} · <span className="capitalize">{role === 'instructor' ? 'coach' : role}</span>
            </p>
          </div>
          <div className="pt-1.5">
            <Link role="menuitem" to="/profile" onClick={() => setOpen(false)} className={itemClass}>
              <UserCircle size={16} aria-hidden="true" />
              My profile
            </Link>
            <Link role="menuitem" to="/profile#security" onClick={() => setOpen(false)} className={itemClass}>
              <KeyRound size={16} aria-hidden="true" />
              Password & security
            </Link>
            <Link role="menuitem" to="/settings" onClick={() => setOpen(false)} className={itemClass}>
              <Palette size={16} aria-hidden="true" />
              Appearance & settings
            </Link>
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                onSignOut();
              }}
              className={cn(itemClass, 'text-danger-700 hover:bg-danger-50 hover:text-danger-800 focus:bg-danger-50')}
            >
              <LogOut size={16} aria-hidden="true" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function App() {
  const auth = useMeQuery();
  const [logout] = useLogoutMutation();
  // Admins see how many coach requests await review; coaches see their own waiting requests.
  const pendingCount =
    usePendingChangeRequestCountQuery(undefined, {
      skip: !auth.data,
      pollingInterval: 60_000,
      skipPollingIfUnfocused: true,
      refetchOnFocus: true,
    }).data?.pending ?? 0;
  const location = useLocation();
  const navigate = useNavigate();

  async function signOut() {
    try {
      await logout().unwrap();
    } catch {
      // The logout mutation clears the client cache even if the request fails.
    } finally {
      navigate('/', { replace: true });
    }
  }

  if (auth.isLoading)
    return (
      <div role="status" aria-label="Loading your workspace" className="min-h-screen bg-neutral-50 p-6 lg:pl-72">
        <PageSkeleton />
      </div>
    );
  if (!auth.data) {
    const errorStatus =
      auth.error && typeof auth.error === 'object' && 'status' in auth.error ? auth.error.status : undefined;
    if (!auth.isError || errorStatus === 401 || errorStatus === 403) return <LoginPage />;
    return (
      <main className="grid min-h-screen place-items-center bg-neutral-50 px-4">
        <section
          role="alert"
          className="w-full max-w-md rounded-2xl border border-neutral-200 bg-surface p-6 text-center shadow-sm"
        >
          <h1 className="text-lg font-semibold text-heading">Workspace temporarily unavailable</h1>
          <p className="mt-2 text-sm leading-6 text-neutral-600">
            We couldn’t connect to the academy service. Check your connection, then retry. Your sign-in details are
            still safe.
          </p>
          <Button className="mt-5 w-full sm:w-auto" onClick={() => void auth.refetch()} disabled={auth.isFetching}>
            {auth.isFetching ? 'Reconnecting…' : 'Retry connection'}
          </Button>
        </section>
      </main>
    );
  }

  const user = auth.data;
  const requestsPath = user.role === 'admin' ? '/requests' : '/my-requests';
  const links = (user.role === 'admin' ? adminLinks : instructorLinks).map((link) => ({
    ...link,
    badge: link.to === requestsPath ? pendingCount : 0,
  }));
  const title = pageTitle(location.pathname, links);

  return (
    <ThemeProvider userId={user.id} savedPreference={user.theme_preference} savedAt={auth.startedTimeStamp}>
      <ToastProvider>
        <div className="theme-canvas min-h-screen bg-neutral-50">
          <OfflineBanner />
          <a
            href="#main-content"
            className="sr-only z-50 rounded-md bg-surface p-3 text-accent-700 focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:shadow-lg"
          >
            Skip to main content
          </a>
          <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col overflow-y-auto border-r border-neutral-200 bg-surface lg:flex">
            <Link to="/" className="flex h-[76px] items-center gap-3 border-b border-neutral-100 px-6">
              <span className="theme-brand-mark grid h-10 w-10 place-items-center rounded-xl bg-accent text-on-accent shadow-sm">
                <Crown size={19} />
              </span>
              <span className="text-sm font-semibold leading-tight text-neutral-900">
                Thirumal Chess
                <br />
                Academy
              </span>
            </Link>
            <div className="px-4 pt-7">
              <p className="px-3 text-[11px] font-semibold uppercase tracking-[.15em] text-neutral-500">Workspace</p>
              <nav aria-label="Workspace pages" className="mt-3 space-y-1">
                {links.map(({ to, label, icon: Icon, badge }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === '/'}
                    className={({ isActive }) =>
                      cn(
                        'group relative flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600',
                        isActive
                          ? 'bg-accent-50 text-accent-700'
                          : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <span
                          aria-hidden="true"
                          className={cn(
                            'absolute inset-y-2 left-0 w-1 rounded-full bg-accent transition-all duration-300',
                            isActive ? 'opacity-100' : 'scale-y-0 opacity-0',
                          )}
                        />
                        <Icon
                          size={18}
                          strokeWidth={1.8}
                          className="transition-transform duration-150 group-hover:scale-110 motion-reduce:transform-none"
                        />
                        {label}
                        {badge > 0 && (
                          <span
                            className="ml-auto rounded-full bg-warning-100 px-2 py-0.5 text-[11px] font-semibold text-warning-900"
                            aria-label={`${badge} waiting`}
                          >
                            {badge}
                          </span>
                        )}
                      </>
                    )}
                  </NavLink>
                ))}
              </nav>
            </div>
            <div className="mt-auto p-4">
              <div className="rounded-xl bg-neutral-50 p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-neutral-800">
                  <CircleHelp size={17} className="text-accent-600" />
                  Need a hand?
                </div>
                <p className="mt-1 text-xs leading-5 text-neutral-500">
                  Step-by-step{' '}
                  <Link to="/help" className="font-medium text-accent-700 underline-offset-2 hover:underline">
                    workflow guides
                  </Link>{' '}
                  are always one click away.
                </p>
              </div>
            </div>
          </aside>
          <div className="lg:pl-64">
            <header className="sticky top-0 z-10 flex h-[76px] items-center justify-between border-b border-neutral-200 bg-surface/90 px-5 backdrop-blur-md sm:px-8">
              <div>
                <p className="text-xs text-neutral-500">Academy workspace</p>
                <h1 className="mt-0.5 text-lg font-semibold text-neutral-900">{title}</h1>
              </div>
              <div className="flex items-center gap-3">
                <div className="hidden text-right sm:block">
                  <p className="text-sm font-medium text-neutral-800">{user.full_name || user.email}</p>
                  <p className="text-xs capitalize text-neutral-500">
                    {user.role === 'instructor' ? 'Coach' : user.role}
                  </p>
                </div>
                <AccountMenu
                  name={user.full_name}
                  email={user.email}
                  role={user.role}
                  onSignOut={() => void signOut()}
                />
              </div>
            </header>
            <main
              id="main-content"
              tabIndex={-1}
              className="mx-auto max-w-[1440px] px-4 pb-28 pt-7 outline-none sm:px-8 sm:pt-9 lg:pb-9"
            >
              <div key={location.pathname} className="page-enter">
                <Outlet />
              </div>
            </main>
          </div>
          <MobileWorkspaceNav links={links} />
        </div>
      </ToastProvider>
    </ThemeProvider>
  );
}
