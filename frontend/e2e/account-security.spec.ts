import { expect, test } from '@playwright/test';
import {
  adminEmail,
  adminPassword,
  createCoach,
  deactivateUser,
  mailText,
  mailTo,
  signIn,
  signOut,
  totp,
} from './support';

test('a user can change their password, turn on two-step sign-in, and recover a forgotten password by email', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const unique = Date.now();
  const email = `security-coach-${unique}@example.com`;
  const name = `Security Coach ${unique}`;
  const firstPassword = 'Opening theory is fun 2026';
  const secondPassword = 'Endgames win tournaments 2026';
  const thirdPassword = 'Rooks belong on open files 2026';

  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await signIn(admin, adminEmail, adminPassword);
  await expect(admin.getByText('Academy workspace')).toBeVisible();
  const coachContext = await browser.newContext();
  const userId = await createCoach(admin, adminContext, coachContext, email, name, firstPassword);

  try {
    const page = await coachContext.newPage();
    await signIn(page, email, firstPassword);
    await expect(page.getByText('Academy workspace')).toBeVisible();

    // --- Change password from the account menu. ---
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('menuitem', { name: 'Password & security' }).click();
    // First visit to a lazily loaded page; a freshly restarted dev server compiles it now.
    await expect(page.getByRole('heading', { name: 'Password & security' })).toBeVisible({ timeout: 30_000 });
    await page.getByLabel('Current password', { exact: true }).fill('not my password at all');
    await page.getByLabel('New password', { exact: true }).fill(secondPassword);
    await page.getByLabel('Confirm new password', { exact: true }).fill(secondPassword);
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByText('Your current password is not correct.')).toBeVisible();
    await page.getByLabel('Current password', { exact: true }).fill(firstPassword);
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByText(/Password changed\. Your other devices were signed out/)).toBeVisible();

    // --- Turn on two-step sign-in. ---
    await page.getByRole('button', { name: 'Set up two-step sign-in' }).click();
    await expect(page.getByRole('img', { name: /QR code/ })).toBeVisible();
    const secret = (await page.locator('code').first().innerText()).replace(/\s/g, '');
    await page.getByLabel('Code from the app').fill(totp(secret));
    await page.getByRole('button', { name: 'Turn on two-step sign-in' }).click();
    const recoveryList = page.getByRole('list', { name: 'Recovery codes' });
    await expect(recoveryList.getByRole('listitem')).toHaveCount(10);
    const recoveryCode = await recoveryList.getByRole('listitem').first().innerText();
    await expect(page.getByRole('button', { name: 'Done' })).toBeDisabled();
    await page.getByLabel('I have saved these codes somewhere safe').check();
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByText(/^On since/)).toBeVisible();
    await signOut(page);

    // --- Sign in again: password, then a recovery code (a fresh authenticator code also works). ---
    await signIn(page, email, secondPassword);
    await expect(page.getByRole('heading', { name: 'Two-step sign-in' })).toBeVisible();
    await page.getByRole('button', { name: /Use a recovery code/ }).click();
    await page.getByLabel('Recovery code').fill(recoveryCode);
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page.getByText('Academy workspace')).toBeVisible();
    await signOut(page);

    // --- Forgot password: email link via Mailpit, then the second step still applies. ---
    const before = (await mailTo(page.request, email)).length;
    await page.goto('/forgot/coach'); // old address still works and redirects
    await expect(page).toHaveURL(/\/forgot-password$/);
    await page.getByLabel('Account email').fill(email);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('status')).toContainText('password reset instructions will be sent');
    await expect
      .poll(async () => (await mailTo(page.request, email)).length, { timeout: 30_000 })
      .toBeGreaterThan(before);
    const resetMail = (await mailTo(page.request, email)).find(
      (message) => message.Subject === 'Reset your Thirumal Chess Academy password',
    );
    expect(resetMail).toBeTruthy();
    const link = (await mailText(page.request, resetMail!.ID)).match(
      /https?:\/\/\S+\/reset-password#token=[\w-]+/,
    )?.[0];
    expect(link).toBeTruthy();
    await page.goto(new URL(link!).pathname + new URL(link!).hash);
    await page.getByLabel('New password', { exact: true }).fill(thirdPassword);
    await page.getByLabel('Confirm new password', { exact: true }).fill(thirdPassword);
    await page.getByRole('button', { name: 'Set new password' }).click();
    await expect(page.getByText(/Password updated/)).toBeVisible();

    await signIn(page, email, thirdPassword);
    await page.getByLabel('Authentication code').fill(totp(secret, Date.now() + 30_000));
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page.getByText('Academy workspace')).toBeVisible();

    // Security notices were emailed for every change.
    await expect
      .poll(async () => (await mailTo(page.request, email)).map((message) => message.Subject), { timeout: 45_000 })
      .toEqual(
        expect.arrayContaining([
          'Your Thirumal Chess Academy password was changed',
          'Two-step sign-in is now on for your account',
        ]),
      );
  } finally {
    await deactivateUser(admin, adminContext, userId);
    await coachContext.close();
    await adminContext.close();
  }
});
