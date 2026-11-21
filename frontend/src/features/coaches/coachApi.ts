import { baseApi } from '@/app/store/baseApi';

export interface Coach {
  id: string;
  email: string;
  email_valid: boolean;
  full_name: string;
  role: 'instructor';
  is_active: boolean;
  display_name: string;
  timezone: string;
  country_code: string | null;
}

export interface OneTimeLink {
  email: string;
  expires_at: string;
  email_sent: boolean;
  registration_url?: string;
  reset_url?: string;
}

export interface InvitationInfo {
  email: string;
  expires_at: string;
}

export interface CoachRegistration {
  token: string;
  full_name: string;
  display_name: string;
  country_code: string;
  timezone: string;
  password: string;
}

export const coachApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    listCoaches: builder.query<Coach[], void>({
      query: () => '/admin/coaches',
      providesTags: ['Coaches'],
    }),
    inviteCoach: builder.mutation<OneTimeLink, { email: string }>({
      query: (body) => ({ url: '/admin/coaches/invitations', method: 'POST', body }),
      invalidatesTags: ['Coaches'],
    }),
    setCoachActive: builder.mutation<Coach, { id: string; active: boolean }>({
      query: ({ id, active }) => ({ url: `/admin/coaches/${id}/active`, method: 'PATCH', body: { active } }),
      invalidatesTags: ['Coaches', 'Instructor', 'Instructors', 'Availability', 'Appointments'],
    }),
    issueCoachPasswordReset: builder.mutation<OneTimeLink, string>({
      query: (id) => ({ url: `/admin/coaches/${id}/password-reset`, method: 'POST' }),
    }),
    validateCoachInvitation: builder.mutation<InvitationInfo, { token: string }>({
      query: (body) => ({ url: '/auth/coach-invitation/validate', method: 'POST', body }),
    }),
    registerCoach: builder.mutation<unknown, CoachRegistration>({
      query: (body) => ({ url: '/auth/coach-register', method: 'POST', body }),
    }),
    resetCoachPassword: builder.mutation<void, { token: string; password: string }>({
      query: (body) => ({ url: '/auth/coach-password-reset', method: 'POST', body }),
    }),
    requestCoachPasswordReset: builder.mutation<{ message: string }, { email: string }>({
      query: (body) => ({ url: '/auth/coach-password-reset-request', method: 'POST', body }),
    }),
  }),
});

export const {
  useListCoachesQuery,
  useInviteCoachMutation,
  useSetCoachActiveMutation,
  useIssueCoachPasswordResetMutation,
  useValidateCoachInvitationMutation,
  useRegisterCoachMutation,
  useResetCoachPasswordMutation,
  useRequestCoachPasswordResetMutation,
} = coachApi;
