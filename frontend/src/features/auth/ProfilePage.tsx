import { useEffect, useState, type FormEvent } from 'react';
import { getCountryCode } from '@vvo/tzdb';
import { useGetProfileQuery, useUpdateProfileMutation } from './profileApi';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { TimeZoneSelect } from '../../components/ui/TimeZoneSelect';

export function ProfilePage() {
  const profile = useGetProfileQuery();
  const [update, result] = useUpdateProfileMutation();
  const [fullName, setFullName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || '');
  const [countryCode, setCountryCode] = useState('');
  const [meetingUrl, setMeetingUrl] = useState('');
  const [savedMessage, setSavedMessage] = useState('');
  useEffect(() => {
    if (profile.data) {
      setFullName(profile.data.full_name);
      setDisplayName(profile.data.display_name);
      setTimezone(profile.data.timezone);
      setCountryCode(profile.data.country_code ?? getCountryCode(profile.data.timezone) ?? '');
      setMeetingUrl(profile.data.meeting_url ?? '');
    }
  }, [profile.data]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSavedMessage('');
    try {
      const result = await update({ full_name: fullName, display_name: displayName, timezone,
        ...(profile.data?.role === 'instructor' ? { country_code: countryCode, meeting_url: meetingUrl.trim() || null } : {}) }).unwrap();
      setSavedMessage(result.pending_request_id
        ? 'Profile saved. Your new country and time zone were sent to an administrator for approval and apply once approved.'
        : 'Profile saved.');
    } catch { /* The mutation error state is displayed inline. */ }
  }
  return <div className="mx-auto max-w-2xl space-y-5"><header><h2 className="text-2xl font-semibold text-heading">My profile</h2><p className="mt-1 text-sm text-slate-600">Manage your coach name and local time zone.</p></header>
    <Card className="p-6">{profile.isLoading ? <p>Loading profile…</p> : <form onSubmit={(event) => void submit(event)} className="space-y-4">
      <label className="block text-sm font-medium">Account email<input readOnly value={profile.data?.email ?? ''} className="mt-1 block w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-500" /></label>
      <label className="block text-sm font-medium">Full name<input required maxLength={150} value={fullName} onChange={(event) => setFullName(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2.5" /></label>
      {profile.data?.role === 'instructor' && <><label className="block text-sm font-medium">Name shown to families<input required maxLength={150} value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2.5" /></label><TimeZoneSelect required countryCode={countryCode} timezone={timezone} onCountryCodeChange={setCountryCode} onTimezoneChange={setTimezone} countryLabel="Country where you live" timezoneLabel="Coach time zone" /><span className="block text-xs font-normal text-slate-500">Availability hours are interpreted in this time zone.</span><label className="block text-sm font-medium">Default meeting link (optional)<input type="url" maxLength={2048} value={meetingUrl} onChange={(event) => setMeetingUrl(event.target.value)} placeholder="https://meet.google.com/..." className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2.5" /><span className="mt-1 block text-xs font-normal text-slate-500">This link is added to demos booked with you. You can still use a one-time link for a specific demo.</span></label></>}
      {savedMessage && <p role="status" className="text-sm text-emerald-700">{savedMessage}</p>}{(profile.isError || result.isError) && <p role="alert" className="text-sm text-rose-700">Profile could not be saved. Check the time zone and use a valid HTTPS meeting link.</p>}
      <Button className="w-full sm:w-auto" disabled={result.isLoading}>{result.isLoading ? 'Saving…' : 'Save profile'}</Button>
    </form>}</Card></div>;
}
