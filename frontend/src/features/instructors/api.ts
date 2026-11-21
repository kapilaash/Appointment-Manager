import { api } from '../../app/store/api';

export type Instructor = {
  id: string;
  user_id: string;
  display_name: string;
  timezone: string;
  country_code: string | null;
  meeting_url: string | null;
  is_available_for_booking: boolean;
  email: string;
  is_active: boolean;
};
export type PublicBookingInstructor = Pick<Instructor, 'id' | 'display_name' | 'timezone'>;

export type AvailabilityRule = {
  id?: string;
  day_of_week: number;
  start_local_time: string;
  end_local_time: string;
  effective_from?: string | null;
  effective_until?: string | null;
};

export type Availability = { timezone: string; rules: AvailabilityRule[]; exceptions: AvailabilityException[] };
export type AvailabilityException = {
  id: string;
  exception_date: string;
  start_local_time: string | null;
  end_local_time: string | null;
  exception_type: 'unavailable' | 'additional_available';
  reason: string | null;
};

export const instructorApi = api.injectEndpoints({
  endpoints: (build) => ({
    instructors: build.query<Instructor[], void>({ query: () => '/instructors', providesTags: ['Instructor'] }),
    publicBookingInstructors: build.query<PublicBookingInstructor[], void>({ query: () => '/public/instructors' }),
    updateInstructor: build.mutation<Partial<Instructor>, { id: string; display_name?: string; timezone?: string; country_code?: string; meeting_url?: string | null; is_available_for_booking?: boolean }>({
      query: ({ id, ...body }) => ({ url: `/instructors/${id}`, method: 'PATCH', body }), invalidatesTags: ['Instructor', 'Availability'],
    }),
    availability: build.query<Availability, string>({
      query: (id) => `/instructors/${id}/availability`, providesTags: (_result, _error, id) => [{ type: 'Availability', id }],
    }),
    saveAvailability: build.mutation<{ saved: boolean; affected_bookings: string[]; warning?: string | null }, { id: string; rules: AvailabilityRule[] }>({
      query: ({ id, rules }) => ({ url: `/instructors/${id}/availability`, method: 'PUT', body: { rules } }),
      invalidatesTags: (_result, _error, arg) => [{ type: 'Availability', id: arg.id }],
    }),
    addException: build.mutation<{ id: string; affected_bookings?: string[]; warning?: string | null }, { id: string; exception_date: string; start_local_time?: string | null; end_local_time?: string | null; exception_type: 'unavailable' | 'additional_available'; reason?: string }>({
      query: ({ id, ...body }) => ({ url: `/instructors/${id}/availability/exceptions`, method: 'POST', body }),
      invalidatesTags: (_result, _error, arg) => [{ type: 'Availability', id: arg.id }],
    }),
    deleteException: build.mutation<void, { instructorId: string; exceptionId: string }>({
      query: ({ instructorId, exceptionId }) => ({ url: `/instructors/${instructorId}/availability/exceptions/${exceptionId}`, method: 'DELETE' }),
      invalidatesTags: (_result, _error, arg) => [{ type: 'Availability', id: arg.instructorId }],
    }),
  }),
});

export const { useInstructorsQuery, useUpdateInstructorMutation, useAvailabilityQuery,
  useSaveAvailabilityMutation, useAddExceptionMutation, useDeleteExceptionMutation,
  usePublicBookingInstructorsQuery } = instructorApi;
