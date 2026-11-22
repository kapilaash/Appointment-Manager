import { api } from '../../app/store/api';
import type { ThemePreference } from '../appearance/ThemeContext';

export type User = {
  id: string;
  email: string;
  full_name?: string;
  role: 'admin' | 'instructor';
  instructor_profile?: { timezone: string; country_code: string | null } | null;
  /** Appearance saved on the account; null until the user picks one. */
  theme_preference?: ThemePreference | null;
  mfa_enabled?: boolean;
};

/** Returned by /auth/login when the password was right but a second step is needed. */
export type MfaChallenge = { mfa_required: true; mfa_token: string };

export function isMfaChallenge(value: unknown): value is MfaChallenge {
  return typeof value === 'object' && value !== null && (value as { mfa_required?: unknown }).mfa_required === true;
}

export type SecurityOverview = {
  mfa_enabled: boolean;
  mfa_enabled_at: string | null;
  recovery_codes_remaining: number;
  password_changed_at: string | null;
};

export const authApi = api.injectEndpoints({
  endpoints: (build) => ({
    me: build.query<User, void>({ query: () => '/auth/me', providesTags: ['Dashboard'] }),
    login: build.mutation<User | MfaChallenge, { email: string; password: string }>({
      query: (body) => ({ url: '/auth/login', method: 'POST', body }),
      // Only a completed sign-in creates a session worth reloading the account for.
      invalidatesTags: (result) => (result && !isMfaChallenge(result) ? ['Dashboard'] : []),
    }),
    loginSecondStep: build.mutation<User, { mfa_token: string; code: string }>({
      query: (body) => ({ url: '/auth/login/mfa', method: 'POST', body }),
      invalidatesTags: ['Dashboard'],
    }),
    requestPasswordReset: build.mutation<{ message: string }, { email: string }>({
      query: (body) => ({ url: '/auth/password-reset-request', method: 'POST', body }),
    }),
    resetPassword: build.mutation<void, { token: string; password: string }>({
      query: (body) => ({ url: '/auth/password-reset', method: 'POST', body }),
    }),
    securityOverview: build.query<SecurityOverview, void>({
      query: () => '/auth/me/security',
      providesTags: ['Security'],
    }),
    changePassword: build.mutation<void, { current_password: string; new_password: string }>({
      query: (body) => ({ url: '/auth/me/password', method: 'POST', body }),
      invalidatesTags: ['Security'],
    }),
    startMfaSetup: build.mutation<{ secret: string; otpauth_uri: string }, void>({
      query: () => ({ url: '/auth/me/mfa/setup', method: 'POST' }),
    }),
    enableMfa: build.mutation<{ recovery_codes: string[] }, { code: string }>({
      query: (body) => ({ url: '/auth/me/mfa/enable', method: 'POST', body }),
      invalidatesTags: ['Security'],
    }),
    disableMfa: build.mutation<void, { password: string; code: string }>({
      query: (body) => ({ url: '/auth/me/mfa/disable', method: 'POST', body }),
      invalidatesTags: ['Security'],
    }),
    regenerateRecoveryCodes: build.mutation<{ recovery_codes: string[] }, { password: string }>({
      query: (body) => ({ url: '/auth/me/mfa/recovery-codes', method: 'POST', body }),
      invalidatesTags: ['Security'],
    }),
    saveThemePreference: build.mutation<User, { theme: ThemePreference }>({
      query: (body) => ({ url: '/auth/me/preferences', method: 'PUT', body }),
      // Update the cached account in place; refetching /me would re-render the whole workspace.
      onQueryStarted: async (_arg, { dispatch, queryFulfilled }) => {
        try {
          const { data } = await queryFulfilled;
          dispatch(
            authApi.util.updateQueryData('me', undefined, (draft) => {
              draft.theme_preference = data.theme_preference ?? null;
            }),
          );
        } catch {
          // Keep the local choice; it is saved to the account next time.
        }
      },
    }),
    logout: build.mutation<void, void>({
      query: () => ({ url: '/auth/logout', method: 'POST' }),
      onQueryStarted: async (_arg, { dispatch, queryFulfilled }) => {
        try {
          await queryFulfilled;
        } finally {
          dispatch(authApi.util.resetApiState());
        }
      },
    }),
  }),
});

export const {
  useMeQuery,
  useLoginMutation,
  useLoginSecondStepMutation,
  useLogoutMutation,
  useSaveThemePreferenceMutation,
  useRequestPasswordResetMutation,
  useResetPasswordMutation,
  useSecurityOverviewQuery,
  useChangePasswordMutation,
  useStartMfaSetupMutation,
  useEnableMfaMutation,
  useDisableMfaMutation,
  useRegenerateRecoveryCodesMutation,
} = authApi;
