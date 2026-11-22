import { useEffect, useMemo, useRef, useState } from 'react';
import { formatInTimeZone } from 'date-fns-tz';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { EventApi } from '@fullcalendar/core';
import { BadgeCheck, CalendarClock, CheckCircle2, ChevronLeft, Clock3, ExternalLink, X, XCircle } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Dialog } from '../../components/ui/Dialog';
import { useAppointmentsQuery, useAppointmentQuery, useAvailableSlotsQuery, useCompleteAppointmentMutation, useRescheduleAppointmentMutation } from './api';
import { useInstructorsQuery } from '../instructors/api';
import { useMeQuery } from '../auth/api';
import { isPendingReceipt } from '../requests/api';
import { apiErrorDetail } from '../../lib/apiError';

export function CalendarPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [isMobileCalendar, setIsMobileCalendar] = useState(() => window.matchMedia('(max-width: 639px)').matches);
  const [instructorId, setInstructorId] = useState('');
  const [status, setStatus] = useState('');
  const [calendarRange, setCalendarRange] = useState<{ start: string; end: string } | null>(null);
  const [rescheduleDay, setRescheduleDay] = useState('');
  const [selectedSlot, setSelectedSlot] = useState('');
  const [reason, setReason] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);
  const [completeError, setCompleteError] = useState('');
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [hoverPreview, setHoverPreview] = useState<{ title: string; status: string; when: string; left: number; top: number } | null>(null);
  const instructors = useInstructorsQuery();
  const currentUser = useMeQuery();
  const canManageBookings = currentUser.data?.role === 'admin';
  const canCompleteBookings = currentUser.data?.role === 'admin' || currentUser.data?.role === 'instructor';
  // Coaches may propose a new time; an administrator approves it before anything changes.
  const needsApproval = currentUser.data?.role === 'instructor';
  const canReschedule = canManageBookings || needsApproval;
  const appointments = useAppointmentsQuery({
    ...(instructorId ? { instructor_id: instructorId } : {}),
    ...(status ? { status } : {}),
    ...(calendarRange ?? {}),
  }, { skip: !calendarRange, pollingInterval: 15_000, skipPollingIfUnfocused: true, refetchOnFocus: true });
  const appointmentId = searchParams.get('reschedule') ?? searchParams.get('appointment');
  const focusedAppointment = useAppointmentQuery(appointmentId ?? '', { skip: !appointmentId });
  const appointment = appointmentId ? focusedAppointment.currentData : undefined;
  const selectedInstructor = instructors.data?.find((item) => item.id === instructorId);
  const calendarTimeZone = selectedInstructor?.timezone
    ?? (currentUser.data?.role === 'instructor' ? currentUser.data.instructor_profile?.timezone : undefined)
    ?? 'local';
  const appointmentStart = appointment?.starts_at;
  const appointmentTimezone = appointment?.instructor_timezone;
  const appointmentEndAt = appointment?.ends_at;
  const appointmentStatus = appointment?.status;
  const duration = appointment ? Math.round((new Date(appointment.ends_at).getTime() - new Date(appointment.starts_at).getTime()) / 60000) : undefined;
  const slots = useAvailableSlotsQuery({
    instructorId: appointment?.instructor_id ?? '',
    start: rescheduleDay,
    end: rescheduleDay,
    ...(duration !== undefined ? { duration } : {}),
    ...(appointment?.id ? { excludeAppointmentId: appointment.id } : {}),
  }, { skip: !searchParams.has('reschedule') || !appointment || !rescheduleDay || appointment.status !== 'confirmed' });
  const [reschedule, rescheduleResult] = useRescheduleAppointmentMutation();
  const calendarRef = useRef<FullCalendar>(null);
  const [complete, completeResult] = useCompleteAppointmentMutation();
  const isRescheduling = searchParams.has('reschedule');
  const appointmentRows = useMemo(() => appointments.currentData ?? [], [appointments.currentData]);
  const todayInCoachTimezone = appointmentTimezone
    ? formatInTimeZone(new Date(), appointmentTimezone, 'yyyy-MM-dd')
    : undefined;

  function showEventPreview(element: HTMLElement, event: EventApi) {
    if (!window.matchMedia('(hover: hover)').matches) return;
    const bounds = element.getBoundingClientRect();
    const left = Math.min(Math.max(12, bounds.left), window.innerWidth - 300);
    const top = bounds.bottom + 132 < window.innerHeight ? bounds.bottom + 8 : Math.max(8, bounds.top - 124);
    const timeZone = calendarTimeZone === 'local' ? Intl.DateTimeFormat().resolvedOptions().timeZone : calendarTimeZone;
    const when = event.start
      ? `${formatInTimeZone(event.start, timeZone, 'EEE, MMM d · h:mm a')}${event.end ? ` – ${formatInTimeZone(event.end, timeZone, 'h:mm a')}` : ''}`
      : '';
    setHoverPreview({
      title: event.title,
      status: String(event.extendedProps.status),
      when,
      left,
      top,
    });
  }

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 639px)');
    const updateViewForViewport = (event: MediaQueryListEvent) => setIsMobileCalendar(event.matches);
    mediaQuery.addEventListener('change', updateViewForViewport);
    return () => mediaQuery.removeEventListener('change', updateViewForViewport);
  }, []);

  useEffect(() => {
    if (appointmentStart && appointmentTimezone && isRescheduling) {
      setRescheduleDay(formatInTimeZone(new Date(appointmentStart), appointmentTimezone, 'yyyy-MM-dd'));
      setSelectedSlot('');
      setReason('');
      setActionError('');
    }
  }, [appointmentStart, appointmentTimezone, isRescheduling]);

  // Opening a demo from a link or the list should show the week it is in, not just today's week.
  useEffect(() => {
    if (appointmentStart) calendarRef.current?.getApi().gotoDate(appointmentStart);
  }, [appointmentStart]);

  useEffect(() => {
    if (!appointmentEndAt || appointmentStatus !== 'confirmed') return;
    const remaining = new Date(appointmentEndAt).getTime() - Date.now();
    if (remaining <= 0) {
      setClockNow(Date.now());
      return;
    }
    const timer = window.setTimeout(() => setClockNow(Date.now()), remaining + 1);
    return () => window.clearTimeout(timer);
  }, [appointmentEndAt, appointmentStatus]);

  const events = useMemo(() => appointmentRows.map((item) => ({
    id: item.id,
    title: `${item.student?.name ?? 'Deleted student'} · ${item.instructor_name}`,
    start: item.starts_at,
    end: item.ends_at,
    classNames: [`calendar-event-${item.status}`],
    extendedProps: { status: item.status, instructorName: item.instructor_name },
  })), [appointmentRows]);
  const statusCounts = useMemo(() => appointmentRows.reduce((counts, item) => {
    counts[item.status] += 1;
    return counts;
  }, { confirmed: 0, cancelled: 0, completed: 0 }), [appointmentRows]);

  async function submitReschedule() {
    if (!appointment || !selectedSlot || reason.trim().length < 3) return;
    setActionError('');
    try {
      const result = await reschedule({ id: appointment.id, starts_at: selectedSlot, reason: reason.trim() }).unwrap();
      setNotice(isPendingReceipt(result)
        ? 'Reschedule request sent. The demo stays at its current time until an administrator approves it.'
        : 'Demo rescheduled. The coach and client were sent an update.');
      setSearchParams({ appointment: appointment.id }, { replace: true });
      setSelectedSlot('');
    } catch (error) {
      setActionError(apiErrorDetail(error) ?? 'That time is no longer available. Choose another slot and try again.');
    }
  }

  function closeFocusedAppointment() {
    setSearchParams({}, { replace: true });
    setActionError('');
    setCompleteDialogOpen(false);
    setCompleteError('');
  }

  async function confirmComplete() {
    if (!appointment) return;
    setCompleteError('');
    try {
      await complete(appointment.id).unwrap();
      setCompleteDialogOpen(false);
      setNotice('Demo marked as completed.');
    } catch {
      setCompleteError('This demo could not be marked complete. It may still be in progress or may have been cancelled.');
    }
  }

  return <div className="space-y-5">
    <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><h2 className="text-2xl font-semibold tracking-tight text-heading">Class calendar</h2><p className="mt-1 text-sm text-slate-500">Hover a class for a quick preview, or click/tap it to open details. Busy days show a “more” list so every booking stays selectable.</p></div><div className="grid gap-2 sm:flex"><select aria-label="Filter calendar by instructor" value={instructorId} onChange={(event) => setInstructorId(event.target.value)} className="w-full rounded-lg border border-slate-300 bg-surface px-3 text-sm sm:w-auto"><option value="">All instructors</option>{instructors.data?.map((item) => <option key={item.id} value={item.id}>{item.display_name}</option>)}</select><select aria-label="Filter calendar by status" value={status} onChange={(event) => setStatus(event.target.value)} className="w-full rounded-lg border border-slate-300 bg-surface px-3 text-sm sm:w-auto"><option value="">All statuses</option><option value="confirmed">Confirmed</option><option value="cancelled">Cancelled</option><option value="completed">Completed</option></select></div></div>

    {notice && <p role="status" className="ui-enter rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    {appointmentId && focusedAppointment.isLoading && <Card className="p-5"><p className="text-sm text-slate-500">Loading demo details…</p></Card>}
    {appointmentId && focusedAppointment.isError && <Card className="p-5"><p role="alert" className="text-sm text-rose-700">This demo could not be loaded. Return to the appointments list and try again.</p><Button variant="secondary" className="mt-3" onClick={closeFocusedAppointment}><ChevronLeft size={15} />Calendar</Button></Card>}
    {currentUser.isSuccess && isRescheduling && !canReschedule && <Card className="p-5"><p role="alert" className="text-sm text-rose-700">Only an administrator can reschedule demo classes.</p><Button variant="secondary" className="mt-3" onClick={closeFocusedAppointment}><ChevronLeft size={15} />Calendar</Button></Card>}
    {appointment && !isRescheduling && <Card className="ui-enter p-5 sm:p-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Demo details</p><h3 className="mt-1 text-lg font-semibold text-heading">{appointment.student?.name ?? 'Deleted student'} with {appointment.instructor_name}</h3><p className="mt-1 text-sm text-slate-600">{formatInTimeZone(new Date(appointment.starts_at), appointment.instructor_timezone, 'EEEE, MMMM d, yyyy · h:mm a zzz')}</p><p className="mt-1 text-xs text-slate-500">Coach time zone: {appointment.instructor_timezone}{appointment.student?.email ? ` · ${appointment.student.email}` : ''}</p>{appointment.meeting_url && <a href={appointment.meeting_url} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg bg-action px-4 text-sm font-semibold text-white shadow-sm hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"><ExternalLink size={16} />Open meeting link</a>}{appointment.cancellation_reason && <p className="mt-3 text-sm text-slate-600"><strong>Cancellation reason:</strong> {appointment.cancellation_reason}</p>}{appointment.reschedule_reason && <p className="mt-2 text-sm text-slate-600"><strong>Latest reschedule reason:</strong> {appointment.reschedule_reason}</p>}</div><div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" onClick={closeFocusedAppointment}><X size={15} />Close details</Button>{canCompleteBookings && appointment.status === 'confirmed' && new Date(appointment.ends_at).getTime() <= clockNow && <Button type="button" variant="secondary" onClick={() => { setCompleteError(''); setCompleteDialogOpen(true); }}><BadgeCheck size={16} />Mark completed</Button>}{canReschedule && appointment.status === 'confirmed' && <Button onClick={() => { setNotice(''); setSearchParams({ reschedule: appointment.id }); }}><CalendarClock size={15} />{needsApproval ? 'Request reschedule' : 'Reschedule'}</Button>}</div></div>
    </Card>}

    {isRescheduling && appointment && canReschedule && <Card className="ui-enter p-5 sm:p-6">
      <Button type="button" variant="secondary" onClick={closeFocusedAppointment} className="mb-4"><X size={16} />Cancel rescheduling</Button>
      <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">{needsApproval ? 'Request a new time' : 'Reschedule demo'}</p>
      <h3 className="mt-1 text-lg font-semibold text-heading">{appointment.student?.name ?? 'Deleted student'} with {appointment.instructor_name}</h3>
      <p className="mt-1 text-sm text-slate-600">Choose a new time in {appointment.instructor_timezone}. {needsApproval ? ' An administrator must approve the new time; the current booking stays active until then.' : ' The current booking will remain active until you confirm.'}</p>
      {appointment.status !== 'confirmed' ? <p role="alert" className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Only confirmed demos can be rescheduled.</p> : <div className="mt-5 grid gap-5 lg:grid-cols-[220px_1fr]">
        <label className="text-sm font-medium text-slate-700">New date<input aria-label="New demo date" type="date" min={todayInCoachTimezone} value={rescheduleDay} onChange={(event) => { setRescheduleDay(event.target.value); setSelectedSlot(''); }} className="mt-2 block w-full rounded-lg border border-slate-300 bg-surface px-3 py-2.5" /></label>
        <div><h4 className="text-sm font-medium text-slate-700">Available times</h4>{slots.isFetching ? <p role="status" className="mt-2 text-sm text-slate-500">Finding available times…</p> : slots.isError ? <div role="alert" className="mt-2 text-sm text-rose-700"><p>Availability could not be loaded.</p><Button variant="secondary" className="mt-2" onClick={() => void slots.refetch()}>Retry</Button></div> : slots.currentData?.slots.length ? <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">{slots.currentData.slots.map((value) => <button key={value} type="button" onClick={() => setSelectedSlot(value)} className={`min-h-11 rounded-lg border px-3 py-2.5 text-sm font-semibold ${selectedSlot === value ? 'border-indigo-600 bg-action text-white' : 'border-slate-200 text-indigo-700 hover:border-indigo-400 hover:bg-indigo-50'}`}><Clock3 className="mr-1 inline" size={14} />{new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: appointment.instructor_timezone })}</button>)}</div> : <p className="mt-2 text-sm text-slate-500">No open slots on this date.</p>}</div>
      </div>}
      {appointment.status === 'confirmed' && <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end"><label className="block text-sm font-medium text-slate-700">Reason for rescheduling<textarea required minLength={3} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="For example, the coach is unavailable at the original time." className="mt-2 block min-h-24 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /></label><Button className="w-full sm:w-auto" disabled={!selectedSlot || reason.trim().length < 3 || rescheduleResult.isLoading} onClick={() => void submitReschedule()}>{rescheduleResult.isLoading ? 'Saving…' : needsApproval ? 'Send for approval' : 'Confirm new time'}</Button></div>}
      {actionError && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{actionError}</p>}
    </Card>}

    <Dialog
      open={completeDialogOpen}
      title="Mark this demo as completed?"
      description={appointment ? `Confirm that the demo for ${appointment.student?.name ?? 'Deleted student'} with ${appointment.instructor_name} took place. Its status will change to completed.` : undefined}
      confirmLabel="Mark completed"
      busy={completeResult.isLoading}
      onClose={() => setCompleteDialogOpen(false)}
      onConfirm={() => void confirmComplete()}
    >
      {completeError && <p role="alert" className="text-sm text-rose-700">{completeError}</p>}
    </Dialog>

    {appointments.isError && <p role="alert" className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">Calendar events could not be loaded.</p>}
    <div className="grid grid-cols-3 gap-2 sm:gap-3">
      <Card className="flex flex-col items-center gap-0.5 p-2 text-center sm:flex-row sm:gap-3 sm:p-4 sm:text-left"><span className="hidden h-9 w-9 shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-700 sm:grid"><CalendarClock size={17} /></span><div><p className="text-[11px] text-slate-500 sm:text-xs">Confirmed</p><p className="text-lg font-semibold text-slate-900">{statusCounts.confirmed}</p></div></Card>
      <Card className="flex flex-col items-center gap-0.5 p-2 text-center sm:flex-row sm:gap-3 sm:p-4 sm:text-left"><span className="hidden h-9 w-9 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700 sm:grid"><CheckCircle2 size={17} /></span><div><p className="text-[11px] text-slate-500 sm:text-xs">Completed</p><p className="text-lg font-semibold text-slate-900">{statusCounts.completed}</p></div></Card>
      <Card className="flex flex-col items-center gap-0.5 p-2 text-center sm:flex-row sm:gap-3 sm:p-4 sm:text-left"><span className="hidden h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600 sm:grid"><XCircle size={17} /></span><div><p className="text-[11px] text-slate-500 sm:text-xs">Cancelled</p><p className="text-lg font-semibold text-slate-900">{statusCounts.cancelled}</p></div></Card>
    </div>
    <p className="text-xs text-slate-500">Calendar times shown in {calendarTimeZone === 'local' ? 'your device time zone' : calendarTimeZone}. New bookings appear automatically within 15 seconds while this page is open.</p>
    <Card className="min-w-0 overflow-hidden p-3 sm:p-6">
      {appointments.isError && <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">Calendar events could not be loaded.<Button variant="secondary" onClick={() => void appointments.refetch()}>Retry</Button></div>}
      <div className="calendar-theme"><FullCalendar ref={calendarRef} key={isMobileCalendar ? 'mobile-calendar' : 'desktop-calendar'} plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]} initialView={isMobileCalendar ? 'timeGridDay' : 'timeGridWeek'} timeZone={calendarTimeZone} headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' }} datesSet={(range) => setCalendarRange((current) => current?.start === range.startStr && current.end === range.endStr ? current : { start: range.startStr, end: range.endStr })} events={events} eventContent={(arg) => { const statusLabel = arg.event.extendedProps.status === 'cancelled' ? 'Cancelled · ' : arg.event.extendedProps.status === 'completed' ? 'Completed · ' : ''; return <div className="min-w-0 overflow-hidden"><span className="block truncate text-[10px] font-semibold">{arg.timeText}</span><span className="block truncate text-xs font-medium">{statusLabel}{arg.event.title}</span></div>; }} eventDidMount={({ el, event }) => { const status = String(event.extendedProps.status); const spokenStatus = status.charAt(0).toUpperCase() + status.slice(1); const eventTime = event.start?.toLocaleString(undefined, { timeZone: calendarTimeZone === 'local' ? undefined : calendarTimeZone }) ?? ''; const label = `${event.title}, ${spokenStatus}, ${eventTime}. Select to view booking details.`; el.setAttribute('role', 'button'); el.setAttribute('aria-label', label); el.setAttribute('tabindex', '0'); el.addEventListener('focus', () => showEventPreview(el, event)); el.addEventListener('blur', () => setHoverPreview(null)); el.addEventListener('keydown', (keyboardEvent) => { if (keyboardEvent.key === 'Enter' || keyboardEvent.key === ' ') { keyboardEvent.preventDefault(); el.click(); } }); }} eventMouseEnter={(info) => showEventPreview(info.el, info.event)} eventMouseLeave={() => setHoverPreview(null)} eventClick={(info) => { setHoverPreview(null); setNotice(''); setSearchParams({ appointment: info.event.id }); }} height="auto" nowIndicator allDaySlot={false} expandRows stickyHeaderDates eventDisplay="block" dayMaxEvents={3} eventMaxStack={3} moreLinkClick="popover" eventTimeFormat={{ hour: 'numeric', minute: '2-digit', meridiem: 'short' }} /></div>
    </Card>
    <div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-500"><span className="inline-flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-action" />Confirmed</span><span className="inline-flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-slate-400" />Cancelled</span><span className="inline-flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-emerald-600" />Completed</span></div>
    {hoverPreview && <div role="tooltip" className="pointer-events-none fixed z-[70] w-72 rounded-xl border border-slate-200 bg-surface p-4 shadow-2xl" style={{ left: hoverPreview.left, top: hoverPreview.top }}><div className="flex items-center justify-between gap-3"><span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Booking preview</span><span className="rounded-full bg-indigo-50 px-2 py-1 text-[10px] font-semibold capitalize text-indigo-800">{hoverPreview.status}</span></div><p className="mt-2 text-sm font-semibold text-heading">{hoverPreview.title}</p><p className="mt-1 text-xs text-slate-600">{hoverPreview.when}</p><p className="mt-3 border-t border-slate-100 pt-2 text-[11px] text-slate-500">Click or press Enter to open details</p></div>}
  </div>;
}
