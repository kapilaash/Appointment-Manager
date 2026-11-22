import { Link } from 'react-router-dom';
import { ArrowRight, CalendarCheck2, Clock3, Plus, Users, XCircle } from 'lucide-react';
import { format } from 'date-fns';
import { useState } from 'react';
import { Card } from '../../components/ui/Card';
import { useAppointmentsQuery, useDashboardQuery } from '../appointments/api';
import { useNow } from '../../lib/useNow';
import type { User } from '../auth/api';

function Metric({
  label,
  value,
  caption,
  icon: Icon,
  tone = 'indigo',
}: {
  label: string;
  value?: number | undefined;
  caption: string;
  icon: typeof Users;
  tone?: 'indigo' | 'green' | 'amber' | 'rose';
}) {
  const styles = {
    indigo: 'bg-accent-50 text-accent-700',
    green: 'bg-success-50 text-success-700',
    amber: 'bg-warning-50 text-warning-700',
    rose: 'bg-danger-50 text-danger-700',
  };
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-neutral-500">{label}</p>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-heading">{value ?? '—'}</p>
        </div>
        <span className={`grid h-10 w-10 place-items-center rounded-xl ${styles[tone]}`}>
          <Icon size={19} />
        </span>
      </div>
      <p className="mt-3 text-xs text-neutral-500">{caption}</p>
    </Card>
  );
}

export function DashboardPage({ user }: { user: User }) {
  const summary = useDashboardQuery();
  const [upcomingWindow] = useState(() => ({
    start: new Date().toISOString(),
    end: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
  }));
  const appointments = useAppointmentsQuery(upcomingWindow);
  const now = useNow();
  const upcoming = (appointments.data ?? [])
    .filter((item) => item.status === 'confirmed' && new Date(item.starts_at).getTime() >= now)
    .slice(0, 5);
  const instructor = user.role === 'instructor';
  return (
    <div className="space-y-8">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm text-neutral-500">{format(new Date(), 'EEEE, MMMM d, yyyy')}</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-heading">
            {instructor ? 'Your coaching schedule' : 'Good morning, ready to plan?'}
          </h2>
          <p className="mt-1 text-sm text-neutral-500">
            {instructor ? 'Here’s what’s coming up with your students.' : 'Here’s what’s happening across the academy.'}
          </p>
        </div>
        {!instructor && (
          <Link
            to="/book"
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-on-accent shadow-sm transition hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600 sm:w-auto"
          >
            <Plus size={17} />
            Schedule a demo
          </Link>
        )}
      </div>
      {summary.isError && (
        <div role="alert" className="rounded-xl border border-danger-200 bg-danger-50 p-4 text-sm text-danger-800">
          Dashboard data could not be loaded. Check that the API and database are running, then refresh.
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {!instructor && (
          <Metric
            label="Instructors"
            value={summary.data?.total_instructors}
            caption="Active coaching team"
            icon={Users}
          />
        )}
        <Metric
          label="Today’s demos"
          value={summary.data?.today_appointments}
          caption="Classes scheduled for today"
          icon={CalendarCheck2}
          tone="green"
        />
        <Metric
          label="Coming up"
          value={summary.data?.upcoming_appointments}
          caption="Confirmed or being prepared"
          icon={Clock3}
        />
        <Metric
          label="Cancelled"
          value={summary.data?.cancelled_appointments}
          caption="Appointments cancelled"
          icon={XCircle}
          tone={summary.data?.cancelled_appointments ? 'rose' : 'green'}
        />
      </div>
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-4 sm:px-6">
          <div>
            <h3 className="font-semibold text-neutral-900">Upcoming demos</h3>
            <p className="mt-1 text-sm text-neutral-500">Your next scheduled sessions</p>
          </div>
          <Link
            to="/calendar"
            className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-accent-700 hover:bg-accent-50 hover:text-accent-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600"
          >
            View calendar <ArrowRight size={15} />
          </Link>
        </div>
        {appointments.isLoading ? (
          <div className="space-y-3 p-6">
            {[0, 1, 2].map((item) => (
              <div key={item} className="h-14 animate-pulse rounded-lg bg-neutral-100" />
            ))}
          </div>
        ) : upcoming.length ? (
          <div className="divide-y divide-neutral-100">
            {upcoming.map((item) => (
              <div
                key={item.id}
                className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
              >
                <div className="flex items-center gap-4">
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent-50 text-sm font-semibold leading-tight text-accent-700">
                    <span>
                      {format(new Date(item.starts_at), 'dd')}
                      <small className="block text-[9px] uppercase">{format(new Date(item.starts_at), 'MMM')}</small>
                    </span>
                  </div>
                  <div>
                    <p className="font-medium text-neutral-900">{item.student?.name ?? 'Deleted student'}</p>
                    <p className="mt-0.5 text-sm text-neutral-500">
                      {item.instructor_name} · {format(new Date(item.starts_at), 'EEE, h:mm a')}
                    </p>
                  </div>
                </div>
                <span className="w-fit rounded-full bg-success-50 px-2.5 py-1 text-xs font-medium text-success-700">
                  Confirmed
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-6 py-14 text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-neutral-100 text-neutral-500">
              <CalendarCheck2 size={21} />
            </div>
            <h4 className="mt-4 font-semibold text-neutral-900">No demos scheduled yet</h4>
            <p className="mt-1 text-sm text-neutral-500">When a demo is booked, it will appear here.</p>
            {!instructor && (
              <Link
                to="/book"
                className="mt-5 inline-flex min-h-11 items-center justify-center rounded-lg border border-neutral-300 bg-surface px-4 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600"
              >
                Book the first demo
              </Link>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
