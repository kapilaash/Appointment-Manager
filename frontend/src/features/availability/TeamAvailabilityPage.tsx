import { useMemo, useState } from 'react';
import { addDays, format, parseISO } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { getCountryCode } from '@vvo/tzdb';
import { ChevronLeft, ChevronRight, Hourglass, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../app/store/api';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Skeleton } from '../../components/ui/Skeleton';
import { TimeZoneSelect } from '../../components/ui/TimeZoneSelect';
import { useNow } from '../../lib/useNow';

type Span = { start: string; end: string };
type CoachDay = {
  id: string;
  display_name: string;
  timezone: string;
  free: Span[];
  booked: (Span & { id: string; student_name: string })[];
  pending_requests: number;
};
type TeamDay = { day: string; timezone: string; start: string; end: string; coaches: CoachDay[] };

const teamApi = api.injectEndpoints({
  endpoints: (build) => ({
    teamAvailability: build.query<TeamDay, { day: string; timezone: string }>({
      query: (params) => ({ url: '/availability/overview', params }),
      providesTags: ['Availability', 'Appointment', 'ChangeRequests'],
    }),
  }),
});

const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

function hoursBetween(spans: Span[]) {
  const ms = spans.reduce((total, span) => total + (Date.parse(span.end) - Date.parse(span.start)), 0);
  return Math.round((ms / 3_600_000) * 10) / 10;
}

/**
 * Every bookable coach's day on one timeline, shown in a time zone the admin picks
 * (usually the client's), so a client's preferred time can be matched in one glance.
 */
export function TeamAvailabilityPage() {
  const [day, setDay] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [timezone, setTimezone] = useState(deviceZone);
  const [countryCode, setCountryCode] = useState(() => getCountryCode(deviceZone) ?? '');
  const overview = teamApi.useTeamAvailabilityQuery({ day, timezone }, { skip: !timezone, refetchOnFocus: true });
  const data = overview.currentData;
  const now = useNow();

  const scale = useMemo(() => {
    if (!data) return null;
    const start = Date.parse(data.start);
    const span = Date.parse(data.end) - start;
    const position = (iso: string) => Math.min(100, Math.max(0, ((Date.parse(iso) - start) / span) * 100));
    const ticks = Array.from({ length: 9 }, (_, index) => {
      const at = new Date(start + (span * index) / 8);
      return { left: (index / 8) * 100, label: formatInTimeZone(at, data.timezone, 'h a') };
    });
    const nowLeft = now >= start && now <= start + span ? ((now - start) / span) * 100 : null;
    return { position, ticks, nowLeft };
  }, [data, now]);

  const shiftDay = (delta: number) => setDay((current) => format(addDays(parseISO(current), delta), 'yyyy-MM-dd'));
  const time = (iso: string) => formatInTimeZone(new Date(iso), timezone, 'h:mm a');

  return (
    <div className="space-y-6">
      <header className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-heading">Team availability</h2>
          <p className="mt-1 max-w-2xl text-sm text-neutral-500">
            Every coach&apos;s free and booked time for one day, shown in the time zone you choose. Pick the
            client&apos;s time zone to match their preferred time, then select a free block to book it.
          </p>
        </div>
      </header>

      <Card className="grid gap-4 p-5 sm:p-6 lg:grid-cols-[auto_1fr] lg:items-end">
        <div>
          <span className="block text-sm font-medium text-neutral-700">Day</span>
          <div className="mt-1 flex items-center gap-2">
            <Button variant="secondary" aria-label="Previous day" className="px-3" onClick={() => shiftDay(-1)}>
              <ChevronLeft size={16} />
            </Button>
            <input
              aria-label="Day to show"
              type="date"
              value={day}
              onChange={(event) => event.target.value && setDay(event.target.value)}
              className="rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            />
            <Button variant="secondary" aria-label="Next day" className="px-3" onClick={() => shiftDay(1)}>
              <ChevronRight size={16} />
            </Button>
          </div>
        </div>
        <div>
          <TimeZoneSelect
            countryCode={countryCode}
            timezone={timezone}
            onCountryCodeChange={setCountryCode}
            onTimezoneChange={setTimezone}
            countryLabel="Show times for country"
            timezoneLabel="Time zone (e.g. the client's)"
          />
          {timezone !== deviceZone && (
            <button
              type="button"
              onClick={() => {
                setTimezone(deviceZone);
                setCountryCode(getCountryCode(deviceZone) ?? '');
              }}
              className="mt-2 text-xs font-semibold text-accent-700 hover:underline"
            >
              Use my time zone ({deviceZone})
            </button>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 px-5 py-4 sm:px-6">
          <h3 className="font-semibold text-neutral-900">
            {format(parseISO(day), 'EEEE, MMMM d, yyyy')}{' '}
            <span className="font-normal text-neutral-500">· {timezone}</span>
          </h3>
          <div className="flex items-center gap-4 text-xs text-neutral-600">
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm bg-success-100 ring-1 ring-inset ring-success-600/40" />
              Free
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm bg-accent" />
              Booked
            </span>
          </div>
        </div>

        {overview.isLoading || (overview.isFetching && !data) ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2, 3].map((item) => (
              <Skeleton key={item} className="h-12" />
            ))}
          </div>
        ) : overview.isError ? (
          <div role="alert" className="p-6 text-sm text-danger-700">
            Team availability could not be loaded.{' '}
            <Button variant="secondary" className="ml-2" onClick={() => void overview.refetch()}>
              Retry
            </Button>
          </div>
        ) : !data?.coaches.length ? (
          <div className="grid place-items-center gap-2 p-12 text-center">
            <Users size={28} className="text-neutral-300" aria-hidden="true" />
            <p className="font-medium text-neutral-700">No coaches are open for booking</p>
          </div>
        ) : (
          scale && (
            <div className={overview.isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
              <div className="overflow-x-auto">
                <div className="min-w-[760px]">
                  <div className="grid grid-cols-[13rem_1fr] border-b border-neutral-100 px-5 py-2 text-[11px] font-medium text-neutral-500 sm:px-6">
                    <span>Coach</span>
                    <div className="relative h-4">
                      {scale.ticks.map((tick) => (
                        <span
                          key={tick.left}
                          className="absolute -translate-x-1/2 tabular-nums first:translate-x-0 last:-translate-x-full"
                          style={{ left: `${tick.left}%` }}
                        >
                          {tick.label}
                        </span>
                      ))}
                    </div>
                  </div>
                  <ul>
                    {data.coaches.map((coach) => (
                      <li
                        key={coach.id}
                        className="grid grid-cols-[13rem_1fr] items-center gap-0 border-b border-neutral-100 px-5 py-3 last:border-0 sm:px-6"
                      >
                        <div className="min-w-0 pr-3">
                          <p className="truncate text-sm font-medium text-neutral-900">{coach.display_name}</p>
                          <p className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
                            <span>{hoursBetween(coach.free)} h free</span>
                            {coach.pending_requests > 0 && (
                              <Link
                                to="/requests"
                                className="inline-flex items-center gap-0.5 rounded-full bg-warning-50 px-1.5 text-warning-900 hover:underline"
                              >
                                <Hourglass size={10} aria-hidden="true" />
                                {coach.pending_requests} pending
                              </Link>
                            )}
                          </p>
                        </div>
                        <div className="relative h-10 rounded-lg bg-neutral-50 ring-1 ring-inset ring-neutral-100">
                          {scale.ticks.slice(1, -1).map((tick) => (
                            <span
                              key={tick.left}
                              aria-hidden="true"
                              className="absolute inset-y-0 w-px bg-neutral-200/70"
                              style={{ left: `${tick.left}%` }}
                            />
                          ))}
                          {coach.free.map((span) => {
                            const coachDate = formatInTimeZone(new Date(span.start), coach.timezone, 'yyyy-MM-dd');
                            const label = `${coach.display_name} free ${time(span.start)} – ${time(span.end)}`;
                            const style = {
                              left: `${scale.position(span.start)}%`,
                              width: `${Math.max(0.6, scale.position(span.end) - scale.position(span.start))}%`,
                            };
                            // Time that has already passed cannot be booked, so show it faded and inert.
                            if (Date.parse(span.end) <= now) {
                              return (
                                <span
                                  key={span.start}
                                  title={`${label} (past)`}
                                  className="absolute inset-y-1 rounded-md bg-success-50 ring-1 ring-inset ring-success-600/15"
                                  style={style}
                                />
                              );
                            }
                            return (
                              <Link
                                key={span.start}
                                to={`/book?coach=${coach.id}&date=${coachDate}`}
                                title={`${label}. Select to book.`}
                                aria-label={`${label}. Book a demo.`}
                                className="absolute inset-y-1 rounded-md bg-success-100 ring-1 ring-inset ring-success-600/40 transition hover:bg-success-200 hover:ring-success-600 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-600"
                                style={{
                                  left: `${scale.position(span.start)}%`,
                                  width: `${Math.max(0.6, scale.position(span.end) - scale.position(span.start))}%`,
                                }}
                              />
                            );
                          })}
                          {coach.booked.map((item) => (
                            <Link
                              key={item.id}
                              to={`/calendar?appointment=${item.id}`}
                              title={`${item.student_name}: ${time(item.start)} – ${time(item.end)}`}
                              aria-label={`Booked demo with ${item.student_name}, ${time(item.start)} to ${time(item.end)}`}
                              className="absolute inset-y-1 flex items-center overflow-hidden rounded-md bg-accent px-1.5 text-[10px] font-semibold text-on-accent shadow-sm transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-600"
                              style={{
                                left: `${scale.position(item.start)}%`,
                                width: `${Math.max(0.6, scale.position(item.end) - scale.position(item.start))}%`,
                              }}
                            >
                              <span className="truncate">{item.student_name}</span>
                            </Link>
                          ))}
                          {scale.nowLeft !== null && (
                            <span
                              aria-hidden="true"
                              className="absolute -inset-y-1 w-0.5 rounded-full bg-danger-500"
                              style={{ left: `${scale.nowLeft}%` }}
                            />
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )
        )}
      </Card>
    </div>
  );
}
