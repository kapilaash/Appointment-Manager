import { api } from '../../app/store/api';

export type User = {
  id: string;
  email: string;
  role: 'admin' | 'instructor';
  instructor_profile?: { timezone: string; country_code: string | null } | null;
};

export const authApi = api.injectEndpoints({
  endpoints: (build) => ({
    me: build.query<User, void>({ query: () => '/auth/me', providesTags: ['Dashboard'] }),
    login: build.mutation<User, { email: string; password: string }>({
      query: (body) => ({ url: '/auth/login', method: 'POST', body }),
      invalidatesTags: ['Dashboard'],
    }),
    logout: build.mutation<void, void>({ query: () => ({ url: '/auth/logout', method: 'POST' }),
      onQueryStarted: async (_arg, { dispatch, queryFulfilled }) => {
        try { await queryFulfilled; } finally { dispatch(authApi.util.resetApiState()); }
      },
    }),
  }),
});

export const { useMeQuery, useLoginMutation, useLogoutMutation } = authApi;
