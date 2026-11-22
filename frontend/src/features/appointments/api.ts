import { api } from '../../app/store/api';
import type { ChangeRequestType, PendingReceipt } from '../requests/api';

export type Student = { id: string; name: string; parent_name?: string | null; email: string; phone?: string | null; country_code: string | null; timezone: string };
export type Appointment = {
  id: string;
  instructor_id: string;
  student_id: string | null;
  starts_at: string;
  ends_at: string;
  status: 'confirmed' | 'cancelled' | 'completed';
  cancellation_reason?: string | null;
  reschedule_reason?: string | null;
  instructor_timezone: string;
  meeting_provider: 'manual';
  meeting_url?: string | null;
  student: Student | null;
  instructor_name: string;
  /** A coach's cancel/reschedule request waiting for an administrator (list endpoint only). */
  pending_request?: { id: string; request_type: Extract<ChangeRequestType, 'appointment_cancel' | 'appointment_reschedule'> } | null;
};
export type PublicBookingReceipt = { id: string; starts_at: string; ends_at: string; status: 'confirmed'; meeting_url?: null };

export const appointmentApi = api.injectEndpoints({
  endpoints: (build) => ({
    appointments: build.query<Appointment[], { status?: string; instructor_id?: string; start?: string; end?: string } | void>({
      query: (params) => params ? ({ url: '/appointments', params }) : '/appointments', providesTags: ['Appointment'],
    }),
    searchAppointments: build.query<{ items: Appointment[]; estimated_total_hits: number }, { query: string; status?: string }>({
      query: (body) => ({ url: '/appointments/search', method: 'POST', body }), providesTags: ['Appointment'],
    }),
    availableSlots: build.query<{ timezone: string; slots: string[] }, { instructorId: string; start: string; end: string; duration?: number; excludeAppointmentId?: string }>({
      query: ({ instructorId, start, end, duration, excludeAppointmentId }) => ({
        url: `/instructors/${instructorId}/available-slots`, params: { start_date: start, end_date: end, duration_minutes: duration, exclude_appointment_id: excludeAppointmentId },
      }), providesTags: (_result, _error, arg) => [{ type: 'Availability', id: arg.instructorId }],
    }),
    publicAvailableSlots: build.query<{ timezone: string; slots: string[] }, { instructorId: string; start: string; end: string; duration?: number }>({
      query: ({ instructorId, start, end, duration }) => ({
        url: `/public/instructors/${instructorId}/available-slots`,
        params: { start_date: start, end_date: end, duration_minutes: duration },
      }), providesTags: (_result, _error, arg) => [{ type: 'Availability', id: arg.instructorId }],
    }),
    publicBookingSettings: build.query<{ demo_duration_minutes: number }, void>({ query: () => '/public/booking-settings' }),
    appointment: build.query<Appointment, string>({
      query: (id) => `/appointments/${id}`, providesTags: (_result, _error, id) => [{ type: 'Appointment', id }],
    }),
    createAppointment: build.mutation<Appointment, {
      instructor_id: string; starts_at: string; duration_minutes: number;
      student: { name: string; parent_name?: string | undefined; email: string; phone?: string | undefined; country_code: string; timezone: string }; notes?: string | undefined; meeting_url?: string | null | undefined; idempotencyKey: string;
    }>({
      query: ({ idempotencyKey, ...body }) => ({ url: '/appointments', method: 'POST', body, headers: { 'Idempotency-Key': idempotencyKey } }),
      invalidatesTags: ['Appointment', 'Availability', 'Dashboard'],
    }),
    createPublicAppointment: build.mutation<PublicBookingReceipt, {
      instructor_id: string; starts_at: string; duration_minutes: number;
      student: { name: string; parent_name?: string | undefined; email: string; phone?: string | undefined; country_code: string; timezone: string };
      notes?: string | undefined; website: string; idempotencyKey: string;
    }>({
      query: ({ idempotencyKey, ...body }) => ({ url: '/public/appointments', method: 'POST', body, headers: { 'Idempotency-Key': idempotencyKey } }),
      invalidatesTags: ['Appointment', 'Availability', 'Dashboard'],
    }),
    cancelAppointment: build.mutation<{ status: string } | PendingReceipt, { id: string; reason: string }>({
      query: ({ id, reason }) => ({ url: `/appointments/${id}/cancel`, method: 'POST', body: { reason } }),
      invalidatesTags: ['Appointment', 'Availability', 'Dashboard', 'ChangeRequests'],
    }),
    rescheduleAppointment: build.mutation<Appointment | PendingReceipt, { id: string; starts_at: string; reason: string }>({
      query: ({ id, ...body }) => ({ url: `/appointments/${id}/reschedule`, method: 'POST', body }),
      invalidatesTags: ['Appointment', 'Availability', 'Dashboard', 'ChangeRequests'],
    }),
    completeAppointment: build.mutation<{ status: string }, string>({
      query: (id) => ({ url: `/appointments/${id}/complete`, method: 'POST' }),
      invalidatesTags: ['Appointment', 'Dashboard'],
    }),
    appointmentNotifications: build.query<{ event_type: string; recipient: string; delivery_status: string; attempt_count: number; last_error?: string | null }[], string>({
      query: (id) => `/appointments/${id}/notifications`,
    }),
    dashboard: build.query<{ total_instructors: number; upcoming_appointments: number; today_appointments: number; cancelled_appointments: number }, void>({
      query: () => '/dashboard/summary', providesTags: ['Dashboard'],
    }),
    settings: build.query<{ demo_duration_minutes: number; slot_interval_minutes: number; buffer_before_minutes: number; buffer_after_minutes: number }, void>({
      query: () => '/settings',
    }),
    saveSettings: build.mutation<Record<string, number>, { demo_duration_minutes: number; slot_interval_minutes: number; buffer_before_minutes: number; buffer_after_minutes: number }>({
      query: (body) => ({ url: '/settings', method: 'PUT', body }), invalidatesTags: ['Dashboard', 'Availability'],
    }),
  }),
});

export const {
  useAppointmentsQuery, useSearchAppointmentsQuery, useAppointmentQuery, useAvailableSlotsQuery, useCreateAppointmentMutation,
  usePublicAvailableSlotsQuery, useCreatePublicAppointmentMutation,
  usePublicBookingSettingsQuery,
  useCancelAppointmentMutation, useRescheduleAppointmentMutation,
  useCompleteAppointmentMutation,
  useDashboardQuery, useSettingsQuery, useSaveSettingsMutation, useAppointmentNotificationsQuery,
} = appointmentApi;
