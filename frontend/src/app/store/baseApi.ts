import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';

export const baseApi = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({
    baseUrl: import.meta.env.VITE_API_URL || '/api/v1',
    credentials: 'include', // Automatically sends and receives HttpOnly session cookies
    prepareHeaders: (headers) => {
      if (!headers.has('X-Request-ID')) {
        headers.set(
          'X-Request-ID',
          globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
        );
      }

      // Extract CSRF token from document cookie if present
      const csrfToken = document.cookie
        .split('; ')
        .find((row) => row.startsWith('csrf_token='))
        ?.split('=')[1];

      if (csrfToken) {
        headers.set('X-CSRF-Token', csrfToken);
      }
      return headers;
    },
  }),
  // Refresh visible data after the network comes back or the tab regains focus (listeners in store/index.ts).
  refetchOnReconnect: true,
  // Several staff edit the same schedule: when a page is revisited, refresh data older than 10 seconds
  // so changes made by others (approvals, bookings) appear without a manual reload.
  refetchOnMountOrArgChange: 10,
  tagTypes: [
    'Auth',
    'Coaches',
    'Instructor',
    'Instructors',
    'Availability',
    'Appointment',
    'Appointments',
    'Student',
    'Students',
    'Dashboard',
    'DashboardStats',
    'ChangeRequests',
    'Security',
  ],
  endpoints: () => ({}),
});
