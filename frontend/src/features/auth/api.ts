import { api } from '../../app/store/api';
import type { ThemePreference } from '../appearance/ThemeContext';

export type User = {
  id: string;
  email: string;
  role: 'admin' | 'instructor';
  instructor_profile?: { timezone: string; country_code: string | null } | null;
  /** Appearance saved on the account; null until the user picks one. */
  theme_preference?: ThemePreference | null;
};

export const authApi = api.injectEndpoints({
  endpoints: (build) => ({
    me: build.query<User, void>({ query: () => '/auth/me', providesTags: ['Dashboard'] }),
    login: build.mutation<User, { email: string; password: string }>({
      query: (body) => ({ url: '/auth/login', method: 'POST', body }),
      invalidatesTags: ['Dashboard'],
    }),
    saveThemePreference: build.mutation<User, { theme: ThemePreference }>({
      query: (body) => ({ url: '/auth/me/preferences', method: 'PUT', body }),
      // Update the cached account in place; refetching /me would re-render the whole workspace.
      onQueryStarted: async (_arg, { dispatch, queryFulfilled }) => {
        try {
          const { data } = await queryFulfilled;
          dispatch(authApi.util.updateQueryData('me', undefined, (draft) => { draft.theme_preference = data.theme_preference ?? null; }));
        } catch {
          // Keep the local choice; it is saved to the account next time.
        }
      },
    }),
    logout: build.mutation<void, void>({ query: () => ({ url: '/auth/logout', method: 'POST' }),
      onQueryStarted: async (_arg, { dispatch, queryFulfilled }) => {
        try { await queryFulfilled; } finally { dispatch(authApi.util.resetApiState()); }
      },
    }),
  }),
});

export const { useMeQuery, useLoginMutation, useLogoutMutation, useSaveThemePreferenceMutation } = authApi;
