import { useState, type FormEvent } from 'react';
import { Copy, KeyRound, UserPlus, UserX } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import {
  useInviteCoachMutation,
  useIssueCoachPasswordResetMutation,
  useListCoachesQuery,
  useSetCoachActiveMutation,
  type Coach,
} from './coachApi';

function describeRequestError(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('status' in error)) {
    return 'Request failed. Check the API connection and try again.';
  }

  const status = error.status;
  const data = 'data' in error ? error.data : undefined;
  const detail =
    typeof data === 'object' && data !== null && 'detail' in data && typeof data.detail === 'string'
      ? data.detail
      : undefined;

  if (status === 401) return 'Your admin session expired. Sign in again.';
  if (status === 403) return 'This account does not have administrator access.';
  if (typeof status === 'number') return detail ? `${detail} (HTTP ${status})` : `Request failed (HTTP ${status}).`;
  return `Request failed (${String(status)}). Check that the backend is available.`;
}

function countryLabel(countryCode: string | null): string {
  if (!countryCode) return 'Not configured';
  return new Intl.DisplayNames([navigator.language || 'en'], { type: 'region' }).of(countryCode) ?? countryCode;
}

export function CoachAdminPage() {
  const coaches = useListCoachesQuery();
  const [inviteCoach, inviteResult] = useInviteCoachMutation();
  const [setCoachActive, activeResult] = useSetCoachActiveMutation();
  const [issueReset, resetResult] = useIssueCoachPasswordResetMutation();
  const [email, setEmail] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [resetLink, setResetLink] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [inviteEmailSent, setInviteEmailSent] = useState<boolean | null>(null);
  const [resetEmailSent, setResetEmailSent] = useState<boolean | null>(null);
  const [pendingCoach, setPendingCoach] = useState<Coach | null>(null);

  async function createInvite(event: FormEvent) {
    event.preventDefault();
    setError('');
    setNotice('');
    setInviteLink('');
    setInviteEmailSent(null);
    setResetLink('');
    try {
      const result = await inviteCoach({ email }).unwrap();
      setInviteLink(result.registration_url ?? '');
      setInviteEmailSent(result.email_sent);
      setNotice(
        result.email_sent
          ? `Invitation emailed to ${result.email}. The link expires in 48 hours and can be used once.`
          : `Invitation created, but email could not be sent to ${result.email}. Copy and share the link below.`,
      );
      setEmail('');
    } catch {
      setError('Could not create the invite. The email may already have an account.');
    }
  }

  async function toggleCoach(coach: Coach) {
    setError('');
    try {
      await setCoachActive({ id: coach.id, active: !coach.is_active }).unwrap();
      setNotice(
        coach.is_active
          ? 'Coach deactivated. New bookings are disabled and existing classes are preserved.'
          : 'Coach activated. Sign-in and booking availability follow the coach account settings.',
      );
      setPendingCoach(null);
    } catch (requestError) {
      setError(`Could not update this coach account. ${describeRequestError(requestError)}`);
    }
  }

  async function createResetLink(id: string) {
    setError('');
    setNotice('');
    setInviteLink('');
    setResetLink('');
    setResetEmailSent(null);
    try {
      const result = await issueReset(id).unwrap();
      if (!result.reset_url) throw new Error('The server did not return a reset URL.');
      setResetLink(result.reset_url);
      setResetEmailSent(result.email_sent);
      setNotice(
        result.email_sent
          ? `Password reset email sent to ${result.email}. The link expires in 30 minutes and can be used once.`
          : `Reset link created, but email could not be sent to ${result.email}. Copy and share the link below.`,
      );
    } catch (requestError) {
      setError(`Could not create a password reset link. ${describeRequestError(requestError)}`);
    }
  }

  async function copyLink(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice('Link copied. Send it to the coach through a private channel.');
    } catch {
      setNotice('Select and copy the link, then send it through a private channel.');
    }
  }

  return (
    <div className="space-y-7">
      <header>
        <p className="text-sm font-semibold text-accent-700">Administrator workspace</p>
        <h1 className="mt-1 text-2xl font-semibold text-heading">Coach accounts</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-600">
          Invite coaches, manage account access, and issue password resets. Links are emailed automatically and remain
          available here to share directly if needed. Passwords are never visible to admins.
        </p>
      </header>

      <section className="rounded-xl border border-neutral-200 bg-surface p-5 shadow-sm sm:p-6">
        <div className="flex items-center gap-2">
          <UserPlus size={18} className="text-accent-600" />
          <h2 className="font-semibold text-neutral-900">Invite a coach</h2>
        </div>
        <form onSubmit={createInvite} className="mt-4 flex flex-col gap-3 sm:flex-row">
          <label className="sr-only" htmlFor="coach-email">
            Coach email
          </label>
          <input
            id="coach-email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="coach@example.com"
            className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-2.5 text-sm"
          />
          <button
            disabled={inviteResult.isLoading}
            className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-on-accent disabled:opacity-50"
          >
            {inviteResult.isLoading ? 'Creating…' : 'Create invite'}
          </button>
        </form>
        {inviteLink && (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <input
              aria-label="One-time coach registration link"
              readOnly
              value={inviteLink}
              onFocus={(event) => event.currentTarget.select()}
              className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2 text-xs"
            />
            <button
              type="button"
              onClick={() => void copyLink(inviteLink)}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium"
            >
              <Copy size={15} />
              Copy link
            </button>
          </div>
        )}
        <p className="mt-3 text-xs leading-5 text-neutral-500">
          {inviteEmailSent
            ? 'This registration link was emailed, expires after 48 hours, and works once. You can also copy and share it privately.'
            : 'This registration link expires after 48 hours and works once. Email delivery failed, so copy and share it privately.'}
        </p>
      </section>

      {resetLink && (
        <section className="rounded-xl border border-warning-200 bg-warning-50 p-5">
          <h2 className="font-semibold text-warning-950">Password reset link</h2>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              aria-label="One-time password reset link"
              readOnly
              value={resetLink}
              onFocus={(event) => event.currentTarget.select()}
              className="min-w-0 flex-1 rounded-lg border border-warning-300 bg-surface px-3 py-2 text-xs"
            />
            <button
              type="button"
              onClick={() => void copyLink(resetLink)}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-warning-300 bg-surface px-3 py-2 text-sm font-medium"
            >
              <Copy size={15} />
              Copy link
            </button>
          </div>
          <p className="mt-2 text-xs text-warning-900">
            {resetEmailSent
              ? 'The reset link was emailed, expires after 30 minutes, and works once. You can copy it to share privately.'
              : 'Email delivery failed. The reset link expires after 30 minutes and works once; copy it to share privately.'}
          </p>
        </section>
      )}

      {notice && (
        <p role="status" className="rounded-lg bg-success-50 p-3 text-sm text-success-800">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg bg-danger-50 p-3 text-sm text-danger-700">
          {error}
        </p>
      )}
      {resetResult.isError && !error && (
        <p role="alert" className="rounded-lg bg-danger-50 p-3 text-sm text-danger-700">
          Reset link could not be created.
        </p>
      )}

      <section className="overflow-hidden rounded-xl border border-neutral-200 bg-surface shadow-sm">
        <div className="border-b border-neutral-200 px-5 py-4">
          <h2 className="font-semibold text-neutral-900">Coaches</h2>
        </div>
        {coaches.isLoading ? (
          <p className="p-5 text-sm text-neutral-500">Loading coach accounts…</p>
        ) : coaches.isError ? (
          <div className="flex flex-col items-start gap-3 p-5">
            <p className="text-sm text-danger-700">
              Could not load coach accounts. {describeRequestError(coaches.error)}
            </p>
            <button
              type="button"
              onClick={() => void coaches.refetch()}
              className="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700"
            >
              Retry
            </button>
          </div>
        ) : coaches.data?.length ? (
          <>
            <div className="divide-y divide-neutral-100 2xl:hidden">
              {coaches.data.map((coach) => (
                <article key={coach.id} className="space-y-4 p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate font-semibold text-neutral-900">{coach.display_name}</h3>
                      <p className="mt-0.5 truncate text-xs text-neutral-500">{coach.full_name}</p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${coach.is_active ? 'bg-success-50 text-success-700' : 'bg-neutral-100 text-neutral-600'}`}
                    >
                      {coach.is_active ? 'Active' : 'Deactivated'}
                    </span>
                  </div>
                  <div className="break-all text-sm text-neutral-700">
                    {coach.email}
                    {!coach.email_valid && (
                      <span className="ml-2 rounded-full bg-warning-100 px-2 py-1 text-xs font-medium text-warning-900">
                        Invalid email
                      </span>
                    )}
                  </div>
                  <dl className="grid grid-cols-2 gap-3 rounded-xl bg-neutral-50 p-3 text-sm">
                    <div>
                      <dt className="text-xs text-neutral-500">Country</dt>
                      <dd className="mt-1 font-medium text-neutral-800">{countryLabel(coach.country_code)}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-xs text-neutral-500">Time zone</dt>
                      <dd className="mt-1 break-words font-medium text-neutral-800">{coach.timezone}</dd>
                    </div>
                  </dl>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full px-2 text-xs"
                      onClick={() => void createResetLink(coach.id)}
                      disabled={!coach.email_valid || resetResult.isLoading}
                    >
                      <KeyRound size={15} />
                      {resetResult.isLoading ? 'Creating…' : 'Reset link'}
                    </Button>
                    <Button
                      type="button"
                      variant={coach.is_active ? 'ghost' : 'secondary'}
                      className={`w-full px-2 text-xs ${coach.is_active ? 'text-danger-700' : ''}`}
                      onClick={() => setPendingCoach(coach)}
                    >
                      <UserX size={15} />
                      {coach.is_active ? 'Deactivate' : 'Activate'}
                    </Button>
                  </div>
                </article>
              ))}
            </div>
            <div className="hidden overflow-x-auto 2xl:block">
              <table className="w-full min-w-[1180px] table-fixed text-left text-sm">
                <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="w-[18%] px-5 py-3">Coach</th>
                    <th className="w-[25%] px-5 py-3">Email</th>
                    <th className="w-[16%] px-5 py-3">Country and time zone</th>
                    <th className="w-[13%] px-5 py-3">Access</th>
                    <th className="w-[28%] px-5 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {coaches.data.map((coach) => (
                    <tr key={coach.id} className="h-[76px]">
                      <td className="px-5 py-4">
                        <div className="font-medium text-neutral-900">{coach.display_name}</div>
                        <div className="text-xs text-neutral-500">{coach.full_name}</div>
                      </td>
                      <td className="overflow-hidden whitespace-nowrap px-5 py-4 text-neutral-700">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate" title={coach.email}>
                            {coach.email}
                          </span>
                          {!coach.email_valid && (
                            <span
                              title="This account email is invalid; password reset is unavailable until corrected."
                              aria-label="Invalid email on account"
                              className="shrink-0 rounded-full bg-warning-100 px-2 py-1 text-xs font-medium text-warning-900"
                            >
                              Invalid
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="overflow-hidden px-5 py-4 text-neutral-600">
                        <span
                          className="block truncate font-medium text-neutral-700"
                          title={coach.country_code ?? 'Country not configured'}
                        >
                          {coach.country_code
                            ? (new Intl.DisplayNames([navigator.language || 'en'], { type: 'region' }).of(
                                coach.country_code,
                              ) ?? coach.country_code)
                            : 'Not configured'}
                        </span>
                        <span className="block truncate text-xs" title={coach.timezone}>
                          {coach.timezone}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-5 py-4">
                        <span
                          className={`inline-flex w-[5.5rem] justify-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${coach.is_active ? 'bg-success-50 text-success-700' : 'bg-neutral-100 text-neutral-600'}`}
                        >
                          {coach.is_active ? 'Active' : 'Deactivated'}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-5 py-4">
                        <div className="flex flex-nowrap gap-2">
                          <button
                            type="button"
                            onClick={() => void createResetLink(coach.id)}
                            disabled={!coach.email_valid || resetResult.isLoading}
                            title={
                              !coach.email_valid ? 'Correct the account email before issuing a reset link.' : undefined
                            }
                            className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs font-medium text-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <KeyRound size={13} />
                            {resetResult.isLoading ? 'Creating…' : 'Reset link'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingCoach(coach)}
                            className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs font-medium text-neutral-700"
                          >
                            <UserX size={13} />
                            {coach.is_active ? 'Deactivate' : 'Activate'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="p-8 text-center">
            <p className="font-medium text-neutral-800">No coach accounts yet</p>
            <p className="mt-1 text-sm text-neutral-500">Create an invitation above to let a coach register.</p>
          </div>
        )}
      </section>
      <Dialog
        open={Boolean(pendingCoach)}
        title={
          pendingCoach?.is_active
            ? `Deactivate ${pendingCoach.display_name}?`
            : pendingCoach
              ? `Activate ${pendingCoach.display_name}?`
              : 'Confirm coach update'
        }
        description={
          pendingCoach?.is_active
            ? 'The coach will lose sign-in access and will no longer appear in new demo bookings. Existing scheduled classes and their records are preserved.'
            : 'The coach will be able to sign in again. New bookings will be available if the coach is marked available for booking.'
        }
        confirmLabel={pendingCoach?.is_active ? 'Deactivate coach' : 'Activate coach'}
        destructive={Boolean(pendingCoach?.is_active)}
        busy={activeResult.isLoading}
        onClose={() => setPendingCoach(null)}
        onConfirm={() => pendingCoach && void toggleCoach(pendingCoach)}
      />
    </div>
  );
}
