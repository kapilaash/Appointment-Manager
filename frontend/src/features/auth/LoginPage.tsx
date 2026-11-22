import React, { useState } from 'react';
import { KeyRound, Mail, ShieldAlert, ShieldCheck } from 'lucide-react';
import { AuthLayout } from '../../components/layout/AuthLayout';
import { PasswordField } from '../../components/ui/PasswordField';
import { isMfaChallenge, useLoginMutation, useLoginSecondStepMutation } from './api';
import { formatLoginError } from './formatLoginError';

const inputClass =
  'block min-h-12 w-full rounded-xl border border-slate-300 bg-surface py-3 text-base text-heading placeholder:text-slate-400 shadow-sm transition focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-500/15';
const primaryButton =
  'flex min-h-12 w-full items-center justify-center rounded-xl bg-action px-4 py-3 text-sm font-semibold text-on-action shadow-sm transition hover:bg-action-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700 disabled:cursor-wait disabled:opacity-60';
const linkClass =
  'rounded font-semibold text-indigo-700 underline decoration-indigo-300 underline-offset-4 hover:text-indigo-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600';

function ErrorBox({ message }: { message: string }) {
  return (
    <div
      role="alert"
      aria-live="polite"
      className="mt-6 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
    >
      <ShieldAlert aria-hidden="true" className="mt-0.5 h-5 w-5 flex-shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [login, { isLoading, error }] = useLoginMutation();
  const [verify, verifyResult] = useLoginSecondStepMutation();

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const result = await login({ email: email.trim(), password }).unwrap();
      if (isMfaChallenge(result)) {
        setChallenge(result.mfa_token);
        setPassword('');
      }
    } catch {
      // RTK Query keeps the error available for the inline message below.
    }
  };

  const handleCode = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!challenge) return;
    try {
      await verify({ mfa_token: challenge, code: code.trim() }).unwrap();
    } catch (failure) {
      const status = typeof failure === 'object' && failure && 'status' in failure ? failure.status : undefined;
      // An expired or exhausted attempt needs the password again.
      if (status === 401 || status === 429) setChallenge(null);
      setCode('');
    }
  };

  function startOver() {
    setChallenge(null);
    setCode('');
    setUseRecoveryCode(false);
    verifyResult.reset();
  }

  if (challenge) {
    const codeError = verifyResult.error ? formatLoginError(verifyResult.error) : null;
    return (
      <AuthLayout
        title="Two-step sign-in"
        subtitle={
          useRecoveryCode
            ? 'Enter one of the recovery codes you saved when you turned on two-step sign-in.'
            : 'Open your authenticator app and enter the 6-digit code for Thirumal Chess Academy.'
        }
        footer={
          <button type="button" onClick={startOver} className={linkClass}>
            Use a different account
          </button>
        }
      >
        {codeError && <ErrorBox message={codeError} />}
        <form className="mt-7 space-y-5" onSubmit={handleCode}>
          <div>
            <label htmlFor="login-code" className="block text-sm font-semibold text-slate-800">
              {useRecoveryCode ? 'Recovery code' : 'Authentication code'}
            </label>
            <div className="relative mt-2">
              {useRecoveryCode ? (
                <KeyRound
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                />
              ) : (
                <ShieldCheck
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                />
              )}
              <input
                id="login-code"
                key={useRecoveryCode ? 'recovery' : 'totp'}
                autoFocus
                required
                value={code}
                onChange={(event) => setCode(event.target.value)}
                {...(useRecoveryCode
                  ? { autoComplete: 'off', placeholder: 'xxxx-xxxx-xxxx', maxLength: 32 }
                  : {
                      autoComplete: 'one-time-code',
                      inputMode: 'numeric' as const,
                      pattern: '[0-9 ]*',
                      placeholder: '123 456',
                      maxLength: 7,
                    })}
                className={`${inputClass} pl-11 font-mono tracking-widest`}
              />
            </div>
          </div>
          <button type="submit" disabled={verifyResult.isLoading} className={primaryButton}>
            {verifyResult.isLoading ? 'Checking…' : 'Verify and sign in'}
          </button>
        </form>
        <p className="mt-5 text-center text-sm text-slate-600">
          <button
            type="button"
            onClick={() => {
              setUseRecoveryCode(!useRecoveryCode);
              setCode('');
              verifyResult.reset();
            }}
            className={linkClass}
          >
            {useRecoveryCode ? 'Use my authenticator app instead' : 'Lost your phone? Use a recovery code'}
          </button>
        </p>
      </AuthLayout>
    );
  }

  const errorMessage = error ? formatLoginError(error) : null;
  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to manage your coaching sessions and availability."
      footer={
        <>
          Forgot your password?{' '}
          <a href="/forgot-password" className={linkClass}>
            Reset it by email
          </a>
        </>
      }
    >
      {errorMessage && <ErrorBox message={errorMessage} />}
      <form className="mt-7 space-y-5" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="login-email" className="block text-sm font-semibold text-slate-800">
            Email address
          </label>
          <div className="relative mt-2">
            <Mail
              aria-hidden="true"
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            />
            <input
              id="login-email"
              name="email"
              type="email"
              autoComplete="username"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              required
              aria-describedby="login-email-hint"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              className={`${inputClass} pl-11 pr-3`}
            />
          </div>
          <p id="login-email-hint" className="mt-1.5 text-xs text-slate-500">
            Your username is the email address your academy registered you with.
          </p>
        </div>
        <PasswordField
          label="Password"
          name="password"
          autoComplete="current-password"
          required
          withIcon
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <button type="submit" disabled={isLoading} className={primaryButton}>
          {isLoading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthLayout>
  );
};
