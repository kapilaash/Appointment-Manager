import { useEffect, useState } from 'react';
import { formatInTimeZone } from 'date-fns-tz';
import { BadgeCheck, CalendarClock, CheckCircle2, ExternalLink, Hourglass, Search, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Dialog } from '../../components/ui/Dialog';
import { useToast } from '../../components/ui/Toast';
import { useMeQuery } from '../auth/api';
import { isPendingReceipt } from '../requests/api';
import { apiErrorDetail } from '../../lib/apiError';
import { useNow } from '../../lib/useNow';
import {
  useAppointmentsQuery,
  useSearchAppointmentsQuery,
  useAppointmentNotificationsQuery,
  useCancelAppointmentMutation,
  useCompleteAppointmentMutation,
  type Appointment,
} from './api';

export function AppointmentsPage() {
  const navigate = useNavigate();
  const currentUser = useMeQuery();
  const canManageBookings = currentUser.data?.role === 'admin';
  const canCompleteBookings = currentUser.data?.role === 'admin' || currentUser.data?.role === 'instructor';
  // Coaches can ask to cancel or reschedule; an administrator approves before anything changes.
  const needsApproval = currentUser.data?.role === 'instructor';
  const canChangeBookings = canManageBookings || needsApproval;
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedNotifications, setSelectedNotifications] = useState('');
  const [cancelTarget, setCancelTarget] = useState<Appointment | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState('');
  const [completeTarget, setCompleteTarget] = useState<Appointment | null>(null);
  const [completeError, setCompleteError] = useState('');
  const { notify } = useToast();
  const now = useNow(30_000);
  const appointments = useAppointmentsQuery(status ? { status } : undefined, {
    pollingInterval: 30_000,
    skipPollingIfUnfocused: true,
    refetchOnFocus: true,
    skip: Boolean(search.trim()),
  });
  const normalizedSearch = search.trim();
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(normalizedSearch), 300);
    return () => window.clearTimeout(timer);
  }, [normalizedSearch]);
  const searchResults = useSearchAppointmentsQuery(
    { query: debouncedSearch, ...(status ? { status } : {}) },
    { skip: debouncedSearch.length < 2 },
  );
  const notifications = useAppointmentNotificationsQuery(selectedNotifications, {
    skip: !selectedNotifications,
    pollingInterval: selectedNotifications ? 10_000 : 0,
    skipPollingIfUnfocused: true,
  });
  const [cancel, cancelResult] = useCancelAppointmentMutation();
  const [complete, completeResult] = useCompleteAppointmentMutation();
  const isSearchPending = normalizedSearch.length >= 2 && normalizedSearch !== debouncedSearch;
  const rows = normalizedSearch
    ? normalizedSearch.length >= 2
      ? (searchResults.currentData?.items ?? [])
      : []
    : (appointments.data ?? []);
  const isLoadingRows =
    normalizedSearch.length >= 2
      ? isSearchPending || searchResults.isFetching
      : normalizedSearch.length === 0 && appointments.isLoading;
  const hasRowsError =
    normalizedSearch.length >= 2 ? searchResults.isError : normalizedSearch.length === 0 && appointments.isError;

  async function confirmCancel() {
    if (!cancelTarget || cancelReason.trim().length < 3) return;
    setCancelError('');
    try {
      const result = await cancel({ id: cancelTarget.id, reason: cancelReason.trim() }).unwrap();
      if (isPendingReceipt(result))
        notify('Cancellation request sent. The demo stays booked until an administrator approves it.');
      setCancelTarget(null);
      setCancelReason('');
    } catch (error) {
      setCancelError(
        apiErrorDetail(error) ?? 'The demo could not be cancelled. Refresh the appointment list and try again.',
      );
    }
  }

  async function confirmComplete() {
    if (!completeTarget) return;
    setCompleteError('');
    try {
      await complete(completeTarget.id).unwrap();
      notify('Demo marked as completed.');
      setCompleteTarget(null);
    } catch {
      setCompleteError(
        'This demo could not be marked complete. It may still be in progress or may have been cancelled.',
      );
    }
  }

  function openCancelDialog(appointment: Appointment) {
    setCancelTarget(appointment);
    setCancelReason('');
    setCancelError('');
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-heading">Appointments</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Review classes, meeting links, and email delivery. Mark a confirmed demo complete after its scheduled end.
        </p>
      </div>
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-neutral-100 p-4 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-center gap-2 rounded-lg border border-neutral-300 px-3">
            <Search size={16} className="text-neutral-500" />
            <input
              aria-label="Search appointments"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search names, email, coach, or booking ID"
              className="w-full py-2 text-sm outline-none sm:w-64"
            />
            {search && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setSearch('')}
                className="rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700"
              >
                <X size={14} />
              </button>
            )}
          </label>
          <select
            aria-label="Filter by status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="w-full rounded-lg border border-neutral-300 bg-surface px-3 text-sm sm:w-auto"
          >
            <option value="">All statuses</option>
            <option value="confirmed">Confirmed</option>
            <option value="cancelled">Cancelled</option>
            <option value="completed">Completed</option>
          </select>
        </div>
        {normalizedSearch.length >= 2 && !isSearchPending && searchResults.currentData && (
          <p role="status" className="border-b border-neutral-100 px-4 py-3 text-sm text-neutral-500">
            Showing {rows.length} of {searchResults.currentData.estimated_total_hits} matching appointments.
          </p>
        )}
        {isLoadingRows ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-lg bg-neutral-100" />
            ))}
          </div>
        ) : hasRowsError ? (
          <div role="alert" className="p-6 text-sm text-danger-700">
            {debouncedSearch ? 'Appointment search is temporarily unavailable.' : 'Could not load appointments.'}
            <button
              type="button"
              className="ml-2 font-semibold underline"
              onClick={() => {
                if (debouncedSearch) void searchResults.refetch();
                else void appointments.refetch();
              }}
            >
              Retry
            </button>
          </div>
        ) : rows.length ? (
          <div className="divide-y divide-neutral-100">
            {rows.map((item) => (
              <article
                key={item.id}
                className="flex flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center lg:justify-between"
              >
                <div className="flex min-w-0 items-start gap-4">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent-50 text-accent-700">
                    <CalendarClock size={19} />
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium text-neutral-900">
                      {item.student?.name ?? 'Deleted student'}{' '}
                      <span className="font-normal text-neutral-500">with</span> {item.instructor_name}
                    </p>
                    <p className="mt-1 text-sm text-neutral-500">
                      {formatInTimeZone(new Date(item.starts_at), item.instructor_timezone, 'EEE, MMM d · h:mm a zzz')}
                      {item.student?.email ? ` · ${item.student.email}` : ''}
                    </p>
                    {item.meeting_url && (
                      <a
                        href={item.meeting_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent-50 px-3 text-sm font-semibold text-accent-800 hover:bg-accent-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600"
                      >
                        <ExternalLink size={15} />
                        Join demo
                      </a>
                    )}
                    <p className="mt-1 font-mono text-[10px] text-neutral-500">{item.id}</p>
                    {item.cancellation_reason && (
                      <p className="mt-2 text-sm text-neutral-600">
                        <strong>Cancellation reason:</strong> {item.cancellation_reason}
                      </p>
                    )}
                    {item.reschedule_reason && (
                      <p className="mt-1 text-sm text-neutral-600">
                        <strong>Latest reschedule reason:</strong> {item.reschedule_reason}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {item.status === 'confirmed' && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-success-50 px-2.5 py-1 text-xs font-medium text-success-700">
                      <CheckCircle2 size={13} />
                      Confirmed
                    </span>
                  )}
                  {item.status === 'completed' && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-success-50 px-2.5 py-1 text-xs font-medium text-success-700">
                      <BadgeCheck size={13} />
                      Completed
                    </span>
                  )}
                  {item.status === 'cancelled' && (
                    <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-600">
                      Cancelled
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    className="px-3 py-2 text-xs"
                    onClick={() => setSelectedNotifications(selectedNotifications === item.id ? '' : item.id)}
                  >
                    Notifications
                  </Button>
                  {canCompleteBookings && item.status === 'confirmed' && new Date(item.ends_at).getTime() <= now && (
                    <Button
                      variant="secondary"
                      className="px-3 py-2 text-xs"
                      disabled={completeResult.isLoading}
                      onClick={() => {
                        setCompleteTarget(item);
                        setCompleteError('');
                      }}
                    >
                      <BadgeCheck size={15} />
                      Mark completed
                    </Button>
                  )}
                  {item.pending_request && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-warning-50 px-2.5 py-1 text-xs font-medium text-warning-900">
                      <Hourglass size={13} aria-hidden="true" />
                      {item.pending_request.request_type === 'appointment_cancel'
                        ? 'Cancellation awaiting approval'
                        : 'Reschedule awaiting approval'}
                    </span>
                  )}
                  {canChangeBookings && item.status === 'confirmed' && !(needsApproval && item.pending_request) && (
                    <>
                      <Button
                        variant="secondary"
                        className="px-3 py-2 text-xs"
                        onClick={() => navigate(`/calendar?reschedule=${encodeURIComponent(item.id)}`)}
                      >
                        <CalendarClock size={14} />
                        {needsApproval ? 'Request reschedule' : 'Reschedule'}
                      </Button>
                      <Button
                        variant="ghost"
                        className="px-3 py-2 text-xs text-danger-700"
                        disabled={cancelResult.isLoading}
                        onClick={() => openCancelDialog(item)}
                      >
                        <X size={14} />
                        {needsApproval ? 'Request cancellation' : 'Cancel'}
                      </Button>
                    </>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="p-14 text-center text-sm text-neutral-500">
            {normalizedSearch.length === 1
              ? 'Type one more character to search appointments.'
              : 'No appointments match this view.'}
          </div>
        )}
        {selectedNotifications && (
          <div className="border-t border-neutral-100 bg-neutral-50 p-5">
            <h3 className="text-sm font-semibold text-neutral-900">Notification status</h3>
            {notifications.isLoading ? (
              <p className="mt-2 text-sm text-neutral-500">Loading…</p>
            ) : notifications.data?.length ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {notifications.data.map((item, index) => (
                  <div
                    key={`${item.event_type}-${item.recipient}-${index}`}
                    className="rounded-lg border border-neutral-200 bg-surface p-3"
                  >
                    <p className="truncate text-xs text-neutral-600">{item.recipient}</p>
                    <p className="mt-1 text-xs font-medium capitalize text-neutral-900">
                      {item.event_type} · {item.delivery_status.replace('_', ' ')}
                    </p>
                    <p className="mt-1 text-[11px] text-neutral-500">Attempts: {item.attempt_count}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-neutral-500">No notification attempts recorded yet.</p>
            )}
          </div>
        )}
      </Card>
      <Dialog
        open={canChangeBookings && Boolean(cancelTarget)}
        title={needsApproval ? 'Ask to cancel this demo class?' : 'Cancel this demo class?'}
        description={
          cancelTarget
            ? needsApproval
              ? `An administrator will review your request to cancel the class for ${cancelTarget.student?.name ?? 'Deleted student'}. The demo stays booked until it is approved, and the family is only told after approval.`
              : `Cancel the class for ${cancelTarget.student?.name ?? 'Deleted student'} with ${cancelTarget.instructor_name}. The cancellation reason will be saved and included in the email update.`
            : undefined
        }
        confirmLabel={needsApproval ? 'Send for approval' : 'Cancel demo class'}
        cancelLabel="Keep editing"
        destructive
        busy={cancelResult.isLoading}
        confirmDisabled={cancelReason.trim().length < 3}
        onClose={() => setCancelTarget(null)}
        onConfirm={() => void confirmCancel()}
      >
        <label className="block text-sm font-medium text-neutral-700">
          Reason for cancellation
          <textarea
            autoFocus
            required
            minLength={3}
            maxLength={1000}
            value={cancelReason}
            onChange={(event) => setCancelReason(event.target.value)}
            placeholder="For example, the family requested a different date."
            className="mt-2 block min-h-24 w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-sm"
          />
        </label>
        {cancelError && (
          <p role="alert" className="mt-3 text-sm text-danger-700">
            {cancelError}
          </p>
        )}
      </Dialog>
      <Dialog
        open={Boolean(completeTarget)}
        title="Mark this demo as completed?"
        description={
          completeTarget
            ? `Confirm that the demo for ${completeTarget.student?.name ?? 'Deleted student'} with ${completeTarget.instructor_name} took place. This changes its status to completed.`
            : undefined
        }
        confirmLabel="Mark completed"
        busy={completeResult.isLoading}
        onClose={() => setCompleteTarget(null)}
        onConfirm={() => void confirmComplete()}
      >
        {completeError && (
          <p role="alert" className="text-sm text-danger-700">
            {completeError}
          </p>
        )}
      </Dialog>
    </div>
  );
}
