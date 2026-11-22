import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import qrcode from 'qrcode-generator';
import { Copy, Download, KeyRound, ShieldCheck, ShieldOff, Smartphone } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Dialog } from '../../components/ui/Dialog';
import { PASSWORD_HINT, PasswordField } from '../../components/ui/PasswordField';
import { useToast } from '../../components/ui/Toast';
import { apiErrorDetail } from '../../lib/apiError';
import {
  useChangePasswordMutation,
  useDisableMfaMutation,
  useEnableMfaMutation,
  useRegenerateRecoveryCodesMutation,
  useSecurityOverviewQuery,
  useStartMfaSetupMutation,
} from './api';

const codeInput =
  'mt-2 block min-h-12 w-full rounded-xl border border-slate-300 bg-surface px-3.5 py-3 font-mono text-base tracking-widest text-heading shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-500/15';

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString([], { dateStyle: 'medium' }) : null;
}

function ChangePasswordCard() {
  const { notify } = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [change, result] = useChangePasswordMutation();
  const [error, setError] = useState('');
  const mismatch = Boolean(confirm) && next !== confirm;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (mismatch) return;
    setError('');
    try {
      await change({ current_password: current, new_password: next }).unwrap();
      setCurrent('');
      setNext('');
      setConfirm('');
      notify('Password changed. Your other devices were signed out, and we emailed you a confirmation.');
    } catch (failure) {
      setError(apiErrorDetail(failure) ?? 'Your password could not be changed. Try again.');
    }
  }

  return (
    <Card className="p-5 sm:p-6">
      <h3 className="flex items-center gap-2 font-semibold text-slate-900">
        <KeyRound size={18} aria-hidden="true" className="text-indigo-600" />
        Change password
      </h3>
      <p className="mt-1 text-sm text-slate-500">
        You stay signed in on this device; every other device is signed out.
      </p>
      <form onSubmit={(event) => void submit(event)} className="mt-5 grid gap-4 sm:max-w-md">
        <PasswordField
          label="Current password"
          autoComplete="current-password"
          required
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
        />
        <PasswordField
          label="New password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={128}
          hint={PASSWORD_HINT}
          value={next}
          onChange={(event) => setNext(event.target.value)}
        />
        <PasswordField
          label="Confirm new password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={128}
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
        />
        {mismatch && (
          <p role="alert" className="text-sm text-rose-700">
            The new passwords do not match.
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
            {error}
          </p>
        )}
        <div>
          <Button type="submit" disabled={result.isLoading || mismatch || next.length < 12}>
            {result.isLoading ? 'Saving…' : 'Change password'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const { notify } = useToast();
  const [saved, setSaved] = useState(false);
  const text = `Thirumal Chess Academy recovery codes\nEach code works once. Keep them somewhere safe and private.\n\n${codes.join('\n')}\n`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      notify('Recovery codes copied.');
    } catch {
      notify('Copying is blocked by the browser. Select the codes and copy them instead.', 'info');
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const link = Object.assign(document.createElement('a'), {
      href: url,
      download: 'thirumal-chess-recovery-codes.txt',
    });
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 sm:p-5">
      <p className="font-semibold text-amber-950">Save your recovery codes</p>
      <p className="mt-1 text-sm text-amber-900">
        If you lose your phone, each code lets you sign in once. They are shown only now.
      </p>
      <ul aria-label="Recovery codes" className="mt-4 grid grid-cols-2 gap-2 font-mono text-sm sm:grid-cols-5">
        {codes.map((code) => (
          <li key={code} className="rounded-lg bg-surface px-2 py-1.5 text-center text-slate-900 ring-1 ring-amber-200">
            {code}
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => void copy()}>
          <Copy size={15} />
          Copy
        </Button>
        <Button variant="secondary" onClick={download}>
          <Download size={15} />
          Download
        </Button>
      </div>
      <label className="mt-4 flex items-center gap-2 text-sm font-medium text-amber-950">
        <input
          type="checkbox"
          checked={saved}
          onChange={(event) => setSaved(event.target.checked)}
          className="h-4 w-4"
        />
        I have saved these codes somewhere safe
      </label>
      <Button className="mt-3" disabled={!saved} onClick={onDone}>
        Done
      </Button>
    </div>
  );
}

function TwoStepCard() {
  const { notify } = useToast();
  const overview = useSecurityOverviewQuery();
  const [startSetup, setupResult] = useStartMfaSetupMutation();
  const [enable, enableResult] = useEnableMfaMutation();
  const [disable, disableResult] = useDisableMfaMutation();
  const [regenerate, regenerateResult] = useRegenerateRecoveryCodesMutation();
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<'disable' | 'regenerate' | null>(null);
  const [password, setPassword] = useState('');
  const [dialogCode, setDialogCode] = useState('');
  const setup = setupResult.data;
  const qrImage = useMemo(() => {
    if (!setup) return null;
    const qr = qrcode(0, 'M');
    qr.addData(setup.otpauth_uri);
    qr.make();
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true }))}`;
  }, [setup]);

  async function begin() {
    setError('');
    try {
      await startSetup().unwrap();
    } catch (failure) {
      setError(apiErrorDetail(failure) ?? 'Setup could not start. Try again.');
    }
  }

  async function confirmSetup(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      const result = await enable({ code }).unwrap();
      setCodes(result.recovery_codes);
      setCode('');
      setupResult.reset();
      notify('Two-step sign-in is on.');
    } catch (failure) {
      setError(apiErrorDetail(failure) ?? 'That code did not work. Try the newest code.');
    }
  }

  async function confirmDialog() {
    setError('');
    try {
      if (dialog === 'disable') {
        await disable({ password, code: dialogCode }).unwrap();
        notify('Two-step sign-in is off.', 'info');
      } else {
        const result = await regenerate({ password }).unwrap();
        setCodes(result.recovery_codes);
      }
      setDialog(null);
    } catch (failure) {
      setError(apiErrorDetail(failure) ?? 'That did not work. Check your password and code.');
    }
  }

  function openDialog(kind: 'disable' | 'regenerate') {
    setPassword('');
    setDialogCode('');
    setError('');
    setDialog(kind);
  }

  const status = overview.data;
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <h3 className="flex items-center gap-2 font-semibold text-slate-900">
            <Smartphone size={18} aria-hidden="true" className="text-indigo-600" />
            Two-step sign-in
          </h3>
          <p className="mt-1 max-w-xl text-sm text-slate-500">
            After your password, also enter a code from an authenticator app (Google Authenticator, Microsoft
            Authenticator, 1Password…). Strongly recommended for administrators, who can see family contact details.
          </p>
        </div>
        {status &&
          (status.mfa_enabled ? (
            <span className="inline-flex shrink-0 items-center gap-1 self-start rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
              <ShieldCheck size={13} aria-hidden="true" />
              On since {formatDate(status.mfa_enabled_at)}
            </span>
          ) : (
            <span className="inline-flex shrink-0 items-center gap-1 self-start rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
              <ShieldOff size={13} aria-hidden="true" />
              Off
            </span>
          ))}
      </div>

      {codes ? (
        <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />
      ) : setup && qrImage ? (
        <div className="mt-5 grid gap-5 sm:grid-cols-[auto_1fr] sm:items-start">
          <img
            src={qrImage}
            alt="QR code to add Thirumal Chess Academy to your authenticator app"
            className="h-44 w-44 rounded-xl bg-white p-2 ring-1 ring-slate-200"
          />
          <form onSubmit={(event) => void confirmSetup(event)}>
            <ol className="list-inside list-decimal space-y-1 text-sm text-slate-700">
              <li>Scan the QR code with your authenticator app.</li>
              <li>
                Can’t scan? Enter this key:{' '}
                <code className="select-all rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-900">
                  {setup.secret.match(/.{1,4}/g)?.join(' ')}
                </code>
              </li>
              <li>Type the 6-digit code the app shows.</li>
            </ol>
            <label className="mt-4 block text-sm font-semibold text-slate-800 sm:max-w-xs">
              Code from the app
              <input
                required
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={7}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                className={codeInput}
              />
            </label>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="submit" disabled={enableResult.isLoading || code.replace(/\D/g, '').length !== 6}>
                {enableResult.isLoading ? 'Checking…' : 'Turn on two-step sign-in'}
              </Button>
              <Button variant="ghost" onClick={() => setupResult.reset()}>
                Cancel
              </Button>
            </div>
          </form>
        </div>
      ) : status?.mfa_enabled ? (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <p className="w-full text-sm text-slate-600">
            {status.recovery_codes_remaining} unused recovery {status.recovery_codes_remaining === 1 ? 'code' : 'codes'}{' '}
            left.
          </p>
          <Button variant="secondary" onClick={() => openDialog('regenerate')}>
            Create new recovery codes
          </Button>
          <Button variant="ghost" className="text-rose-700" onClick={() => openDialog('disable')}>
            Turn off
          </Button>
        </div>
      ) : (
        <Button className="mt-5" disabled={setupResult.isLoading || overview.isLoading} onClick={() => void begin()}>
          {setupResult.isLoading ? 'Preparing…' : 'Set up two-step sign-in'}
        </Button>
      )}
      {error && !dialog && (
        <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </p>
      )}

      <Dialog
        open={dialog !== null}
        title={dialog === 'disable' ? 'Turn off two-step sign-in?' : 'Create new recovery codes?'}
        description={
          dialog === 'disable'
            ? 'Signing in will need only your password. Confirm with your password and a current code.'
            : 'Your current recovery codes will stop working. Confirm with your password.'
        }
        confirmLabel={dialog === 'disable' ? 'Turn off' : 'Create codes'}
        destructive={dialog === 'disable'}
        busy={disableResult.isLoading || regenerateResult.isLoading}
        confirmDisabled={!password || (dialog === 'disable' && dialogCode.trim().length < 6)}
        onClose={() => setDialog(null)}
        onConfirm={() => void confirmDialog()}
      >
        <div className="space-y-4">
          <PasswordField
            label="Your password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {dialog === 'disable' && (
            <label className="block text-sm font-semibold text-slate-800">
              Authenticator or recovery code
              <input
                autoComplete="one-time-code"
                value={dialogCode}
                onChange={(event) => setDialogCode(event.target.value)}
                className={codeInput}
              />
            </label>
          )}
          {error && (
            <p role="alert" className="text-sm text-rose-700">
              {error}
            </p>
          )}
        </div>
      </Dialog>
    </Card>
  );
}

export function SecuritySettings() {
  const location = useLocation();
  // The account menu links to /profile#security; bring that section into view.
  useEffect(() => {
    if (location.hash === '#security') document.getElementById('security')?.scrollIntoView({ block: 'start' });
  }, [location.hash]);
  return (
    <section id="security" aria-labelledby="security-heading" className="scroll-mt-24 space-y-4">
      <header>
        <h2 id="security-heading" className="text-xl font-semibold text-heading">
          Password & security
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Nobody, including administrators, can see your password. If you forget it, use “Forgot your password?” on the
          sign-in page.
        </p>
      </header>
      <ChangePasswordCard />
      <TwoStepCard />
    </section>
  );
}
