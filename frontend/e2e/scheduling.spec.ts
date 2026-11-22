import { expect, test } from '@playwright/test';

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? 'e2e-admin@example.com';
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? 'ChessTestAccount!2026';
const instructorPassword = 'Instructor!Test2026';
const mailpitMessagesUrl = process.env.MAILPIT_MESSAGES_URL ?? 'http://127.0.0.1:8025/api/v1/messages';

async function signIn(page: import('@playwright/test').Page, email: string, password: string) {
  page.setDefaultNavigationTimeout(90_000);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Academy workspace')).toBeVisible();
}

async function expectTheme(page: import('@playwright/test').Page, theme: string, pageColor: string, surfaceColor: string) {
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect.poll(() => page.locator('body').evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(pageColor);
  await expect.poll(() => page.locator('main section.bg-surface').first().evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(surfaceColor);
}

/** Themes are saved to the account, so start each run from the default regardless of earlier runs. */
async function resetTheme(page: import('@playwright/test').Page) {
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('radio', { name: /Studio/ }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
}

async function mailCount(page: import('@playwright/test').Page) {
  const response = await page.request.get(mailpitMessagesUrl);
  if (!response.ok()) return 0;
  const data = await response.json() as { total?: number; messages?: unknown[] };
  return data.total ?? data.messages?.length ?? 0;
}

test('login remains usable on a phone viewport with keyboard navigation', async ({ page }) => {
  test.setTimeout(90_000);
  page.setDefaultNavigationTimeout(90_000);
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({
    status: 401,
    json: { detail: 'Sign in required' },
  }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const email = page.getByLabel('Email address');
  const password = page.getByLabel('Password');
  await expect(email).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(email).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(password).toBeFocused();
  const submit = page.getByRole('button', { name: 'Sign in' });
  const bounds = await submit.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
});

test('coach defaults, meeting links, search, calendar actions, deletion, and deactivation work end to end', async ({ browser }) => {
  test.setTimeout(180_000);
  const admin = await browser.newContext();
  const adminPage = await admin.newPage();
  await signIn(adminPage, adminEmail, adminPassword);
  await resetTheme(adminPage);
  await expectTheme(adminPage, 'light', 'rgb(248, 250, 252)', 'rgb(255, 255, 255)');
  const initialMailCount = await mailCount(adminPage);

  const uniqueId = Date.now();
  const instructorEmail = `coach-${uniqueId}@example.com`;
  const instructorName = `E2E Coach ${uniqueId}`;
  const studentName = `Chess Student ${uniqueId}`;
  await adminPage.getByRole('link', { name: 'Coach accounts' }).click();
  await adminPage.getByLabel('Coach email').fill(instructorEmail);
  await adminPage.getByRole('button', { name: 'Create invite' }).click();
  await expect(adminPage.getByText(instructorEmail)).toBeVisible();
  await expect.poll(() => mailCount(adminPage), { timeout: 30_000 }).toBeGreaterThanOrEqual(initialMailCount + 1);

  const registrationUrl = await adminPage.getByLabel('One-time coach registration link').inputValue();
  const instructor = await browser.newPage();
  instructor.setDefaultNavigationTimeout(90_000);
  await instructor.goto(registrationUrl);
  await instructor.getByLabel('Full name').fill(instructorName);
  await instructor.getByLabel('Name shown to students').fill(instructorName);
  await instructor.getByLabel('Country where you live').selectOption('US');
  await instructor.getByLabel('Coach time zone').selectOption('America/New_York');
  await instructor.getByLabel('Create password').fill(instructorPassword);
  await instructor.getByLabel('Confirm password').fill(instructorPassword);
  await instructor.getByRole('button', { name: 'Create coach account' }).click();
  await expect(instructor.getByText('Your coach account is ready.')).toBeVisible();

  await instructor.goto('/forgot/coach', { waitUntil: 'domcontentloaded' });
  await instructor.getByLabel('Coach account email').fill(instructorEmail);
  await instructor.getByRole('button', { name: 'Send reset link' }).click();
  await expect(instructor.getByRole('status')).toContainText('password reset instructions will be sent');
  await expect.poll(() => mailCount(adminPage), { timeout: 30_000 }).toBeGreaterThanOrEqual(initialMailCount + 2);

  await adminPage.getByRole('button', { name: 'Account menu' }).click();
  await adminPage.getByRole('menuitem', { name: /Sign out/ }).click();
  await signIn(instructor, instructorEmail, instructorPassword);

  await instructor.getByRole('link', { name: 'Settings' }).click();
  await expectTheme(instructor, 'light', 'rgb(248, 250, 252)', 'rgb(255, 255, 255)');
  await instructor.getByRole('radio', { name: /Black & White/ }).check();
  await expectTheme(instructor, 'dark', 'rgb(9, 9, 11)', 'rgb(24, 24, 27)');
  await instructor.reload();
  await expectTheme(instructor, 'dark', 'rgb(9, 9, 11)', 'rgb(24, 24, 27)');

  await instructor.getByRole('link', { name: 'My profile' }).click();
  await expectTheme(instructor, 'dark', 'rgb(9, 9, 11)', 'rgb(24, 24, 27)');
  await instructor.getByLabel('Default meeting link (optional)').fill('https://meet.example.test/coach-room');
  await instructor.getByRole('button', { name: 'Save profile' }).click();
  await expect(instructor.getByText('Profile saved.')).toBeVisible();

  await instructor.getByRole('link', { name: 'Availability' }).click();
  await expectTheme(instructor, 'dark', 'rgb(9, 9, 11)', 'rgb(24, 24, 27)');
  for (let index = 0; index < 7; index += 1) {
    await instructor.getByRole('button', { name: 'Add hours' }).nth(index).click();
  }
  // Coach changes wait for an administrator; nothing is bookable until approval.
  await instructor.getByRole('button', { name: 'Submit for approval' }).click();
  await expect(instructor.getByText(/Weekly hours sent for approval/)).toBeVisible();
  await expect(instructor.getByText(/is waiting for admin approval/)).toBeVisible();
  await instructor.getByRole('link', { name: 'Settings' }).click();
  await instructor.getByRole('radio', { name: /Classic Chess/ }).check();
  await expectTheme(instructor, 'classic', 'rgb(247, 243, 232)', 'rgb(255, 253, 246)');
  await instructor.getByRole('link', { name: 'Availability' }).click();
  await expectTheme(instructor, 'classic', 'rgb(247, 243, 232)', 'rgb(255, 253, 246)');
  await instructor.getByRole('button', { name: 'Account menu' }).click();
  await instructor.getByRole('menuitem', { name: /Sign out/ }).click();
  await instructor.close();

  await signIn(adminPage, adminEmail, adminPassword);
  await adminPage.getByRole('link', { name: /^Approvals/ }).click();
  const weeklyRequest = adminPage.getByRole('article', { name: `Weekly availability change from ${instructorName}` });
  await expect(weeklyRequest).toBeVisible({ timeout: 30_000 });
  await weeklyRequest.getByRole('button', { name: 'Approve' }).click();
  await expect(adminPage.getByText(/^Approved: weekly availability change/)).toBeVisible();
  await expect(weeklyRequest).toHaveCount(0);
  await adminPage.getByRole('link', { name: 'Settings' }).click();
  await expectTheme(adminPage, 'light', 'rgb(248, 250, 252)', 'rgb(255, 255, 255)');
  await adminPage.getByRole('radio', { name: /Black & White/ }).check();
  await expectTheme(adminPage, 'dark', 'rgb(9, 9, 11)', 'rgb(24, 24, 27)');
  await adminPage.getByRole('radio', { name: /Classic Chess/ }).check();
  await expectTheme(adminPage, 'classic', 'rgb(247, 243, 232)', 'rgb(255, 253, 246)');
  await adminPage.getByRole('link', { name: 'Book a demo' }).click();
  await expectTheme(adminPage, 'classic', 'rgb(247, 243, 232)', 'rgb(255, 253, 246)');
  await adminPage.getByLabel('Available coaches').selectOption({ label: instructorName });
  await expect(adminPage.getByLabel('Meeting link for this demo (optional)')).toHaveValue('https://meet.example.test/coach-room');
  await adminPage.getByRole('button', { name: /^\d{1,2}:\d{2}\s(?:AM|PM)$/i }).first().click();
  await adminPage.getByRole('button', { name: 'Continue' }).click();
  await adminPage.getByLabel('Student name').fill(studentName);
  await adminPage.getByLabel('Contact email').fill(`student-${uniqueId}@example.com`);
  await adminPage.getByLabel("Student's country").selectOption('US');
  await adminPage.getByLabel('Student time zone').selectOption('America/Los_Angeles');
  await adminPage.getByRole('button', { name: 'Review booking' }).click();
  await expect(adminPage.locator('a[href="https://meet.example.test/coach-room"]')).toBeVisible();

  const bookingResponsePromise = adminPage.waitForResponse((response) =>
    response.url().endsWith('/api/v1/appointments') && response.request().method() === 'POST',
  );
  await adminPage.getByRole('button', { name: 'Confirm demo class' }).click();
  const bookingResponse = await bookingResponsePromise;
  const booking = await bookingResponse.json() as { id: string; meeting_url: string };
  expect(booking.meeting_url).toBe('https://meet.example.test/coach-room');
  await expect(adminPage.getByText('Demo class booked')).toBeVisible();
  await expect(adminPage.getByText('The meeting link is included in the booking details and notifications.')).toBeVisible();
  await expect.poll(() => mailCount(adminPage), { timeout: 30_000 }).toBeGreaterThanOrEqual(initialMailCount + 5);

  await adminPage.goto(`/calendar?appointment=${booking.id}`);
  await expectTheme(adminPage, 'classic', 'rgb(247, 243, 232)', 'rgb(255, 253, 246)');
  await expect.poll(() => adminPage.locator('.calendar-theme .fc .fc-button-primary').first().evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgb(40, 101, 66)');
  const calendarEvent = adminPage.locator('.calendar-theme .fc-event').filter({ hasText: studentName }).first();
  await expect(calendarEvent).toBeVisible({ timeout: 30_000 });
  await expect(calendarEvent).toHaveCSS('background-color', 'rgb(40, 101, 66)');
  await expect(adminPage.getByRole('button', { name: 'Close details' })).toBeVisible();
  await adminPage.context().route('https://meet.example.test/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Mock meeting room</title>' });
  });
  const popupPromise = adminPage.waitForEvent('popup');
  await adminPage.getByRole('link', { name: 'Open meeting link' }).click();
  const meetingWindow = await popupPromise;
  await expect(meetingWindow).toHaveURL('https://meet.example.test/coach-room');
  expect(adminPage.isClosed()).toBe(false);
  await adminPage.getByRole('button', { name: 'Close details' }).click();
  await expect(adminPage).toHaveURL(/\/calendar$/);
  await expect(adminPage.getByRole('button', { name: 'Close details' })).toHaveCount(0);
  await meetingWindow.close();

  await adminPage.getByRole('link', { name: 'Appointments' }).click();
  await expectTheme(adminPage, 'classic', 'rgb(247, 243, 232)', 'rgb(255, 253, 246)');
  await expect(adminPage.getByText(studentName)).toBeVisible({ timeout: 30_000 });
  const appointmentRow = adminPage.getByRole('article').filter({ hasText: studentName });
  await expect(appointmentRow.getByRole('link', { name: 'Join demo' })).toHaveAttribute('href', 'https://meet.example.test/coach-room');

  const search = adminPage.getByLabel('Search appointments');
  await search.fill(studentName.replace(/^C/, 'X'));
  await expect(adminPage.getByText(studentName)).toBeVisible({ timeout: 30_000 });
  await search.fill('');

  await appointmentRow.getByRole('button', { name: 'Reschedule' }).click();
  await expect(adminPage.getByLabel('New demo date')).toBeVisible();
  await adminPage.getByRole('button', { name: 'Cancel rescheduling' }).click();
  await expect(adminPage).toHaveURL(/\/calendar$/);
  await expect(adminPage.getByText('Reschedule demo')).toHaveCount(0);

  await adminPage.getByRole('link', { name: 'Appointments' }).click();
  await appointmentRow.getByRole('button', { name: 'Reschedule' }).click();
  const rescheduleDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await adminPage.getByLabel('New demo date').fill(rescheduleDate);
  const newSlot = adminPage.getByRole('button', { name: /^\d{1,2}:\d{2}\s(?:AM|PM)$/i }).first();
  await expect(newSlot).toBeVisible({ timeout: 30_000 });
  await newSlot.click();
  await adminPage.getByLabel('Reason for rescheduling').fill('The family requested another day.');
  await adminPage.getByRole('button', { name: 'Confirm new time' }).click();
  await expect(adminPage.getByText('Demo rescheduled. The coach and client were sent an update.')).toBeVisible();
  await expect.poll(() => mailCount(adminPage), { timeout: 30_000 }).toBeGreaterThanOrEqual(initialMailCount + 8);

  await adminPage.getByRole('link', { name: 'Appointments' }).click();
  await appointmentRow.getByRole('button', { name: 'Notifications' }).click();
  await expect(adminPage.getByText(/rescheduled.*provider accepted/i).first()).toBeVisible({ timeout: 30_000 });
  await appointmentRow.getByRole('button', { name: 'Cancel', exact: true }).click();
  await adminPage.getByLabel('Reason for cancellation').fill('The family no longer needs the demo.');
  await adminPage.getByRole('button', { name: 'Cancel demo class' }).click();
  await expect(appointmentRow.getByText('Cancelled', { exact: true })).toBeVisible();
  await expect.poll(() => mailCount(adminPage), { timeout: 30_000 }).toBeGreaterThanOrEqual(initialMailCount + 11);

  await adminPage.getByRole('link', { name: 'Students' }).click();
  await expectTheme(adminPage, 'classic', 'rgb(247, 243, 232)', 'rgb(255, 253, 246)');
  const studentRow = adminPage.getByRole('article').filter({ hasText: studentName });
  await expect(studentRow).toBeVisible();
  await studentRow.getByRole('button', { name: 'Delete student' }).click();
  await adminPage.getByRole('button', { name: 'Delete student data' }).click();
  await expect(adminPage.getByText('Student record deleted. Past bookings remain without student details.')).toBeVisible();

  await adminPage.getByRole('link', { name: 'Appointments' }).click();
  const deletedAppointmentRow = adminPage.getByRole('article').filter({ hasText: booking.id });
  await expect(deletedAppointmentRow.getByText('Deleted student')).toBeVisible();
  await expect(deletedAppointmentRow.getByText('Cancelled', { exact: true })).toBeVisible();

  await adminPage.getByRole('link', { name: 'Coach accounts' }).click();
  await expectTheme(adminPage, 'classic', 'rgb(247, 243, 232)', 'rgb(255, 253, 246)');
  const coachCard = adminPage.getByRole('article').filter({ hasText: instructorEmail });
  await coachCard.getByRole('button', { name: 'Deactivate' }).click();
  await adminPage.getByRole('button', { name: 'Deactivate coach' }).click();
  await expect(coachCard.getByText('Deactivated')).toBeVisible();

  await adminPage.getByRole('link', { name: 'Settings' }).click();
  await expectTheme(adminPage, 'classic', 'rgb(247, 243, 232)', 'rgb(255, 253, 246)');

  await adminPage.getByRole('link', { name: 'Book a demo' }).click();
  await expectTheme(adminPage, 'classic', 'rgb(247, 243, 232)', 'rgb(255, 253, 246)');
  await expect(adminPage.getByLabel('Available coaches').locator('option', { hasText: instructorName })).toHaveCount(0);
  await resetTheme(adminPage); // leave the shared admin account on its default theme
  await admin.close();
});
