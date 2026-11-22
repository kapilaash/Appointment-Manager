import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { LoginPage } from './LoginPage';
import { formatLoginError } from './formatLoginError';

const login = vi.fn();
vi.mock('./api', () => ({
  useLoginMutation: () => [login, { isLoading: false, error: undefined }],
  useLoginSecondStepMutation: () => [vi.fn(), { isLoading: false, error: undefined, reset: vi.fn() }],
  isMfaChallenge: (value: unknown) => typeof value === 'object' && value !== null && 'mfa_required' in value,
}));

describe('LoginPage', () => {
  it('renders accessible sign-in fields', () => {
    render(<LoginPage />);
    expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it('offers a password reset link and explains that the username is the email', () => {
    render(<LoginPage />);
    expect(screen.getByRole('link', { name: /reset it by email/i })).toHaveAttribute('href', '/forgot-password');
    expect(screen.getByText(/your username is the email address/i)).toBeInTheDocument();
  });

  it('asks for an authenticator code when the account uses two-step sign-in', async () => {
    login.mockReturnValue({
      unwrap: () => Promise.resolve({ mfa_required: true, mfa_token: 'challenge-token-value-123' }),
    });
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'admin@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a long passphrase' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: /two-step sign-in/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Authentication code')).toHaveAttribute('autocomplete', 'one-time-code');
    fireEvent.click(screen.getByRole('button', { name: /use a recovery code/i }));
    expect(screen.getByLabelText('Recovery code')).toBeInTheDocument();
  });

  it('formats Pydantic validation details instead of rendering object strings', () => {
    expect(
      formatLoginError({
        status: 422,
        data: { detail: [{ loc: ['body', 'email'], msg: 'Invalid email address' }] },
      }),
    ).toBe('email: Invalid email address');
  });

  it('shows the API message for invalid credentials', () => {
    expect(formatLoginError({ status: 401, data: { detail: 'Invalid email or password' } })).toBe(
      'Invalid email or password',
    );
  });
});
