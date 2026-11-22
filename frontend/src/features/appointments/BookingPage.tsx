import { cloneElement, useEffect, useMemo, useRef, useState, type FormEvent, type InputHTMLAttributes, type ReactElement } from 'react';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { addDays, format } from 'date-fns';
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, ExternalLink, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getCountryCode } from '@vvo/tzdb';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { TimeZoneSelect } from '../../components/ui/TimeZoneSelect';
import { useInstructorsQuery, usePublicBookingInstructorsQuery } from '../instructors/api';
import { useAvailableSlotsQuery, useCreateAppointmentMutation, useCreatePublicAppointmentMutation, usePublicAvailableSlotsQuery, usePublicBookingSettingsQuery, useSettingsQuery, type Appointment, type PublicBookingReceipt } from './api';

const schema = z.object({
  name: z.string().trim().min(1, 'Student name is required').max(160),
  parent_name: z.string().max(160).optional(),
  email: z.email({ error: 'Enter a valid email address' }),
  phone: z.string().max(40).optional(),
  country_code: z.string().regex(/^[A-Z]{2}$/, 'Choose your country'),
  timezone: z.string().min(1, 'Choose a time zone'),
  notes: z.string().max(4000).optional(),
  website: z.string().max(200).optional(),
  meeting_url: z.union([
    z.literal(''),
    z.url({ error: 'Enter a valid HTTPS meeting link' }).refine((value) => value.startsWith('https://'), 'Meeting links must use HTTPS'),
  ]).optional(),
});
type Values = z.infer<typeof schema>;
const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';

export function BookingPage({ publicMode = false }: { publicMode?: boolean } = {}) {
  const navigate = useNavigate();
  const instructors = useInstructorsQuery(undefined, { skip: publicMode });
  const publicInstructors = usePublicBookingInstructorsQuery(undefined, { skip: !publicMode });
  const availableInstructors = publicMode ? publicInstructors.data ?? [] : instructors.data?.filter((item) => item.is_available_for_booking) ?? [];
  const [instructorId, setInstructorId] = useState('');
  const [day, setDay] = useState(format(addDays(new Date(), 1), 'yyyy-MM-dd'));
  const [slot, setSlot] = useState('');
  const [duration, setDuration] = useState(60);
  const idempotencyKey = useRef<string>(crypto.randomUUID());
  const [step, setStep] = useState(1);
  const [created, setCreated] = useState<Appointment | PublicBookingReceipt | null>(null);
  const [create, result] = useCreateAppointmentMutation();
  const [createPublic, publicResult] = useCreatePublicAppointmentMutation();
  const instructor = availableInstructors.find((item) => item.id === instructorId);
  const slotArgs = { instructorId, start: day, end: day, duration };
  const privateSlotQuery = useAvailableSlotsQuery(slotArgs, {
    skip: publicMode || !instructorId || step !== 1,
    pollingInterval: 15_000,
    skipPollingIfUnfocused: true,
    refetchOnFocus: true,
  });
  const publicSlotQuery = usePublicAvailableSlotsQuery(slotArgs, {
    skip: !publicMode || !instructorId || step !== 1,
    pollingInterval: 15_000,
    skipPollingIfUnfocused: true,
    refetchOnFocus: true,
  });
  const slotQuery = publicMode ? publicSlotQuery : privateSlotQuery;
  const settings = useSettingsQuery(undefined, { skip: publicMode });
  const publicSettings = usePublicBookingSettingsQuery(undefined, { skip: !publicMode });
  const bookingBusy = publicMode ? publicResult.isLoading : result.isLoading;
  const bookingFailed = publicMode ? publicResult.isError : result.isError;
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { country_code: getCountryCode(browserZone) ?? '', timezone: browserZone, name: '', parent_name: '', email: '', phone: '', notes: '', website: '', meeting_url: '' } });
  const dates = useMemo(() => Array.from({ length: 14 }, (_unused, index) => addDays(new Date(), index + 1)), []);
  useEffect(() => {
    if (settings.data) setDuration(settings.data.demo_duration_minutes);
  }, [settings.data]);
  useEffect(() => {
    if (publicSettings.data) setDuration(publicSettings.data.demo_duration_minutes);
  }, [publicSettings.data]);

  async function confirm(values: Values) {
    if (!instructorId || !slot) return;
    const { notes, meeting_url, website, ...student } = values;
    try {
      const appointment = publicMode
        ? await createPublic({ instructor_id: instructorId, starts_at: slot, duration_minutes: duration,
          student, notes, website: website ?? '', idempotencyKey: idempotencyKey.current }).unwrap()
        : await create({ instructor_id: instructorId, starts_at: slot, duration_minutes: duration,
          student, notes, meeting_url: meeting_url?.trim() || null, idempotencyKey: idempotencyKey.current }).unwrap();
      setCreated(appointment);
      idempotencyKey.current = crypto.randomUUID();
      setStep(4);
    } catch { /* Inline error is shown in the review step. */ }
  }

  function startAnotherBooking() {
    setCreated(null);
    setStep(1);
    setInstructorId('');
    setSlot('');
    form.reset();
  }

  const date = new Date(`${day}T12:00:00`);
  return <div className="mx-auto max-w-5xl">
    <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-sm font-medium text-indigo-700">{publicMode ? 'Client booking' : 'New appointment'}</p><h2 className="mt-1 text-2xl font-semibold tracking-tight text-heading">Schedule a demo class</h2><p className="mt-1 text-sm text-slate-500">Choose a coach and time, then add the student details.</p></div>{step < 4 && <Button type="button" variant="secondary" className="w-full shrink-0 sm:w-auto" onClick={() => { if (step > 1) setStep((current) => current - 1); else if (publicMode) navigate(-1); else navigate('/appointments'); }}><ChevronLeft size={18} />Back</Button>}</div>
    {publicMode && publicInstructors.isError && <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><p>Coach availability could not be loaded. Please try again.</p><Button variant="secondary" onClick={() => void publicInstructors.refetch()}>Retry</Button></div>}
    {step < 4 && <><div role="group" aria-label={`Step ${step} of 3: ${['Instructor & time', 'Student details', 'Review'][step - 1]}`} className="mb-3 rounded-lg bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-800 sm:hidden">Step {step} of 3 <span aria-hidden="true">·</span> {['Instructor & time', 'Student details', 'Review'][step - 1]}</div><div role="group" aria-label="Booking progress" className="mb-7 hidden items-center gap-3 sm:flex">{['Instructor & time', 'Student details', 'Review'].map((label, index) => <div key={label} className="flex flex-1 items-center gap-2"><span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold ${step >= index + 1 ? 'bg-action text-on-action' : 'bg-slate-200 text-slate-600'}`}>{step > index + 1 ? <Check size={14} /> : index + 1}</span><span className={`text-xs font-medium ${step === index + 1 ? 'text-slate-900' : 'text-slate-400'}`}>{label}</span>{index < 2 && <span className="h-px flex-1 bg-slate-200" />}</div>)}</div></>}
    {step === 1 && <div className="grid gap-5 lg:grid-cols-[.9fr_1.1fr]">
      <Card className="p-5 sm:p-6"><h3 className="font-semibold text-slate-900">1. Choose an instructor</h3><label className="mt-5 block text-sm font-medium text-slate-700">Available coaches<select value={instructorId} onChange={(event) => { setInstructorId(event.target.value); setSlot(''); const selected = availableInstructors.find((item) => item.id === event.target.value); form.setValue('meeting_url', !publicMode && selected && 'meeting_url' in selected && typeof selected.meeting_url === 'string' ? selected.meeting_url : '', { shouldValidate: true }); }} className="mt-2 w-full rounded-lg border border-slate-300 bg-surface px-3 py-3 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"><option value="">Select a coach</option>{availableInstructors.map((item) => <option key={item.id} value={item.id}>{item.display_name}</option>)}</select></label>
        <label className="mt-4 block text-sm font-medium text-slate-700">Demo duration<select value={duration} onChange={(event) => { setDuration(Number(event.target.value)); setSlot(''); }} className="mt-2 w-full rounded-lg border border-slate-300 bg-surface px-3 py-3">{[...new Set([30,45,60,90,120,settings.data?.demo_duration_minutes ?? 60])].sort((a,b) => a-b).map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes{settings.data?.demo_duration_minutes === minutes ? ' · academy default' : ''}</option>)}</select></label>
        {instructor && <><div className="mt-4 rounded-xl bg-slate-50 p-4"><p className="font-medium text-slate-800">{instructor.display_name}</p><p className="mt-1 text-xs text-slate-500">Times shown in {instructor.timezone}</p></div>{!publicMode && <div className="mt-4"><Field label="Meeting link for this demo (optional)" error={form.formState.errors.meeting_url?.message}><input {...form.register('meeting_url')} type="url" autoComplete="url" placeholder="https://meet.google.com/..." /></Field><p className="mt-1 text-xs text-slate-500">{'meeting_url' in instructor && instructor.meeting_url ? 'Pre-filled from this coach. Change it for this demo or clear it to omit the link.' : 'No default link is set for this coach. Add a link for this demo, or leave it blank.'}</p></div>}</>}
        <h3 className="mt-7 font-semibold text-slate-900">2. Choose a date</h3><div className="mt-3 grid grid-cols-4 gap-2">{dates.map((item) => { const key = format(item, 'yyyy-MM-dd'); const active = key === day; return <button key={key} onClick={() => { setDay(key); setSlot(''); }} className={`rounded-xl border px-2 py-3 text-center transition ${active ? 'border-indigo-600 bg-indigo-50 text-indigo-800 ring-1 ring-indigo-600' : 'border-slate-200 text-slate-700 hover:border-indigo-300'}`}><span className="block text-[11px] text-slate-500">{format(item, 'EEE')}</span><span className="mt-1 block text-lg font-semibold">{format(item, 'd')}</span><span className="text-[11px] text-slate-500">{format(item, 'MMM')}</span></button>; })}</div>
      </Card>
      <Card className="p-5 sm:p-6"><div className="flex items-start justify-between"><div><h3 className="font-semibold text-slate-900">3. Pick a time</h3><p className="mt-1 text-sm text-slate-500">{format(date, 'EEEE, MMMM d')} · {duration} minute demo</p><p className="mt-1 text-xs text-slate-500">Availability refreshes every 15 seconds while this page is open.</p></div><span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-50 text-indigo-700"><Clock3 size={19} /></span></div>
        {!instructorId ? <EmptySlots>Select an instructor to see available times.</EmptySlots> : slotQuery.isFetching ? <div aria-label="Loading available times" className="mt-7 grid grid-cols-3 gap-2">{Array.from({ length: 9 }, (_, i) => <div key={i} className="h-11 animate-pulse rounded-lg bg-slate-100" />)}</div> : slotQuery.isError ? <div role="alert" className="mt-7 rounded-lg bg-rose-50 p-4 text-sm text-rose-700"><p>Could not load available times.</p><Button variant="secondary" className="mt-3" onClick={() => void slotQuery.refetch()}>Retry</Button></div> : slotQuery.currentData?.slots.length ? <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3">{slotQuery.currentData.slots.map((value) => <button key={value} type="button" onClick={() => setSlot(value)} className={`min-h-11 rounded-lg border px-3 py-3 text-sm font-semibold ${slot === value ? 'border-indigo-600 bg-action text-on-action' : 'border-slate-200 text-indigo-700 hover:border-indigo-400 hover:bg-indigo-50'}`}>{new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: instructor?.timezone })}</button>)}</div> : <EmptySlots>No times available this day. Choose another date or instructor.</EmptySlots>}
        <div className="mt-8 flex justify-end"><Button className="w-full sm:w-auto" disabled={!slot} onClick={() => setStep(2)}>Continue <ChevronRight size={16} /></Button></div>
      </Card>
    </div>}
    {step === 2 && <Card className="mx-auto max-w-2xl p-5 sm:p-8"><div className="flex items-center gap-3 rounded-xl bg-indigo-50 p-4"><UserRound className="text-indigo-700" /><div><p className="font-medium text-indigo-950">{instructor?.display_name}</p><p className="text-sm text-indigo-800">{new Date(slot).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short', timeZone: instructor?.timezone })} · {instructor?.timezone}</p></div></div><h3 className="mt-7 text-lg font-semibold text-slate-900">Student and parent details</h3><form onSubmit={(event: FormEvent) => { event.preventDefault(); void form.handleSubmit(() => setStep(3))(); }} className="mt-5 grid gap-4 sm:grid-cols-2">
      {publicMode && <div className="absolute -left-[10000px] h-px w-px overflow-hidden" aria-hidden="true"><label>Leave this field blank<input {...form.register('website')} autoComplete="off" tabIndex={-1} /></label></div>}<Field label="Student name" error={form.formState.errors.name?.message}><input {...form.register('name')} autoComplete="name" /></Field><Field label="Parent / guardian name (optional)" error={form.formState.errors.parent_name?.message}><input {...form.register('parent_name')} /></Field><Field label="Contact email" error={form.formState.errors.email?.message}><input {...form.register('email')} type="email" autoComplete="email" /></Field><Field label="Phone (optional)" error={form.formState.errors.phone?.message}><input {...form.register('phone')} type="tel" autoComplete="tel" /></Field><div className="sm:col-span-2"><TimeZoneSelect required countryCode={form.watch('country_code')} timezone={form.watch('timezone')} onCountryCodeChange={(value) => { form.setValue('country_code', value, { shouldValidate: true }); form.setValue('timezone', '', { shouldValidate: true }); }} onTimezoneChange={(value) => form.setValue('timezone', value, { shouldValidate: true })} countryLabel="Student's country" timezoneLabel="Student time zone" />{(form.formState.errors.country_code?.message || form.formState.errors.timezone?.message) && <p role="alert" className="mt-1 text-xs text-rose-600">{form.formState.errors.country_code?.message || form.formState.errors.timezone?.message}</p>}</div><Field label="Notes for instructor (optional)" error={form.formState.errors.notes?.message}><input {...form.register('notes')} /></Field>
      <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{form.watch('meeting_url') ? 'The meeting link will appear in the booking details and email notifications.' : 'No meeting link is attached. The academy can coordinate meeting details separately.'}</div>
      <div className="sm:col-span-2 flex justify-end border-t border-slate-100 pt-4"><Button type="submit" className="w-full sm:w-auto">Review booking <ChevronRight size={16} /></Button></div></form></Card>}
    {step === 3 && <Card className="mx-auto max-w-2xl p-5 sm:p-8"><h3 className="text-lg font-semibold text-slate-900">Review your demo class</h3><p className="mt-1 text-sm text-slate-500">Check the details before confirming.</p><div className="mt-5 divide-y divide-slate-100 rounded-xl border border-slate-200">{[['Student', form.getValues('name')], ['Contact', form.getValues('email')], ['Instructor', instructor?.display_name ?? ''], ['Date and time', new Date(slot).toLocaleString([], { dateStyle: 'full', timeStyle: 'short', timeZone: instructor?.timezone })], ['Time zone', instructor?.timezone ?? ''], ...(!publicMode ? [['Meeting link', form.getValues('meeting_url') || 'Not set']] : [])].map(([label, value]) => <div key={label} className="grid grid-cols-[100px_1fr] gap-3 px-4 py-3 text-sm sm:grid-cols-[120px_1fr]"><span className="text-slate-500">{label}</span><span className="break-words font-medium text-slate-900">{label === 'Meeting link' && value !== 'Not set' ? <a href={value} target="_blank" rel="noopener noreferrer" className="underline decoration-indigo-300 underline-offset-2 hover:text-indigo-700">{value}</a> : value}</span></div>)}</div>{bookingFailed && <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">This slot may have just been booked. Review availability and try again.</p>}<div className="mt-6 flex justify-end border-t border-slate-100 pt-4"><Button className="w-full sm:w-auto" disabled={bookingBusy} onClick={() => void confirm(form.getValues())}>{bookingBusy ? 'Booking…' : 'Confirm demo class'}</Button></div></Card>}
    {step === 4 && created && <Card className="mx-auto max-w-xl p-8 text-center"><span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-emerald-700"><Check size={25} /></span><h3 className="mt-5 text-xl font-semibold text-slate-900">Demo class booked</h3><p className="mt-2 text-sm leading-6 text-slate-500">Booking notifications have been queued for the coach and client contact. {created.meeting_url ? 'The meeting link is included in the booking details and notifications.' : 'The academy can coordinate meeting details separately.'} Reference: <span className="font-mono text-slate-700">{created.id.slice(0, 8)}</span></p>{created.meeting_url && <a href={created.meeting_url} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-indigo-50 px-4 text-sm font-semibold text-indigo-800 hover:bg-indigo-100"><ExternalLink size={16} />Open meeting link</a>}<Button variant="secondary" className="mt-6 w-full sm:w-auto" onClick={() => publicMode ? startAnotherBooking() : navigate('/calendar')}>{publicMode ? 'Book another demo' : 'View calendar'}</Button></Card>}
  </div>;
}

function EmptySlots({ children }: { children: string }) { return <div className="mt-9 rounded-xl border border-dashed border-slate-300 py-12 text-center text-sm text-slate-500"><CalendarDays className="mx-auto mb-3" size={20} />{children}</div>; }
function Field({ label, error, children }: { label: string; error?: string | undefined; children: ReactElement<InputHTMLAttributes<HTMLInputElement>> }) { return <label className="block text-sm font-medium text-slate-700">{label}{cloneElement(children, { className: `mt-2 w-full rounded-lg border ${error ? 'border-rose-400' : 'border-slate-300'} bg-surface px-3 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100` })}{error && <span className="mt-1 block text-xs text-rose-600">{error}</span>}</label>; }
