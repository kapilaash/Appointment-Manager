import { useEffect, useState, type FormEvent } from 'react';
import { getCountryCode } from '@vvo/tzdb';
import { Plus, Save, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { TimeZoneSelect } from '../../components/ui/TimeZoneSelect';
import { useAddExceptionMutation, useAvailabilityQuery, useDeleteExceptionMutation, useInstructorsQuery, useSaveAvailabilityMutation, useUpdateInstructorMutation, type AvailabilityRule } from '../instructors/api';

const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const blank: AvailabilityRule = { day_of_week: 0, start_local_time: '09:00', end_local_time: '17:00' };

export function AvailabilityPage() {
  const instructors = useInstructorsQuery();
  const [selectedId, setSelectedId] = useState('');
  const instructor = instructors.data?.find((item) => item.id === selectedId) ?? instructors.data?.[0];
  const instructorId = instructor?.id;
  const instructorTimezone = instructor?.timezone;
  const instructorCountryCode = instructor?.country_code;
  const availability = useAvailabilityQuery(instructor?.id ?? '', { skip: !instructor?.id });
  const [rules, setRules] = useState<AvailabilityRule[]>([]);
  const [save, saveResult] = useSaveAvailabilityMutation();
  const [updateInstructor, timezoneResult] = useUpdateInstructorMutation();
  const [addException, exceptionResult] = useAddExceptionMutation();
  const [deleteException, deleteExceptionResult] = useDeleteExceptionMutation();
  const [exceptionDate, setExceptionDate] = useState('');
  const [exceptionStart, setExceptionStart] = useState('');
  const [exceptionEnd, setExceptionEnd] = useState('');
  const [exceptionType, setExceptionType] = useState<'unavailable' | 'additional_available'>('unavailable');
  const [reason, setReason] = useState('');
  const [timezoneDraft, setTimezoneDraft] = useState('');
  const [countryCodeDraft, setCountryCodeDraft] = useState('');
  const [availabilityError, setAvailabilityError] = useState('');
  const [exceptionError, setExceptionError] = useState('');

  useEffect(() => { if (availability.currentData) setRules(availability.currentData.rules.map((rule) => ({ ...rule }))); }, [availability.currentData]);
  useEffect(() => {
    if (instructorTimezone) {
      setTimezoneDraft(instructorTimezone);
      setCountryCodeDraft(instructorCountryCode ?? getCountryCode(instructorTimezone) ?? '');
    }
  }, [instructorId, instructorTimezone, instructorCountryCode]);
  const rulesFor = (day: number) => rules.map((rule, index) => ({ rule, index })).filter(({ rule }) => rule.day_of_week === day);

  function addRule(day: number) { setRules([...rules, { ...blank, day_of_week: day }]); }
  function editRule(index: number, key: 'start_local_time' | 'end_local_time', value: string) {
    setRules(rules.map((item, i) => i === index ? { ...item, [key]: value } : item));
  }
  function removeRule(index: number) { setRules(rules.filter((_item, i) => i !== index)); }
  async function saveRules() {
    if (!instructor) return;
    setAvailabilityError('');
    try { await save({ id: instructor.id, rules }).unwrap(); }
    catch { setAvailabilityError('Weekly availability could not be saved. Check each time range and try again.'); }
  }
  async function setTimezone() {
    if (!instructor || (timezoneDraft === instructor.timezone && countryCodeDraft === instructor.country_code)) return;
    try { await updateInstructor({ id: instructor.id, timezone: timezoneDraft, country_code: countryCodeDraft }).unwrap(); }
    catch { /* The inline error state explains that the time zone did not save. */ }
  }
  async function submitException(event: FormEvent) {
    event.preventDefault(); if (!instructor || !exceptionDate) return;
    setExceptionError('');
    try {
      await addException({ id: instructor.id, exception_date: exceptionDate, exception_type: exceptionType,
        start_local_time: exceptionStart || null, end_local_time: exceptionEnd || null, reason }).unwrap();
      setExceptionDate(''); setExceptionStart(''); setExceptionEnd(''); setReason('');
    } catch { setExceptionError('The exception could not be saved. Check the selected date and time range.'); }
  }
  async function removeException(exceptionId: string) {
    if (!instructor) return;
    setExceptionError('');
    try { await deleteException({ instructorId: instructor.id, exceptionId }).unwrap(); }
    catch { setExceptionError('The availability exception could not be removed. Refresh and try again.'); }
  }

  function copyPreviousDay(day: number) {
    const previous = rules.filter((rule) => rule.day_of_week === day - 1);
    setRules([...rules.filter((rule) => rule.day_of_week !== day), ...previous.map((rule) => ({ ...rule, day_of_week: day }))]);
  }

  if (instructors.isLoading) return <div className="h-64 animate-pulse rounded-2xl bg-surface" />;
  if (instructors.isError) return <div role="alert" className="rounded-lg bg-rose-50 p-4 text-sm text-rose-700">Coach profiles could not be loaded. Refresh and try again.</div>;
  return <div className="space-y-6">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><h2 className="text-2xl font-semibold tracking-tight text-heading">Weekly availability</h2><p className="mt-1 text-sm text-slate-500">Set your recurring coaching hours and add date-specific time off.</p></div>{instructors.data && instructors.data.length > 1 && <label className="w-full text-sm font-medium text-slate-700 sm:w-auto">View coach<select aria-label="View coach availability" value={instructor?.id} onChange={(event) => setSelectedId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-surface px-3 text-sm sm:min-w-52">{instructors.data.map((item) => <option key={item.id} value={item.id}>{item.display_name}</option>)}</select></label>}</div>
    {availability.isError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-rose-50 p-4 text-sm text-rose-700"><span>Availability could not be loaded from the database. {availability.isError && 'Retry the request or check the API connection.'}</span><Button variant="secondary" onClick={() => void availability.refetch()}>Retry</Button></div>}
    {instructor && <><Card className="p-5 sm:p-6"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><h3 className="font-semibold text-slate-900">Coach country and time zone</h3><p className="mt-1 text-sm text-slate-500">Weekly hours follow the selected IANA region, including daylight saving changes.</p></div><div className="w-full max-w-3xl"><TimeZoneSelect required countryCode={countryCodeDraft} timezone={timezoneDraft} onCountryCodeChange={setCountryCodeDraft} onTimezoneChange={setTimezoneDraft} countryLabel="Country where the coach lives" timezoneLabel="Coach time zone" /><div className="mt-3 flex justify-end"><Button variant="secondary" className="w-full sm:w-auto" onClick={() => void setTimezone()} disabled={!timezoneDraft || (timezoneDraft === instructor.timezone && countryCodeDraft === instructor.country_code) || timezoneResult.isLoading}>{timezoneResult.isLoading ? 'Saving…' : 'Save country and time zone'}</Button></div></div></div>{timezoneResult.isError && <p role="alert" className="mt-3 text-sm text-rose-700">Time zone could not be saved. Choose a valid country and region, then retry.</p>}</Card>
    <Card className="divide-y divide-slate-100 overflow-hidden">{weekdays.map((day, index) => <div key={day} className="grid gap-3 px-5 py-4 sm:grid-cols-[130px_1fr] sm:px-6"><div className="pt-2 text-sm font-medium text-slate-800">{day}</div><div className="space-y-2">{rulesFor(index).map(({ rule, index: ruleIndex }) => <div key={ruleIndex} className="flex flex-wrap items-center gap-2"><input aria-label={`${day} start`} type="time" value={rule.start_local_time.slice(0, 5)} onChange={(event) => editRule(ruleIndex, 'start_local_time', event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /><span className="text-slate-400">to</span><input aria-label={`${day} end`} type="time" value={rule.end_local_time.slice(0, 5)} onChange={(event) => editRule(ruleIndex, 'end_local_time', event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /><button onClick={() => removeRule(ruleIndex)} aria-label={`Remove ${day} interval`} className="rounded-md p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-700"><Trash2 size={16} /></button></div>)}{!rulesFor(index).length && <p className="py-2 text-sm text-slate-400">Unavailable</p>}<div className="flex flex-wrap items-center gap-4"><button onClick={() => addRule(index)} className="inline-flex items-center gap-1.5 py-1 text-xs font-semibold text-indigo-700 hover:text-indigo-900"><Plus size={14} />Add hours</button>{index > 0 && <button onClick={() => copyPreviousDay(index)} className="py-1 text-xs font-medium text-slate-500 hover:text-slate-800">Copy previous day</button>}</div></div></div>)}</Card>
    {saveResult.data?.warning && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{saveResult.data.warning}<ul className="mt-2 list-inside list-disc">{saveResult.data.affected_bookings.map((id) => <li key={id}><a className="underline" href={`/calendar?appointment=${id}`}>{id.slice(0, 8)}</a></li>)}</ul></div>}
    {availabilityError && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{availabilityError}</p>}
    <div className="flex justify-end"><Button className="w-full sm:w-auto" onClick={() => void saveRules()} disabled={saveResult.isLoading || availability.isError || availability.isFetching}><Save size={16} />{saveResult.isLoading ? 'Saving…' : 'Save weekly hours'}</Button></div>
    <Card className="p-5 sm:p-6"><div><h3 className="font-semibold text-slate-900">Time off and exceptions</h3><p className="mt-1 text-sm text-slate-500">Block time off or add hours for a specific date.</p></div><form onSubmit={submitException} className="mt-5 grid gap-3 sm:grid-cols-2"><input aria-label="Exception date" required type="date" value={exceptionDate} onChange={(event) => setExceptionDate(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /><select aria-label="Exception type" value={exceptionType} onChange={(event) => setExceptionType(event.target.value as 'unavailable' | 'additional_available')} className="rounded-lg border border-slate-300 bg-surface px-3 py-2.5 text-sm"><option value="unavailable">Unavailable</option><option value="additional_available">Additional available hours</option></select><input aria-label="Reason" placeholder="Reason (optional)" value={reason} onChange={(event) => setReason(event.target.value)} className="min-w-0 rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /><label className="text-xs text-slate-500">From (leave both times blank for all day)<input aria-label="Exception from" type="time" value={exceptionStart} onChange={(event) => setExceptionStart(event.target.value)} className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label><label className="text-xs text-slate-500">Until<input aria-label="Exception until" type="time" value={exceptionEnd} onChange={(event) => setExceptionEnd(event.target.value)} className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label><div><Button disabled={exceptionResult.isLoading || availability.isFetching}>Add exception</Button></div></form>{exceptionError && <p role="alert" className="mt-3 text-sm text-rose-700">{exceptionError}</p>}{exceptionResult.data?.warning && <div role="alert" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{exceptionResult.data.warning} {exceptionResult.data.affected_bookings?.map((id) => <a key={id} className="ml-2 underline" href={`/calendar?appointment=${id}`}>{id.slice(0, 8)}</a>)}</div>}{availability.currentData?.exceptions.length ? <div className="mt-5 divide-y divide-slate-100">{availability.currentData.exceptions.map((item) => <div key={item.id} className="flex items-center justify-between py-3 text-sm"><span><strong className="font-medium">{item.exception_date}</strong><span className="ml-3 text-slate-500">{item.start_local_time ? `${item.start_local_time.slice(0,5)}–${item.end_local_time?.slice(0,5)}` : 'All day'} · {item.reason || item.exception_type}</span></span><button aria-label="Remove exception" disabled={deleteExceptionResult.isLoading} onClick={() => void removeException(item.id)} className="min-h-11 min-w-11 rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"><Trash2 size={15} /></button></div>)}</div> : <p className="mt-5 text-sm text-slate-400">No upcoming exceptions.</p>}</Card></>}
  </div>;
}
