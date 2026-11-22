import { useState, type FormEvent } from 'react';
import { getCountryCode } from '@vvo/tzdb';
import { Hourglass, Plus, Save, Send, Trash2, Undo2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { TimeZoneSelect } from '../../components/ui/TimeZoneSelect';
import { useToast } from '../../components/ui/Toast';
import { apiErrorDetail } from '../../lib/apiError';
import { useMeQuery } from '../auth/api';
import {
  useAddExceptionMutation,
  useAvailabilityQuery,
  useDeleteExceptionMutation,
  useInstructorsQuery,
  useSaveAvailabilityMutation,
  useUpdateInstructorMutation,
  type AvailabilityException,
  type AvailabilityRule,
  type PendingAvailabilityRequest,
} from '../instructors/api';
import { isPendingReceipt, useWithdrawChangeRequestMutation } from '../requests/api';

const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const blank: AvailabilityRule = { day_of_week: 0, start_local_time: '09:00', end_local_time: '17:00' };
const inputClass = 'rounded-lg border border-slate-300 px-3 py-2 text-sm';

function timeSpan(start: string | null | undefined, end: string | null | undefined) {
  return start ? `${start.slice(0, 5)}–${end?.slice(0, 5) ?? ''}` : 'All day';
}

function submittedOn(value: string) {
  return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function PendingChip({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900">
      <Hourglass size={12} aria-hidden="true" />
      {children}
    </span>
  );
}

export function AvailabilityPage() {
  const me = useMeQuery();
  // Coach edits become requests that an administrator approves; admin edits apply at once.
  const needsApproval = me.data?.role === 'instructor';
  const instructors = useInstructorsQuery();
  const [selectedId, setSelectedId] = useState('');
  const instructor = instructors.data?.find((item) => item.id === selectedId) ?? instructors.data?.[0];
  const instructorId = instructor?.id;
  const instructorTimezone = instructor?.timezone;
  const instructorCountryCode = instructor?.country_code;
  const availability = useAvailabilityQuery(instructor?.id ?? '', { skip: !instructor?.id });
  const [rules, setRules] = useState<AvailabilityRule[]>([]);
  const [note, setNote] = useState('');
  const [save, saveResult] = useSaveAvailabilityMutation();
  const [updateInstructor, timezoneResult] = useUpdateInstructorMutation();
  const [addException, exceptionResult] = useAddExceptionMutation();
  const [deleteException, deleteExceptionResult] = useDeleteExceptionMutation();
  const [withdraw, withdrawResult] = useWithdrawChangeRequestMutation();
  const [exceptionDate, setExceptionDate] = useState('');
  const [exceptionStart, setExceptionStart] = useState('');
  const [exceptionEnd, setExceptionEnd] = useState('');
  const [exceptionType, setExceptionType] = useState<'unavailable' | 'additional_available'>('unavailable');
  const [reason, setReason] = useState('');
  const [timezoneDraft, setTimezoneDraft] = useState('');
  const [countryCodeDraft, setCountryCodeDraft] = useState('');
  const [availabilityError, setAvailabilityError] = useState('');
  const [exceptionError, setExceptionError] = useState('');
  const [timezoneError, setTimezoneError] = useState('');
  const { notify } = useToast();

  const pending = availability.currentData?.pending_requests ?? [];
  const pendingWeekly = pending.find((item) => item.request_type === 'weekly_availability');
  const pendingTimezone = pending.find((item) => item.request_type === 'timezone_change');
  const pendingAdditions = pending.filter((item) => item.request_type === 'exception_add');
  const pendingRemovals = new Map(
    pending.filter((item) => item.request_type === 'exception_remove').map((item) => [item.exception_id, item]),
  );

  // Load the saved schedule and zone into the editors whenever fresh server data arrives.
  const [loadedAvailability, setLoadedAvailability] = useState(availability.currentData);
  if (availability.currentData && availability.currentData !== loadedAvailability) {
    setLoadedAvailability(availability.currentData);
    setRules(availability.currentData.rules.map((rule) => ({ ...rule })));
  }
  const zoneKey = instructorTimezone ? `${instructorId}|${instructorTimezone}|${instructorCountryCode ?? ''}` : null;
  const [loadedZoneKey, setLoadedZoneKey] = useState<string | null>(null);
  if (zoneKey !== loadedZoneKey) {
    setLoadedZoneKey(zoneKey);
    if (instructorTimezone) {
      setTimezoneDraft(instructorTimezone);
      setCountryCodeDraft(instructorCountryCode ?? getCountryCode(instructorTimezone) ?? '');
    }
  }
  const rulesFor = (day: number) =>
    rules.map((rule, index) => ({ rule, index })).filter(({ rule }) => rule.day_of_week === day);

  function addRule(day: number) {
    setRules([...rules, { ...blank, day_of_week: day }]);
  }
  function editRule(index: number, key: 'start_local_time' | 'end_local_time', value: string) {
    setRules(rules.map((item, i) => (i === index ? { ...item, [key]: value } : item)));
  }
  function removeRule(index: number) {
    setRules(rules.filter((_item, i) => i !== index));
  }
  function copyPreviousDay(day: number) {
    const previous = rules.filter((rule) => rule.day_of_week === day - 1);
    setRules([
      ...rules.filter((rule) => rule.day_of_week !== day),
      ...previous.map((rule) => ({ ...rule, day_of_week: day })),
    ]);
  }

  async function saveRules() {
    if (!instructor) return;
    setAvailabilityError('');
    try {
      const result = await save({
        id: instructor.id,
        rules,
        ...(needsApproval && note.trim() ? { note: note.trim() } : {}),
      }).unwrap();
      if (isPendingReceipt(result)) {
        setNote('');
        notify(
          'Weekly hours sent for approval. Families can book your current hours until an administrator approves the change.',
        );
      }
    } catch (error) {
      setAvailabilityError(
        apiErrorDetail(error) ?? 'Weekly availability could not be saved. Check each time range and try again.',
      );
    }
  }

  async function saveTimezone() {
    if (!instructor || (timezoneDraft === instructor.timezone && countryCodeDraft === instructor.country_code)) return;
    setTimezoneError('');
    try {
      const result = await updateInstructor({
        id: instructor.id,
        timezone: timezoneDraft,
        country_code: countryCodeDraft,
      }).unwrap();
      if (result.pending_request_id)
        notify('Time zone change sent for approval. Your hours keep the current time zone until it is approved.');
    } catch (error) {
      setTimezoneError(
        apiErrorDetail(error) ?? 'Time zone could not be saved. Choose a valid country and region, then retry.',
      );
    }
  }

  async function submitException(event: FormEvent) {
    event.preventDefault();
    if (!instructor || !exceptionDate) return;
    setExceptionError('');
    try {
      const result = await addException({
        id: instructor.id,
        exception_date: exceptionDate,
        exception_type: exceptionType,
        start_local_time: exceptionStart || null,
        end_local_time: exceptionEnd || null,
        reason,
      }).unwrap();
      setExceptionDate('');
      setExceptionStart('');
      setExceptionEnd('');
      setReason('');
      if (isPendingReceipt(result)) notify('Request sent. It appears below as awaiting approval.');
    } catch (error) {
      setExceptionError(
        apiErrorDetail(error) ?? 'The exception could not be saved. Check the selected date and time range.',
      );
    }
  }

  async function removeException(exceptionId: string) {
    if (!instructor) return;
    setExceptionError('');
    try {
      const result = await deleteException({ instructorId: instructor.id, exceptionId }).unwrap();
      if (isPendingReceipt(result)) notify('Removal request sent for approval.');
    } catch (error) {
      setExceptionError(
        apiErrorDetail(error) ?? 'The availability exception could not be removed. Refresh and try again.',
      );
    }
  }

  async function withdrawRequest(request: PendingAvailabilityRequest) {
    try {
      await withdraw(request.id).unwrap();
      notify('Request withdrawn.');
    } catch (error) {
      setAvailabilityError(apiErrorDetail(error) ?? 'The request could not be withdrawn. Refresh and try again.');
    }
  }

  if (instructors.isLoading) return <div className="h-64 animate-pulse rounded-2xl bg-surface" />;
  if (instructors.isError)
    return (
      <div role="alert" className="rounded-lg bg-rose-50 p-4 text-sm text-rose-700">
        Coach profiles could not be loaded. Refresh and try again.
      </div>
    );

  const exceptions = availability.currentData?.exceptions ?? [];
  const weeklyWarning = saveResult.data && !isPendingReceipt(saveResult.data) ? saveResult.data : undefined;
  const exceptionWarning =
    exceptionResult.data && !isPendingReceipt(exceptionResult.data) ? exceptionResult.data : undefined;

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-heading">Weekly availability</h2>
          <p className="mt-1 text-sm text-slate-500">
            {needsApproval
              ? 'Propose your recurring hours and time off. An administrator approves each change before families can book it.'
              : 'Set recurring coaching hours and add date-specific time off.'}
          </p>
        </div>
        {instructors.data && instructors.data.length > 1 && (
          <label className="w-full text-sm font-medium text-slate-700 sm:w-auto">
            View coach
            <select
              aria-label="View coach availability"
              value={instructor?.id}
              onChange={(event) => setSelectedId(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-surface px-3 text-sm sm:min-w-52"
            >
              {instructors.data.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.display_name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {availability.isError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-rose-50 p-4 text-sm text-rose-700"
        >
          <span>Availability could not be loaded. Retry the request or check the API connection.</span>
          <Button variant="secondary" onClick={() => void availability.refetch()}>
            Retry
          </Button>
        </div>
      )}
      {!needsApproval && pending.length > 0 && (
        <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          This coach has {pending.length} availability {pending.length === 1 ? 'request' : 'requests'} waiting for
          review.{' '}
          <Link className="font-semibold underline" to="/requests">
            Open approvals
          </Link>
        </p>
      )}

      {instructor && (
        <>
          <Card className="p-5 sm:p-6">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
              <div>
                <h3 className="font-semibold text-slate-900">Coach country and time zone</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Weekly hours follow the selected IANA region, including daylight saving changes.
                </p>
                {pendingTimezone && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <PendingChip>{`Awaiting approval: ${pendingTimezone.payload.timezone ?? ''}`}</PendingChip>
                    {needsApproval && (
                      <Button
                        variant="ghost"
                        className="px-2 py-1 text-xs"
                        disabled={withdrawResult.isLoading}
                        onClick={() => void withdrawRequest(pendingTimezone)}
                      >
                        <Undo2 size={13} />
                        Withdraw
                      </Button>
                    )}
                  </div>
                )}
              </div>
              <div className="w-full max-w-3xl">
                <TimeZoneSelect
                  required
                  countryCode={countryCodeDraft}
                  timezone={timezoneDraft}
                  onCountryCodeChange={setCountryCodeDraft}
                  onTimezoneChange={setTimezoneDraft}
                  countryLabel="Country where the coach lives"
                  timezoneLabel="Coach time zone"
                />
                <div className="mt-3 flex justify-end">
                  <Button
                    variant="secondary"
                    className="w-full sm:w-auto"
                    onClick={() => void saveTimezone()}
                    disabled={
                      !timezoneDraft ||
                      (timezoneDraft === instructor.timezone && countryCodeDraft === instructor.country_code) ||
                      timezoneResult.isLoading
                    }
                  >
                    {timezoneResult.isLoading
                      ? 'Saving…'
                      : needsApproval
                        ? 'Request time zone change'
                        : 'Save country and time zone'}
                  </Button>
                </div>
              </div>
            </div>
            {timezoneError && (
              <p role="alert" className="mt-3 text-sm text-rose-700">
                {timezoneError}
              </p>
            )}
          </Card>

          {pendingWeekly && (
            <div
              role="status"
              className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="flex items-start gap-2">
                <Hourglass size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>
                  A weekly hours change sent {submittedOn(pendingWeekly.created_at)} is waiting for admin approval. The
                  hours below are the ones families can book now.
                </span>
              </span>
              {needsApproval && (
                <span className="flex shrink-0 flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    className="px-3 py-2 text-xs"
                    onClick={() => setRules((pendingWeekly.payload.rules ?? []).map((rule) => ({ ...rule })))}
                  >
                    Edit proposed hours
                  </Button>
                  <Button
                    variant="ghost"
                    className="px-3 py-2 text-xs"
                    disabled={withdrawResult.isLoading}
                    onClick={() => void withdrawRequest(pendingWeekly)}
                  >
                    <Undo2 size={13} />
                    Withdraw
                  </Button>
                </span>
              )}
            </div>
          )}

          <Card className="divide-y divide-slate-100 overflow-hidden">
            {weekdays.map((day, index) => (
              <div key={day} className="grid gap-3 px-5 py-4 sm:grid-cols-[130px_1fr] sm:px-6">
                <div className="pt-2 text-sm font-medium text-slate-800">{day}</div>
                <div className="space-y-2">
                  {rulesFor(index).map(({ rule, index: ruleIndex }) => (
                    <div key={ruleIndex} className="flex flex-wrap items-center gap-2">
                      <input
                        aria-label={`${day} start`}
                        type="time"
                        value={rule.start_local_time.slice(0, 5)}
                        onChange={(event) => editRule(ruleIndex, 'start_local_time', event.target.value)}
                        className={inputClass}
                      />
                      <span className="text-slate-400">to</span>
                      <input
                        aria-label={`${day} end`}
                        type="time"
                        value={rule.end_local_time.slice(0, 5)}
                        onChange={(event) => editRule(ruleIndex, 'end_local_time', event.target.value)}
                        className={inputClass}
                      />
                      <button
                        type="button"
                        onClick={() => removeRule(ruleIndex)}
                        aria-label={`Remove ${day} interval`}
                        className="rounded-md p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-700"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                  {!rulesFor(index).length && <p className="py-2 text-sm text-slate-400">Unavailable</p>}
                  <div className="flex flex-wrap items-center gap-4">
                    <button
                      type="button"
                      onClick={() => addRule(index)}
                      className="inline-flex items-center gap-1.5 py-1 text-xs font-semibold text-indigo-700 hover:text-indigo-900"
                    >
                      <Plus size={14} />
                      Add hours
                    </button>
                    {index > 0 && (
                      <button
                        type="button"
                        onClick={() => copyPreviousDay(index)}
                        className="py-1 text-xs font-medium text-slate-500 hover:text-slate-800"
                      >
                        Copy previous day
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </Card>

          {weeklyWarning?.warning && (
            <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              {weeklyWarning.warning}
              <ul className="mt-2 list-inside list-disc">
                {weeklyWarning.affected_bookings.map((id) => (
                  <li key={id}>
                    <a className="underline" href={`/calendar?appointment=${id}`}>
                      {id.slice(0, 8)}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {availabilityError && (
            <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
              {availabilityError}
            </p>
          )}
          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-end sm:justify-end">
            {needsApproval && (
              <label className="block flex-1 text-sm font-medium text-slate-700 sm:max-w-md">
                Note for the administrator (optional)
                <input
                  maxLength={1000}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="For example, new school term timetable"
                  className={`mt-1 block w-full ${inputClass}`}
                />
              </label>
            )}
            <Button
              className="w-full sm:w-auto"
              onClick={() => void saveRules()}
              disabled={saveResult.isLoading || availability.isError || availability.isFetching}
            >
              {needsApproval ? <Send size={16} /> : <Save size={16} />}
              {saveResult.isLoading ? 'Saving…' : needsApproval ? 'Submit for approval' : 'Save weekly hours'}
            </Button>
          </div>

          <Card className="p-5 sm:p-6">
            <div>
              <h3 className="font-semibold text-slate-900">Time off and exceptions</h3>
              <p className="mt-1 text-sm text-slate-500">
                Block time off or add hours for a specific date.
                {needsApproval ? ' Each entry needs admin approval.' : ''}
              </p>
            </div>
            <form onSubmit={submitException} className="mt-5 grid gap-3 sm:grid-cols-2">
              <input
                aria-label="Exception date"
                required
                type="date"
                value={exceptionDate}
                onChange={(event) => setExceptionDate(event.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
              />
              <select
                aria-label="Exception type"
                value={exceptionType}
                onChange={(event) => setExceptionType(event.target.value as 'unavailable' | 'additional_available')}
                className="rounded-lg border border-slate-300 bg-surface px-3 py-2.5 text-sm"
              >
                <option value="unavailable">Unavailable</option>
                <option value="additional_available">Additional available hours</option>
              </select>
              <input
                aria-label="Reason"
                placeholder="Reason (optional)"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="min-w-0 rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
              />
              <label className="text-xs text-slate-500">
                From (leave both times blank for all day)
                <input
                  aria-label="Exception from"
                  type="time"
                  value={exceptionStart}
                  onChange={(event) => setExceptionStart(event.target.value)}
                  className={`mt-1 block ${inputClass}`}
                />
              </label>
              <label className="text-xs text-slate-500">
                Until
                <input
                  aria-label="Exception until"
                  type="time"
                  value={exceptionEnd}
                  onChange={(event) => setExceptionEnd(event.target.value)}
                  className={`mt-1 block ${inputClass}`}
                />
              </label>
              <div>
                <Button type="submit" disabled={exceptionResult.isLoading || availability.isFetching}>
                  {needsApproval ? 'Request exception' : 'Add exception'}
                </Button>
              </div>
            </form>
            {exceptionError && (
              <p role="alert" className="mt-3 text-sm text-rose-700">
                {exceptionError}
              </p>
            )}
            {exceptionWarning?.warning && (
              <div
                role="alert"
                className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
              >
                {exceptionWarning.warning}{' '}
                {exceptionWarning.affected_bookings?.map((id) => (
                  <a key={id} className="ml-2 underline" href={`/calendar?appointment=${id}`}>
                    {id.slice(0, 8)}
                  </a>
                ))}
              </div>
            )}
            {exceptions.length || pendingAdditions.length ? (
              <div className="mt-5 divide-y divide-slate-100">
                {exceptions.map((item: AvailabilityException) => {
                  const removal = pendingRemovals.get(item.id);
                  return (
                    <div key={item.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <strong className="font-medium">{item.exception_date}</strong>
                        <span className="text-slate-500">
                          {timeSpan(item.start_local_time, item.end_local_time)} · {item.reason || item.exception_type}
                        </span>
                        {removal && <PendingChip>Removal awaiting approval</PendingChip>}
                      </span>
                      {removal && needsApproval ? (
                        <Button
                          variant="ghost"
                          className="px-2 py-1 text-xs"
                          disabled={withdrawResult.isLoading}
                          onClick={() => void withdrawRequest(removal)}
                        >
                          <Undo2 size={13} />
                          Keep it
                        </Button>
                      ) : (
                        !removal && (
                          <button
                            type="button"
                            aria-label="Remove exception"
                            disabled={deleteExceptionResult.isLoading}
                            onClick={() => void removeException(item.id)}
                            className="min-h-11 min-w-11 rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
                          >
                            <Trash2 size={15} />
                          </button>
                        )
                      )}
                    </div>
                  );
                })}
                {pendingAdditions.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <strong className="font-medium text-slate-600">{item.payload.exception_date}</strong>
                      <span className="text-slate-500">
                        {timeSpan(item.payload.start_local_time, item.payload.end_local_time)} ·{' '}
                        {item.payload.reason || item.payload.exception_type}
                      </span>
                      <PendingChip>Awaiting approval</PendingChip>
                    </span>
                    {needsApproval && (
                      <Button
                        variant="ghost"
                        className="px-2 py-1 text-xs"
                        disabled={withdrawResult.isLoading}
                        onClick={() => void withdrawRequest(item)}
                      >
                        <Undo2 size={13} />
                        Withdraw
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-5 text-sm text-slate-400">No upcoming exceptions.</p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
