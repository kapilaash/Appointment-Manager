import { useRef, useState, type KeyboardEvent } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { MoreHorizontal, X, type LucideIcon } from 'lucide-react';
import { useSwipeToDismiss } from '../ui/useSwipeToDismiss';

type WorkspaceLink = { to: string; label: string; icon: LucideIcon; badge?: number };

const primaryPaths = ['/', '/calendar', '/appointments', '/availability'];
const shortLabels: Record<string, string> = {
  '/': 'Home',
  '/calendar': 'Calendar',
  '/appointments': 'Appointments',
  '/availability': 'Availability',
};

export function MobileWorkspaceNav({ links }: { links: WorkspaceLink[] }) {
  const location = useLocation();
  const [openForPath, setOpenForPath] = useState<string | null>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const primaryLinks = primaryPaths
    .map((path) => links.find((link) => link.to === path))
    .filter((link): link is WorkspaceLink => Boolean(link));
  const moreLinks = links.filter((link) => !primaryPaths.includes(link.to));
  const menuOpen = openForPath === location.pathname;
  const { handleProps, sheetStyle } = useSwipeToDismiss(() => setOpenForPath(null), menuOpen);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && menuOpen) {
      setOpenForPath(null);
      moreButtonRef.current?.focus();
    }
  }

  return (
    <div className="lg:hidden" onKeyDown={handleKeyDown}>
      {menuOpen && (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-30 bg-ink/25 backdrop-blur-[2px]"
          onClick={() => setOpenForPath(null)}
        />
      )}
      <nav
        id="mobile-more-menu"
        aria-label="More workspace pages"
        hidden={!menuOpen}
        style={sheetStyle}
        className={`${menuOpen ? 'mobile-sheet-enter' : ''} fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 mx-auto max-h-[70dvh] max-w-xl overflow-y-auto rounded-[1.75rem] border border-neutral-200 bg-surface p-4 shadow-2xl`}
      >
        <div
          {...handleProps}
          aria-hidden="true"
          className="-mx-4 -mt-2 mb-1 flex cursor-grab justify-center py-2 active:cursor-grabbing"
        >
          <span className="h-1.5 w-10 rounded-full bg-neutral-300" />
        </div>
        <div className="mb-3 flex items-center justify-between px-1">
          <div>
            <p className="text-sm font-semibold text-heading">More</p>
            <p className="mt-0.5 text-xs text-neutral-500">Workspace tools and settings</p>
          </div>
          <button
            type="button"
            aria-label="Close more navigation"
            className="grid h-10 w-10 place-items-center rounded-full text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            onClick={() => setOpenForPath(null)}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {moreLinks.map(({ to, label, icon: Icon, badge = 0 }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setOpenForPath(null)}
              className={({ isActive }) =>
                `group flex min-h-20 flex-col items-start justify-between rounded-2xl border p-3 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${isActive ? 'border-accent/30 bg-accent-50 text-accent' : 'border-neutral-200/80 bg-surface text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50'}`
              }
            >
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-neutral-100 text-neutral-700 transition group-hover:bg-white">
                <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
              </span>
              <span className="mt-2 flex w-full items-center justify-between gap-1 text-xs font-semibold leading-tight">
                {label}
                {badge > 0 && (
                  <span
                    className="rounded-full bg-warning-100 px-1.5 py-0.5 text-[10px] text-warning-900"
                    aria-label={`${badge} waiting`}
                  >
                    {badge}
                  </span>
                )}
              </span>
            </NavLink>
          ))}
        </div>
      </nav>

      <nav
        aria-label="Primary mobile navigation"
        className="fixed inset-x-0 bottom-0 z-50 border-t border-neutral-200/80 bg-surface/95 px-1 pb-[env(safe-area-inset-bottom)] pt-1.5 shadow-[0_-8px_28px_rgba(15,23,42,0.08)] backdrop-blur-xl"
      >
        <div className="mx-auto grid max-w-xl grid-cols-5">
          {primaryLinks.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              aria-label={label}
              className={({ isActive }) =>
                `flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-0.5 text-[0.65rem] font-semibold leading-none transition focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent ${isActive ? 'text-accent' : 'text-neutral-500 hover:text-neutral-800'}`
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={`grid h-7 w-10 place-items-center rounded-full transition ${isActive ? 'bg-accent-50' : ''}`}
                  >
                    <Icon size={20} strokeWidth={isActive ? 2.2 : 1.8} aria-hidden="true" />
                  </span>
                  <span className="max-w-full truncate">{shortLabels[to] ?? label}</span>
                </>
              )}
            </NavLink>
          ))}
          <button
            ref={moreButtonRef}
            type="button"
            aria-label="More workspace pages"
            aria-expanded={menuOpen}
            aria-controls="mobile-more-menu"
            className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-0.5 text-[0.65rem] font-semibold leading-none transition focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent ${menuOpen || moreLinks.some((link) => link.to === location.pathname) ? 'text-accent' : 'text-neutral-500 hover:text-neutral-800'}`}
            onClick={() => setOpenForPath(menuOpen ? null : location.pathname)}
          >
            <span
              className={`grid h-7 w-10 place-items-center rounded-full transition ${menuOpen ? 'bg-accent-50' : ''}`}
            >
              {menuOpen ? <X size={20} aria-hidden="true" /> : <MoreHorizontal size={20} aria-hidden="true" />}
              {!menuOpen && moreLinks.some((link) => (link.badge ?? 0) > 0) && (
                <span className="absolute -mt-5 ml-6 h-2 w-2 rounded-full bg-warning-500" aria-hidden="true" />
              )}
            </span>
            <span>More</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
