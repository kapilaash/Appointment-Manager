import { baseApi } from '@/app/store/baseApi';

export interface InstructorProfile {
  id: string;
  display_name: string;
  timezone: string;
  is_available_for_booking: bool;
}

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: 'admin' | 'instructor';
  is_active: boolean;
  instructor_profile?: InstructorProfile;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export const authApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getMe: builder.query<User, void>({
      query: () => '/auth/me',
      providesTags: ['Auth'],
    }),
    login: builder.mutation<User, LoginPayload>({
      query: (credentials) => ({
        url: '/auth/login',
        method: 'POST',
        body: credentials,
      }),
      invalidatesTags: ['Auth'],
    }),
    logout: builder.mutation<{ message: string }, void>({
      query: () => ({
        url: '/auth/logout',
        method: 'POST',
      }),
      invalidatesTags: ['Auth'],
    }),
  }),
});

export const { useGetMeQuery, useLoginMutation, useLogoutMutation } = authApi;
