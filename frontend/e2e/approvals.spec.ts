import { expect, test } from '@playwright/test';
import { adminEmail, adminPassword, api, createCoach, deactivateUser, isoDate, mailTo, signIn } from './support';

const coachPassword = 'Instructor!Test2026';

async function subjectsTo(request: import('@playwright/test').APIRequestContext, address: string) {
  return (await mailTo(request, address)).map((message) => message.Subject);
}

test('coach requests wait for an admin, who can reject with a note or approve; both sides are told', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const unique = Date.now();
  const coachEmail = `approval-coach-${unique}@example.com`;
  const coachName = `Approval Coach ${unique}`;
  const studentName = `Approval Student ${unique}`;

  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await signIn(admin, adminEmail, adminPassword);
  await expect(admin.getByText('Academy workspace')).toBeVisible();
  let coachUserId = '';

  try {
    // --- Setup through the API: a coach with approved hours and one booked demo. ---
    const coachContext = await browser.newContext();
    coachUserId = await createCoach(admin, adminContext, coachContext, coachEmail, coachName, coachPassword);
    const coachProfile = (
      await api<{ id: string; user_id: string }[]>(admin.request, adminContext, 'GET', '/api/v1/instructors')
    ).find((item) => item.user_id === coachUserId);
    expect(coachProfile).toBeTruthy();
    const coachId = coachProfile!.id;
    // Admin changes apply immediately (no approval needed).
    await api(admin.request, adminContext, 'PUT', `/api/v1/instructors/${coachId}/availability`, {
      rules: Array.from({ length: 7 }, (_, day) => ({
        day_of_week: day,
        start_local_time: '09:00',
        end_local_time: '17:00',
      })),
    });
    const slots = await api<{ slots: string[] }>(
      admin.request,
      adminContext,
      'GET',
      `/api/v1/instructors/${coachId}/available-slots?start_date=${isoDate(2)}&end_date=${isoDate(2)}`,
    );
    expect(slots.slots.length).toBeGreaterThan(0);
    await api(
      admin.request,
      adminContext,
      'POST',
      '/api/v1/appointments',
      {
        instructor_id: coachId,
        starts_at: slots.slots[0],
        duration_minutes: 60,
        student: {
          name: studentName,
          email: `approval-student-${unique}@example.com`,
          country_code: 'US',
          timezone: 'America/Chicago',
        },
      },
      { 'Idempotency-Key': `e2e-${unique}` },
    );

    // --- Coach: request time off and a demo cancellation in the UI. ---
    const coach = await coachContext.newPage();
    await signIn(coach, coachEmail, coachPassword);
    await expect(coach.getByText('Academy workspace')).toBeVisible();
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
    await expect
      .poll(
        async () =>
          (await subjectsTo(admin.request, adminEmail)).filter((subject) => subject.includes(coachName)).length,
        { timeout: 45_000 },
      )
      .toBeGreaterThanOrEqual(2);

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
    await expect(
      coach
        .getByRole('article', { name: `Demo cancellation from ${coachName}` })
        .getByText('Approved', { exact: true }),
    ).toBeVisible();
    await coach.getByRole('link', { name: 'Appointments' }).click();
    // The coach's list may have been cached seconds ago; a reload shows the server's current state.
    await coach.reload();
    await expect(
      coach.getByRole('article').filter({ hasText: studentName }).getByText('Cancelled', { exact: true }),
    ).toBeVisible();

    await expect
      .poll(async () => await subjectsTo(admin.request, coachEmail), { timeout: 45_000 })
      .toEqual(
        expect.arrayContaining([
          'Your request was not approved: Time off or extra hours',
          'Your request was approved: Demo cancellation',
        ]),
      );
    await coachContext.close();
  } finally {
    // Never leave a bookable test coach behind, even if an assertion failed.
    if (coachUserId) await deactivateUser(admin, adminContext, coachUserId);
    await adminContext.close();
  }
});
