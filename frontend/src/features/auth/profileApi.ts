import { api } from '../../app/store/api';

export type Profile = { id: string; email: string; full_name: string; role: 'admin' | 'instructor'; display_name: string; timezone: string; country_code: string | null; meeting_url: string | null };
export const profileApi = api.injectEndpoints({
  endpoints: (build) => ({
    getProfile: build.query<Profile, void>({ query: () => '/profile', providesTags: ['Auth'] }),
    updateProfile: build.mutation<Profile, { full_name: string; display_name: string; timezone: string; country_code?: string | undefined; meeting_url?: string | null | undefined }>({
      query: (body) => ({ url: '/profile', method: 'PATCH', body }), invalidatesTags: ['Auth', 'Instructor'],
    }),
  }),
});
export const { useGetProfileQuery, useUpdateProfileMutation } = profileApi;
