import { useState } from 'react';
import { formatInTimeZone } from 'date-fns-tz';
import { ArrowRight, Check, Hourglass, Inbox, Undo2, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Dialog } from '../../components/ui/Dialog';
import { apiErrorDetail } from '../../lib/apiError';
import { useMeQuery } from '../auth/api';
import {
  useApproveChangeRequestMutation,
  useChangeRequestsQuery,
  useRejectChangeRequestMutation,
  useWithdrawChangeRequestMutation,
  type ChangeRequest,
  type ChangeRequestStatus,
} from './api';

const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const tabs: { id: ChangeRequestStatus | 'all'; label: string }[] = [
  { id: 'pending', label: 'Waiting' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'all', label: 'All' },
];
const statusStyles: Record<ChangeRequestStatus, string> = {
  pending: 'bg-amber-50 text-amber-900',
  approved: 'bg-emerald-50 text-emerald-800',
  rejected: 'bg-rose-50 text-rose-800',
  withdrawn: 'bg-slate-100 text-slate-600',
  superseded: 'bg-slate-100 text-slate-600',
};
const statusLabels: Record<ChangeRequestStatus, string> = {
  pending: 'Waiting for approval',
  approved: 'Approved',
  rejected: 'Not approved',
  withdrawn: 'Withdrawn',
  superseded: 'Replaced by a newer request',
};

type Rule = { day_of_week: number; start_local_time: string; end_local_time: string };

function hoursByDay(rules: Rule[] | undefined) {
  return weekdays.map((_, day) => (rules ?? [])
    .filter((rule) => rule.day_of_week === day)
    .map((rule) => `${rule.start_local_time.slice(0, 5)}–${rule.end_local_time.slice(0, 5)}`)
    .join(', ') || 'Unavailable');
}

function moment(value: string | undefined | null, zone: string | null | undefined) {
  if (!value) return '—';
  return formatInTimeZone(new Date(value), zone || 'UTC', 'EEE d MMM yyyy, h:mm a zzz');
}

function exceptionText(item: { exception_date?: string; start_local_time?: string | null; end_local_time?: string | null; exception_type?: string; reason?: string | null } | null | undefined) {
  if (!item?.exception_date) return '—';
  const kind = item.exception_type === 'additional_available' ? 'Extra hours' : 'Time off';
  const span = item.start_local_time ? `${item.start_local_time.slice(0, 5)}–${item.end_local_time?.slice(0, 5) ?? ''}` : 'all day';
  return `${kind} · ${item.exception_date} · ${span}${item.reason ? ` · ${item.reason}` : ''}`;
}

function BeforeAfter({ before, after }: { before: string; after: string }) {
  return (
    <div className="grid items-center gap-2 text-sm sm:grid-cols-[1fr_auto_1fr]">
      <div className="rounded-lg bg-slate-50 px-3 py-2 text-slate-600"><span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400">Now</span>{before}</div>
      <ArrowRight size={16} className="mx-auto hidden text-slate-400 sm:block" aria-hidden="true" />
      <div className="rounded-lg bg-indigo-50 px-3 py-2 text-indigo-900"><span className="block text-[11px] font-semibold uppercase tracking-wide text-indigo-500">Requested</span>{after}</div>
    </div>
  );
}

/** A side-by-side view of what changes if the request is approved. */
function RequestDetails({ request }: { request: ChangeRequest }) {
  const { before, proposed, instructor_timezone: coachZone } = request;
  switch (request.request_type) {
    case 'weekly_availability': {
      const now = hoursByDay(before?.rules);
      const next = hoursByDay(proposed.rules);
      return (
        <div className="overflow-hidden rounded-lg border border-slate-200 text-sm">
          <div className="grid grid-cols-[6.5rem_1fr_1fr] bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500"><span>Day</span><span>Now</span><span>Requested ({coachZone})</span></div>
          {weekdays.map((day, index) => (
            <div key={day} className={`grid grid-cols-[6.5rem_1fr_1fr] border-t border-slate-100 px-3 py-2 ${now[index] !== next[index] ? 'bg-amber-50/60' : ''}`}>
              <span className="font-medium text-slate-700">{day.slice(0, 3)}</span>
              <span className="text-slate-500">{now[index]}</span>
              <span className={now[index] !== next[index] ? 'font-semibold text-slate-900' : 'text-slate-500'}>{next[index]}</span>
            </div>
          ))}
        </div>
      );
    }
    case 'exception_add':
      return <BeforeAfter before="No exception on this date" after={exceptionText(proposed)} />;
    case 'exception_remove':
      return <BeforeAfter before={exceptionText(before)} after="Removed" />;
    case 'timezone_change':
      return <BeforeAfter before={`${before?.timezone ?? '—'} (${before?.country_code ?? '—'})`} after={`${proposed.timezone ?? '—'} (${proposed.country_code ?? '—'})`} />;
    case 'appointment_cancel':
      return (
        <div className="space-y-2">
          <BeforeAfter before={`Booked · ${moment(before?.starts_at, coachZone)}`} after="Cancelled" />
          {before?.student_name && <p className="text-xs text-slate-500">Student: {before.student_name}{before.student_timezone ? ` · their time ${moment(before.starts_at, before.student_timezone)}` : ''}</p>}
        </div>
      );
    case 'appointment_reschedule':
      return (
        <div className="space-y-2">
          <BeforeAfter before={moment(before?.starts_at, coachZone)} after={moment(proposed.starts_at, coachZone)} />
          {before?.student_name && before.student_timezone && (
            <p className="text-xs text-slate-500">Student {before.student_name} · their time {moment(before.starts_at, before.student_timezone)} → {moment(proposed.starts_at, before.student_timezone)}</p>
          )}
        </div>
      );
    default:
      return <p className="text-sm text-slate-600">{request.summary}</p>;
  }
}

export function RequestsPage() {
  const me = useMeQuery();
  const isAdmin = me.data?.role === 'admin';
  const [tab, setTab] = useState<ChangeRequestStatus | 'all'>('pending');
  const [cursor, setCursor] = useState<string | undefined>();
  const requests = useChangeRequestsQuery(
    { ...(tab !== 'all' ? { status: tab } : {}), ...(cursor ? { before: cursor } : {}) },
    { pollingInterval: 30_000, skipPollingIfUnfocused: true, refetchOnFocus: true },
  );
  const [approve, approveResult] = useApproveChangeRequestMutation();
  const [reject, rejectResult] = useRejectChangeRequestMutation();
  const [withdraw, withdrawResult] = useWithdrawChangeRequestMutation();
  const [rejectTarget, setRejectTarget] = useState<ChangeRequest | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ text: string; affected?: string[] } | null>(null);
  const busy = approveResult.isLoading || rejectResult.isLoading || withdrawResult.isLoading;
  const items = requests.currentData?.items ?? [];

  function chooseTab(next: ChangeRequestStatus | 'all') {
    setTab(next);
    setCursor(undefined);
  }

  async function approveRequest(request: ChangeRequest) {
    setError('');
    setNotice(null);
    try {
      const result = await approve({ id: request.id }).unwrap();
      setNotice({ text: `Approved: ${request.label.toLowerCase()} for ${request.instructor_name}. The coach has been emailed.`, affected: result.affected_bookings });
    } catch (failure) {
      setError(apiErrorDetail(failure) ?? 'The request could not be approved. Refresh and try again.');
    }
  }

  async function confirmReject() {
    if (!rejectTarget || rejectNote.trim().length < 3) return;
    setError('');
    try {
      await reject({ id: rejectTarget.id, review_note: rejectNote.trim() }).unwrap();
      setNotice({ text: `Not approved. ${rejectTarget.instructor_name} has been emailed your note.` });
      setRejectTarget(null);
      setRejectNote('');
    } catch (failure) {
      setError(apiErrorDetail(failure) ?? 'The request could not be rejected. Refresh and try again.');
    }
  }

  async function withdrawRequest(request: ChangeRequest) {
    setError('');
    try {
      await withdraw(request.id).unwrap();
      setNotice({ text: 'Request withdrawn.' });
    } catch (failure) {
      setError(apiErrorDetail(failure) ?? 'The request could not be withdrawn. Refresh and try again.');
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight text-heading">{isAdmin ? 'Approvals' : 'My requests'}</h2>
        <p className="mt-1 text-sm text-slate-500">
          {isAdmin
            ? 'Coach changes to availability, time zone, and demo bookings take effect only after you approve them.'
            : 'Changes you asked for. They take effect once an administrator approves them; you get an email either way.'}
        </p>
      </header>

      <div role="tablist" aria-label="Filter requests" className="flex flex-wrap gap-2">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => chooseTab(item.id)}
            className={`min-h-10 rounded-full px-4 text-sm font-semibold transition ${tab === item.id ? 'bg-action text-white shadow-sm' : 'bg-surface text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50'}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {notice && (
        <div role="status" className="ui-enter rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
          {notice.text}
          {notice.affected?.length ? (
            <p className="mt-2 text-amber-900">
              Existing bookings were kept but now fall outside the approved hours — review them:
              {notice.affected.map((id) => <Link key={id} className="ml-2 underline" to={`/calendar?appointment=${id}`}>{id.slice(0, 8)}</Link>)}
            </p>
          ) : null}
        </div>
      )}
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}

      {requests.isLoading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-40 animate-pulse rounded-2xl bg-surface" />)}</div>
      ) : requests.isError ? (
        <Card className="p-6"><p role="alert" className="text-sm text-rose-700">Requests could not be loaded.</p><Button variant="secondary" className="mt-3" onClick={() => void requests.refetch()}>Retry</Button></Card>
      ) : items.length === 0 ? (
        <Card className="grid place-items-center gap-2 p-12 text-center">
          <Inbox size={28} className="text-slate-300" aria-hidden="true" />
          <p className="font-medium text-slate-700">{tab === 'pending' ? 'Nothing waiting for approval' : 'No requests in this view'}</p>
          <p className="text-sm text-slate-500">{tab === 'pending' && isAdmin ? 'New coach requests appear here and are emailed to every admin.' : ' '}</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {items.map((request) => (
            <Card key={request.id} className="ui-enter p-5 sm:p-6">
              <article aria-label={`${request.label} from ${request.instructor_name}`} className="space-y-4">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">{request.label}</p>
                    <h3 className="mt-1 font-semibold text-heading">{request.instructor_name}</h3>
                    <p className="mt-0.5 text-xs text-slate-500">Sent {new Date(request.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · coach time zone {request.instructor_timezone}</p>
                  </div>
                  <span className={`inline-flex shrink-0 items-center gap-1 self-start rounded-full px-2.5 py-1 text-xs font-medium ${statusStyles[request.status]}`}>
                    {request.status === 'pending' && <Hourglass size={12} aria-hidden="true" />}{statusLabels[request.status]}
                  </span>
                </div>

                <RequestDetails request={request} />

                {request.coach_note && <p className="rounded-lg border-l-4 border-indigo-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"><span className="font-medium">Coach note:</span> {request.coach_note}</p>}
                {request.review_note && <p className="rounded-lg border-l-4 border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700"><span className="font-medium">Admin note:</span> {request.review_note}{request.reviewed_by_email ? ` — ${request.reviewed_by_email}` : ''}</p>}

                {request.status === 'pending' && (
                  <div className="flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
                    {request.appointment_id && <Link to={`/calendar?appointment=${request.appointment_id}`} className="inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold text-slate-600 hover:bg-slate-100">View demo</Link>}
                    {isAdmin ? (
                      <>
                        <Button variant="secondary" disabled={busy} onClick={() => { setRejectTarget(request); setRejectNote(''); setError(''); }}><X size={15} />Reject</Button>
                        <Button disabled={busy} onClick={() => void approveRequest(request)}><Check size={15} />Approve</Button>
                      </>
                    ) : (
                      <Button variant="secondary" disabled={busy} onClick={() => void withdrawRequest(request)}><Undo2 size={15} />Withdraw</Button>
                    )}
                  </div>
                )}
              </article>
            </Card>
          ))}
          {(cursor || requests.currentData?.next_cursor) && (
            <div className="flex justify-center gap-2">
              {cursor && <Button variant="ghost" onClick={() => setCursor(undefined)}>Back to newest</Button>}
              {requests.currentData?.next_cursor && <Button variant="secondary" onClick={() => setCursor(requests.currentData?.next_cursor ?? undefined)}>Older requests</Button>}
            </div>
          )}
        </div>
      )}

      <Dialog
        open={Boolean(rejectTarget)}
        title="Reject this request?"
        description={rejectTarget ? `${rejectTarget.instructor_name} will be emailed your note. Nothing changes in the schedule.` : undefined}
        confirmLabel="Reject request"
        cancelLabel="Go back"
        destructive
        busy={rejectResult.isLoading}
        confirmDisabled={rejectNote.trim().length < 3}
        onClose={() => setRejectTarget(null)}
        onConfirm={() => void confirmReject()}
      >
        <label className="block text-sm font-medium text-slate-700">
          Note for the coach
          <textarea autoFocus required minLength={3} maxLength={1000} value={rejectNote} onChange={(event) => setRejectNote(event.target.value)} placeholder="For example, a family is already booked on that day." className="mt-2 block min-h-24 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
        </label>
      </Dialog>
    </div>
  );
}
