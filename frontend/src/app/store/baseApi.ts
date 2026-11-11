import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';

export const baseApi = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({
    baseUrl: import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1',
    credentials: 'include', // Automatically sends and receives HttpOnly session cookies
    prepareHeaders: (headers) => {
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
  tagTypes: ['Auth', 'Instructors', 'Availability', 'Appointments', 'Students', 'DashboardStats'],
  endpoints: () => ({}),
});
