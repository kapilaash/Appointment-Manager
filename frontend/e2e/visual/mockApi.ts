import type { Page, Route } from '@playwright/test';

/**
 * Deterministic API responses for screenshot and accessibility checks: the pages render the
 * same data, at the same frozen time, on every machine.
 */
export const FROZEN_NOW = new Date('2026-03-10T09:30:00Z');

const admin = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'admin@example.com',
  full_name: 'Priya Raman',
  role: 'admin',
  is_active: true,
  theme_preference: null,
  mfa_enabled: false,
  instructor_profile: null,
};

const coaches = [
  {
    id: 'c1',
    user_id: 'u1',
    display_name: 'Arjun Mehta',
    timezone: 'Asia/Kolkata',
    country_code: 'IN',
    meeting_url: 'https://meet.example.com/arjun',
    is_available_for_booking: true,
    email: 'arjun@example.com',
    is_active: true,
  },
  {
    id: 'c2',
    user_id: 'u2',
    display_name: 'Sofia Laurent',
    timezone: 'Europe/Paris',
    country_code: 'FR',
    meeting_url: null,
    is_available_for_booking: true,
    email: 'sofia@example.com',
    is_active: true,
  },
  {
    id: 'c3',
    user_id: 'u3',
    display_name: 'Daniel Okafor',
    timezone: 'America/New_York',
    country_code: 'US',
    meeting_url: null,
    is_available_for_booking: true,
    email: 'daniel@example.com',
    is_active: true,
  },
];

const appointment = (
  id: string,
  coach: (typeof coaches)[number],
  student: string,
  startsAt: string,
  status = 'confirmed',
  pending: string | null = null,
) => ({
  id,
  instructor_id: coach.id,
  student_id: `s-${id}`,
  starts_at: startsAt,
  ends_at: new Date(Date.parse(startsAt) + 3_600_000).toISOString(),
  status,
  meeting_provider: 'manual',
  meeting_url: coach.meeting_url,
  cancellation_reason: status === 'cancelled' ? 'Family asked for another week.' : null,
  reschedule_reason: null,
  instructor_timezone: coach.timezone,
  instructor_name: coach.display_name,
  student: {
    id: `s-${id}`,
    name: student,
    parent_name: 'Parent',
    email: `${student.split(' ')[0]!.toLowerCase()}@example.com`,
    phone: null,
    country_code: 'US',
    timezone: 'America/Chicago',
  },
  pending_request: pending ? { id: `r-${id}`, request_type: pending } : null,
});

const appointments = [
  appointment('a1', coaches[0]!, 'Maya Chen', '2026-03-10T11:00:00Z'),
  appointment('a2', coaches[1]!, 'Leo Martins', '2026-03-10T15:00:00Z', 'confirmed', 'appointment_cancel'),
  appointment('a3', coaches[2]!, 'Ava Johnson', '2026-03-11T14:00:00Z'),
  appointment('a4', coaches[0]!, 'Noah Patel', '2026-03-09T10:00:00Z', 'completed'),
  appointment('a5', coaches[1]!, 'Emma Rossi', '2026-03-12T16:00:00Z', 'cancelled'),
];

const weekly = (start: string, end: string) =>
  Array.from({ length: 5 }, (_, day) => ({ day_of_week: day, start_local_time: start, end_local_time: end }));

const changeRequests = [
  {
    id: 'r1',
    request_type: 'weekly_availability',
    label: 'Weekly availability change',
    summary: 'New weekly hours.',
    status: 'pending',
    instructor_id: 'c1',
    instructor_name: 'Arjun Mehta',
    instructor_timezone: 'Asia/Kolkata',
    requested_by_email: 'arjun@example.com',
    appointment_id: null,
    exception_id: null,
    coach_note: 'New school term timetable.',
    proposed: { rules: weekly('10:00:00', '18:00:00') },
    before: { rules: weekly('09:00:00', '17:00:00') },
    review_note: null,
    reviewed_by_email: null,
    reviewed_at: null,
    created_at: '2026-03-09T08:00:00Z',
  },
  {
    id: 'r2',
    request_type: 'appointment_cancel',
    label: 'Demo cancellation',
    summary: 'Cancel the demo.',
    status: 'pending',
    instructor_id: 'c2',
    instructor_name: 'Sofia Laurent',
    instructor_timezone: 'Europe/Paris',
    requested_by_email: 'sofia@example.com',
    appointment_id: 'a2',
    exception_id: null,
    coach_note: 'Travelling to a tournament.',
    proposed: { reason: 'Travelling to a tournament.' },
    before: {
      starts_at: '2026-03-10T15:00:00Z',
      ends_at: '2026-03-10T16:00:00Z',
      student_name: 'Leo Martins',
      student_timezone: 'America/Chicago',
    },
    review_note: null,
    reviewed_by_email: null,
    reviewed_at: null,
    created_at: '2026-03-09T12:30:00Z',
  },
];

const overview = {
  day: '2026-03-10',
  timezone: 'UTC',
  start: '2026-03-10T00:00:00+00:00',
  end: '2026-03-11T00:00:00+00:00',
  coaches: [
    {
      ...coaches[0]!,
      free: [
        { start: '2026-03-10T03:30:00+00:00', end: '2026-03-10T11:00:00+00:00' },
        { start: '2026-03-10T12:00:00+00:00', end: '2026-03-10T12:30:00+00:00' },
      ],
      booked: [
        { id: 'a1', start: '2026-03-10T11:00:00+00:00', end: '2026-03-10T12:00:00+00:00', student_name: 'Maya Chen' },
      ],
      pending_requests: 1,
    },
    {
      ...coaches[1]!,
      free: [{ start: '2026-03-10T08:00:00+00:00', end: '2026-03-10T15:00:00+00:00' }],
      booked: [
        { id: 'a2', start: '2026-03-10T15:00:00+00:00', end: '2026-03-10T16:00:00+00:00', student_name: 'Leo Martins' },
      ],
      pending_requests: 1,
    },
    {
      ...coaches[2]!,
      free: [{ start: '2026-03-10T13:00:00+00:00', end: '2026-03-10T21:00:00+00:00' }],
      booked: [],
      pending_requests: 0,
    },
  ],
};

function respond(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/** Route every /api/v1 call to fixture data. Pass signedIn=false to see the sign-in page. */
export async function mockApi(page: Page, { signedIn = true }: { signedIn?: boolean } = {}) {
  await page.clock.setFixedTime(FROZEN_NOW);
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const method = route.request().method();
    if (path === '/auth/me')
      return signedIn ? respond(route, admin) : respond(route, { detail: 'Not authenticated' }, 401);
    if (path === '/auth/me/security')
      return respond(route, {
        mfa_enabled: false,
        mfa_enabled_at: null,
        recovery_codes_remaining: 0,
        password_changed_at: null,
      });
    if (path === '/dashboard/summary')
      return respond(route, {
        total_instructors: 3,
        upcoming_appointments: 3,
        today_appointments: 2,
        cancelled_appointments: 1,
      });
    if (path === '/appointments' && method === 'GET') return respond(route, appointments);
    if (path === '/change-requests/pending-count') return respond(route, { pending: changeRequests.length });
    if (path === '/change-requests')
      return respond(route, {
        items: url.searchParams.get('status') === 'pending' ? changeRequests : changeRequests,
        next_cursor: null,
      });
    if (path === '/instructors') return respond(route, coaches);
    if (/^\/instructors\/[^/]+\/availability$/.test(path)) {
      return respond(route, {
        timezone: 'Asia/Kolkata',
        country_code: 'IN',
        rules: weekly('09:00:00', '17:00:00').map((rule, index) => ({ id: `rule-${index}`, ...rule })),
        exceptions: [
          {
            id: 'e1',
            exception_date: '2026-03-20',
            start_local_time: null,
            end_local_time: null,
            exception_type: 'unavailable',
            reason: 'Holi festival',
          },
        ],
        pending_requests: [],
      });
    }
    if (path === '/availability/overview')
      return respond(route, { ...overview, timezone: url.searchParams.get('timezone') ?? 'UTC' });
    if (path === '/settings')
      return respond(route, {
        demo_duration_minutes: 60,
        slot_interval_minutes: 30,
        buffer_before_minutes: 0,
        buffer_after_minutes: 15,
      });
    if (path === '/profile')
      return respond(route, {
        id: admin.id,
        email: admin.email,
        full_name: admin.full_name,
        role: 'admin',
        display_name: admin.full_name,
        timezone: 'UTC',
        country_code: null,
        meeting_url: null,
      });
    return respond(route, method === 'GET' ? [] : {});
  });
}
