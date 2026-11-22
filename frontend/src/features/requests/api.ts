import { api } from '../../app/store/api';

export type ChangeRequestType =
  | 'weekly_availability'
  | 'exception_add'
  | 'exception_remove'
  | 'timezone_change'
  | 'appointment_cancel'
  | 'appointment_reschedule';
export type ChangeRequestStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'superseded';

type RuleSnapshot = { day_of_week: number; start_local_time: string; end_local_time: string };
type ExceptionSnapshot = {
  exception_date: string;
  start_local_time: string | null;
  end_local_time: string | null;
  exception_type: 'unavailable' | 'additional_available';
  reason: string | null;
};
type AppointmentSnapshot = {
  starts_at: string;
  ends_at: string;
  student_name: string | null;
  student_timezone: string | null;
};

export type ChangeRequest = {
  id: string;
  request_type: ChangeRequestType;
  label: string;
  summary: string;
  status: ChangeRequestStatus;
  instructor_id: string;
  instructor_name: string;
  instructor_timezone: string;
  requested_by_email: string | null;
  appointment_id: string | null;
  exception_id: string | null;
  coach_note: string | null;
  /** The proposed change; the shape depends on request_type. */
  proposed: {
    rules?: RuleSnapshot[];
    timezone?: string;
    country_code?: string | null;
    starts_at?: string;
    ends_at?: string;
    reason?: string;
  } & Partial<ExceptionSnapshot>;
  /** What it looked like when the coach asked. */
  before:
    | ({ rules?: RuleSnapshot[]; timezone?: string; country_code?: string | null } & Partial<ExceptionSnapshot> &
        Partial<AppointmentSnapshot>)
    | null;
  review_note: string | null;
  reviewed_by_email: string | null;
  reviewed_at: string | null;
  created_at: string;
};

/** Returned with HTTP 202 when a coach's change is waiting for an administrator. */
export type PendingReceipt = { request_id: string; status: 'pending'; message: string };

export function isPendingReceipt(value: unknown): value is PendingReceipt {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { status?: unknown }).status === 'pending' &&
    'request_id' in value
  );
}

type ApproveResult = { request: ChangeRequest; affected_bookings: string[]; warning: string | null };

// Approving can change schedules, bookings, coach profiles and dashboard counts.
const appliedTags = ['ChangeRequests', 'Availability', 'Appointment', 'Instructor', 'Dashboard'] as const;

export const changeRequestApi = api.injectEndpoints({
  endpoints: (build) => ({
    changeRequests: build.query<
      { items: ChangeRequest[]; next_cursor: string | null },
      { status?: ChangeRequestStatus; before?: string } | void
    >({
      query: (params) => ({ url: '/change-requests', params: params ?? {} }),
      providesTags: ['ChangeRequests'],
    }),
    pendingChangeRequestCount: build.query<{ pending: number }, void>({
      query: () => '/change-requests/pending-count',
      providesTags: ['ChangeRequests'],
    }),
    approveChangeRequest: build.mutation<ApproveResult, { id: string; review_note?: string }>({
      query: ({ id, ...body }) => ({ url: `/change-requests/${id}/approve`, method: 'POST', body }),
      invalidatesTags: [...appliedTags],
    }),
    rejectChangeRequest: build.mutation<{ request: ChangeRequest }, { id: string; review_note: string }>({
      query: ({ id, ...body }) => ({ url: `/change-requests/${id}/reject`, method: 'POST', body }),
      invalidatesTags: ['ChangeRequests', 'Appointment', 'Availability'],
    }),
    withdrawChangeRequest: build.mutation<{ request: ChangeRequest }, string>({
      query: (id) => ({ url: `/change-requests/${id}/withdraw`, method: 'POST' }),
      invalidatesTags: ['ChangeRequests', 'Appointment', 'Availability'],
    }),
  }),
});

export const {
  useChangeRequestsQuery,
  usePendingChangeRequestCountQuery,
  useApproveChangeRequestMutation,
  useRejectChangeRequestMutation,
  useWithdrawChangeRequestMutation,
} = changeRequestApi;
