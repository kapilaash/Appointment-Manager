import { Link } from 'react-router-dom';
import { ArrowRight, Users } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { useInstructorsQuery } from './api';

export function InstructorsPage() {
  const query = useInstructorsQuery();

  return (
    <div className="space-y-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-heading">Your coaches</h2>
          <p className="mt-1 text-sm text-slate-500">Review coach profiles and booking availability.</p>
        </div>
        <Link
          to="/coaches"
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-surface px-4 py-2.5 text-sm font-semibold text-slate-700 ring-1 ring-inset ring-slate-300 transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 sm:w-auto"
        >
          Manage coach accounts <ArrowRight size={16} />
        </Link>
      </header>

      {query.isError && (
        <p role="alert" className="rounded-lg bg-rose-50 p-4 text-sm text-rose-700">
          Could not load coach profiles.
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {query.data?.map((coach) => (
          <Card key={coach.id} className="p-5">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-indigo-50 text-indigo-700">
              <Users size={20} />
            </span>
            <h3 className="mt-4 font-semibold text-slate-900">{coach.display_name}</h3>
            <p className="mt-1 text-sm text-slate-500">{coach.email}</p>
            <p className="mt-3 text-xs text-slate-400">{coach.timezone}</p>
            <p
              className={`mt-3 text-xs font-medium ${coach.is_available_for_booking ? 'text-emerald-700' : 'text-slate-500'}`}
            >
              {coach.is_available_for_booking ? 'Available for bookings' : 'Not available for bookings'}
            </p>
          </Card>
        ))}
      </div>
      {!query.isLoading && !query.isError && !query.data?.length && (
        <Card className="px-6 py-14 text-center">
          <Users className="mx-auto text-slate-400" />
          <p className="mt-3 font-medium">No coaches yet</p>
          <p className="mt-1 text-sm text-slate-500">Invite a coach to create the first profile.</p>
        </Card>
      )}
    </div>
  );
}
