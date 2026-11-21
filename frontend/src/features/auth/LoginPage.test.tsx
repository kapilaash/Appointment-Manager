import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { LoginPage } from './LoginPage';
import { formatLoginError } from './formatLoginError';

vi.mock('./api', () => ({
  useLoginMutation: () => [vi.fn(), { isLoading: false, error: undefined }],
}));

describe('LoginPage', () => {
  it('renders accessible sign-in fields', () => {
    render(<LoginPage />);
    expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it('formats Pydantic validation details instead of rendering object strings', () => {
    expect(formatLoginError({
      status: 422,
      data: { detail: [{ loc: ['body', 'email'], msg: 'Invalid email address' }] },
    })).toBe('email: Invalid email address');
  });

  it('shows the API message for invalid credentials', () => {
    expect(formatLoginError({ status: 401, data: { detail: 'Invalid email or password' } }))
      .toBe('Invalid email or password');
  });
});
