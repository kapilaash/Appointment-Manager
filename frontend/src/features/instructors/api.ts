import { api } from '../../app/store/api';
import type { ChangeRequestType, PendingReceipt } from '../requests/api';

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

export type PendingAvailabilityRequest = {
  id: string;
  request_type: Extract<
    ChangeRequestType,
    'weekly_availability' | 'exception_add' | 'exception_remove' | 'timezone_change'
  >;
  created_at: string;
  exception_id: string | null;
  payload: {
    rules?: AvailabilityRule[];
    timezone?: string;
    country_code?: string | null;
  } & Partial<Omit<AvailabilityException, 'id'>>;
};
export type Availability = {
  timezone: string;
  country_code?: string | null;
  rules: AvailabilityRule[];
  exceptions: AvailabilityException[];
  /** Coach changes waiting for an administrator. */
  pending_requests: PendingAvailabilityRequest[];
};
type Applied<T> = T | PendingReceipt;
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
    updateInstructor: build.mutation<
      Partial<Instructor> & { pending_request_id?: string | null },
      {
        id: string;
        display_name?: string;
        timezone?: string;
        country_code?: string;
        meeting_url?: string | null;
        is_available_for_booking?: boolean;
      }
    >({
      query: ({ id, ...body }) => ({ url: `/instructors/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['Instructor', 'Availability', 'ChangeRequests'],
    }),
    availability: build.query<Availability, string>({
      query: (id) => `/instructors/${id}/availability`,
      providesTags: (_result, _error, id) => [{ type: 'Availability', id }],
    }),
    saveAvailability: build.mutation<
      Applied<{ saved: boolean; affected_bookings: string[]; warning?: string | null }>,
      { id: string; rules: AvailabilityRule[]; note?: string }
    >({
      query: ({ id, ...body }) => ({ url: `/instructors/${id}/availability`, method: 'PUT', body }),
      invalidatesTags: (_result, _error, arg) => [{ type: 'Availability', id: arg.id }, 'ChangeRequests'],
    }),
    addException: build.mutation<
      Applied<{ id: string; affected_bookings?: string[]; warning?: string | null }>,
      {
        id: string;
        exception_date: string;
        start_local_time?: string | null;
        end_local_time?: string | null;
        exception_type: 'unavailable' | 'additional_available';
        reason?: string;
      }
    >({
      query: ({ id, ...body }) => ({ url: `/instructors/${id}/availability/exceptions`, method: 'POST', body }),
      invalidatesTags: (_result, _error, arg) => [{ type: 'Availability', id: arg.id }, 'ChangeRequests'],
    }),
    deleteException: build.mutation<PendingReceipt | null, { instructorId: string; exceptionId: string }>({
      query: ({ instructorId, exceptionId }) => ({
        url: `/instructors/${instructorId}/availability/exceptions/${exceptionId}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, arg) => [{ type: 'Availability', id: arg.instructorId }, 'ChangeRequests'],
    }),
  }),
});

export const {
  useInstructorsQuery,
  useUpdateInstructorMutation,
  useAvailabilityQuery,
  useSaveAvailabilityMutation,
  useAddExceptionMutation,
  useDeleteExceptionMutation,
  usePublicBookingInstructorsQuery,
} = instructorApi;
