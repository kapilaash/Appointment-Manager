import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? 'e2e-admin@example.com';
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? 'ChessTestAccount!2026';
const coachPassword = 'Instructor!Test2026';
const mailpit = process.env.MAILPIT_URL ?? 'http://127.0.0.1:8025';

async function signIn(page: Page, email: string, password: string) {
  page.setDefaultNavigationTimeout(90_000);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Academy workspace')).toBeVisible();
}

/** Mutating API calls need the CSRF token the server set as a cookie at sign-in. */
async function csrfHeaders(context: BrowserContext) {
  const token = (await context.cookies()).find((cookie) => cookie.name === 'csrf_token')?.value ?? '';
  return { 'X-CSRF-Token': decodeURIComponent(token) };
}

async function api<T>(request: APIRequestContext, context: BrowserContext, method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, data?: unknown, extraHeaders: Record<string, string> = {}): Promise<T> {
  const response = await request.fetch(url, { method, data, headers: { ...(method === 'GET' ? {} : await csrfHeaders(context)), ...extraHeaders } });
  expect(response.ok(), `${method} ${url} → ${response.status()} ${await response.text()}`).toBeTruthy();
  return response.status() === 204 ? (undefined as T) : (await response.json() as T);
}

async function mailTo(request: APIRequestContext, address: string): Promise<string[]> {
  const response = await request.get(`${mailpit}/api/v1/search`, { params: { query: `to:"${address}"` } });
  if (!response.ok()) return [];
  const data = await response.json() as { messages?: { Subject: string }[] };
  return (data.messages ?? []).map((message) => message.Subject);
}

const isoDate = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

test('coach requests wait for an admin, who can reject with a note or approve; both sides are told', async ({ browser }) => {
  test.setTimeout(240_000);
  const unique = Date.now();
  const coachEmail = `approval-coach-${unique}@example.com`;
  const coachName = `Approval Coach ${unique}`;
  const studentName = `Approval Student ${unique}`;

  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await signIn(admin, adminEmail, adminPassword);
  let coachUserId = '';

  try {
    // --- Setup through the API: a coach with approved hours and one booked demo. ---
    const invite = await api<{ registration_url: string }>(admin.request, adminContext, 'POST', '/api/v1/admin/coaches/invitations', { email: coachEmail });
    // The token travels in the URL fragment so it never reaches server logs or referrers.
    const token = new URLSearchParams(new URL(invite.registration_url).hash.slice(1)).get('token') ?? '';
    const coachContext = await browser.newContext();
    const registered = await api<{ id: string }>(coachContext.request, coachContext, 'POST', '/api/v1/auth/coach-register', {
      token, full_name: coachName, display_name: coachName, country_code: 'US', timezone: 'America/New_York', password: coachPassword,
    });
    coachUserId = registered.id;
    const coachProfile = (await api<{ id: string; user_id: string }[]>(admin.request, adminContext, 'GET', '/api/v1/instructors'))
      .find((item) => item.user_id === coachUserId);
    expect(coachProfile).toBeTruthy();
    const coachId = coachProfile!.id;
    // Admin changes apply immediately (no approval needed).
    await api(admin.request, adminContext, 'PUT', `/api/v1/instructors/${coachId}/availability`, {
      rules: Array.from({ length: 7 }, (_, day) => ({ day_of_week: day, start_local_time: '09:00', end_local_time: '17:00' })),
    });
    const slots = await api<{ slots: string[] }>(admin.request, adminContext, 'GET', `/api/v1/instructors/${coachId}/available-slots?start_date=${isoDate(2)}&end_date=${isoDate(2)}`);
    expect(slots.slots.length).toBeGreaterThan(0);
    await api(admin.request, adminContext, 'POST', '/api/v1/appointments', {
      instructor_id: coachId, starts_at: slots.slots[0], duration_minutes: 60,
      student: { name: studentName, email: `approval-student-${unique}@example.com`, country_code: 'US', timezone: 'America/Chicago' },
    }, { 'Idempotency-Key': `e2e-${unique}` });

    // --- Coach: request time off and a demo cancellation in the UI. ---
    const coach = await coachContext.newPage();
    await signIn(coach, coachEmail, coachPassword);
    await coach.getByRole('link', { name: 'Availability' }).click();
    await coach.getByLabel('Exception date').fill(isoDate(5));
    await coach.getByLabel('Reason').fill('Chess tournament');
    await coach.getByRole('button', { name: 'Request exception' }).click();
    await expect(coach.getByText('Request sent. It appears below as awaiting approval.')).toBeVisible();
    await expect(coach.getByText('Awaiting approval', { exact: true })).toBeVisible();

    await coach.getByRole('link', { name: 'Appointments' }).click();
    const demo = coach.getByRole('article').filter({ hasText: studentName });
    await demo.getByRole('button', { name: 'Request cancellation' }).click();
    await coach.getByLabel('Reason for cancellation').fill('Family emergency on that day');
    await coach.getByRole('button', { name: 'Send for approval' }).click();
    await expect(coach.getByText(/Cancellation request sent/)).toBeVisible();
    await expect(demo.getByText('Cancellation awaiting approval')).toBeVisible();
    await expect(demo.getByText('Confirmed')).toBeVisible(); // nothing changes until approval

    // Every active admin is emailed about new requests.
    await expect.poll(async () => (await mailTo(admin.request, adminEmail)).filter((subject) => subject.includes(coachName)).length, { timeout: 45_000 }).toBeGreaterThanOrEqual(2);

    // --- Admin: reject the time off with a note, approve the cancellation. ---
    await admin.getByRole('link', { name: /^Approvals/ }).click();
    const timeOff = admin.getByRole('article', { name: `Time off or extra hours from ${coachName}` });
    await timeOff.getByRole('button', { name: 'Reject' }).click();
    await admin.getByLabel('Note for the coach').fill('A family is already booked that afternoon');
    await admin.getByRole('button', { name: 'Reject request' }).click();
    await expect(admin.getByText(`Not approved. ${coachName} has been emailed your note.`)).toBeVisible();
    await expect(timeOff).toHaveCount(0);

    const cancellation = admin.getByRole('article', { name: `Demo cancellation from ${coachName}` });
    await expect(cancellation).toContainText('Cancelled'); // before/after shows what approval will do
    await cancellation.getByRole('button', { name: 'Approve' }).click();
    await expect(admin.getByText(/^Approved: demo cancellation/)).toBeVisible();

    // --- Coach: sees both outcomes and the demo is cancelled. ---
    await coach.getByRole('link', { name: 'My requests' }).click();
    await coach.getByRole('tab', { name: 'All' }).click();
    const rejected = coach.getByRole('article', { name: `Time off or extra hours from ${coachName}` });
    await expect(rejected.getByText('Not approved')).toBeVisible();
    await expect(rejected.getByText(/A family is already booked that afternoon/)).toBeVisible();
    await expect(coach.getByRole('article', { name: `Demo cancellation from ${coachName}` }).getByText('Approved', { exact: true })).toBeVisible();
    await coach.getByRole('link', { name: 'Appointments' }).click();
    // The coach's list may have been cached seconds ago; a reload shows the server's current state.
    await coach.reload();
    await expect(coach.getByRole('article').filter({ hasText: studentName }).getByText('Cancelled', { exact: true })).toBeVisible();

    await expect.poll(async () => await mailTo(admin.request, coachEmail), { timeout: 45_000 })
      .toEqual(expect.arrayContaining([
        'Your request was not approved: Time off or extra hours',
        'Your request was approved: Demo cancellation',
      ]));
    await coachContext.close();
  } finally {
    // Never leave a bookable test coach behind, even if an assertion failed.
    if (coachUserId) {
      await admin.request.patch(`/api/v1/admin/coaches/${coachUserId}/active`, { data: { active: false }, headers: await csrfHeaders(adminContext) });
    }
    await adminContext.close();
  }
});
