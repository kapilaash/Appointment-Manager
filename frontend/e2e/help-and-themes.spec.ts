import { expect, test } from '@playwright/test';

const admin = {
  id: 'admin-theme-test',
  email: 'admin@example.com',
  role: 'admin',
};

const coach = {
  id: 'coach-help-test',
  email: 'coach@example.com',
  role: 'instructor',
  instructor_profile: { timezone: 'America/New_York', country_code: 'US' },
};

async function mockWorkspace(page: import('@playwright/test').Page, user: typeof admin | typeof coach) {
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: user }));
  await page.route('**/api/v1/auth/me/preferences', async (route) => route.fulfill({
    json: { ...user, theme_preference: (route.request().postDataJSON() as { theme: string }).theme },
  }));
  await page.route('**/api/v1/change-requests/pending-count', (route) => route.fulfill({ json: { pending: 0 } }));
  await page.route('**/api/v1/settings', (route) => route.fulfill({
    json: { demo_duration_minutes: 60, slot_interval_minutes: 30, buffer_before_minutes: 0, buffer_after_minutes: 0 },
  }));
}

test('admins can change themes and find role-specific workflow help on desktop and mobile', async ({ page }) => {
  const browserErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await mockWorkspace(page, admin);
  await page.goto('/settings', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: 'Settings', level: 2 })).toBeVisible();
  const themeGroup = page.getByRole('radiogroup', { name: 'Workspace theme' });
  await expect(themeGroup).toBeVisible();
  const themes = [
    ['light', 'Studio', 'rgb(248, 250, 252)'],
    ['classic', 'Classic Chess', 'rgb(247, 243, 232)'],
    ['dark', 'Black & White', 'rgb(9, 9, 11)'],
  ] as const;
  await expect(themeGroup.getByRole('radio')).toHaveCount(4);
  const savedThemes: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/v1/auth/me/preferences')) savedThemes.push((request.postDataJSON() as { theme: string }).theme);
  });
  for (const [theme, label, background] of themes) {
    const radio = themeGroup.getByRole('radio', { name: new RegExp(label, 'i') });
    await radio.check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(radio).toBeChecked();
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(background);
  }
  expect(await page.evaluate(() => localStorage.getItem('thirumal-theme'))).toBe('dark');
  // The choice is saved to the account so it follows the user to other devices.
  // Studio is the default, so re-selecting it saves nothing; each real change is saved once.
  await expect.poll(() => savedThemes).toEqual(['classic', 'dark']);

  // "Match my device" follows the operating system's light/dark setting live.
  await page.emulateMedia({ colorScheme: 'light' });
  await themeGroup.getByRole('radio', { name: /Match my device/i }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await themeGroup.getByRole('radio', { name: /Black & White/i }).check();

  await page.getByRole('link', { name: 'Help & guides' }).click();
  await expect(page.getByRole('heading', { name: 'Administrator guide' })).toBeVisible();
  await expect(page.getByText('Protect family information')).toBeVisible();
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByRole('navigation', { name: 'Primary mobile navigation' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  const moreButton = page.getByRole('button', { name: 'More workspace pages' });
  await moreButton.focus();
  await page.keyboard.press('Enter');
  await expect(moreButton).toHaveAttribute('aria-expanded', 'true');
  const moreMenu = page.getByRole('navigation', { name: 'More workspace pages' });
  await expect(moreMenu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(moreMenu).toBeHidden();
  await expect(moreButton).toBeFocused();
  await moreButton.click();
  await expect(moreMenu).toBeVisible();
  await moreMenu.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings', level: 2 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(browserErrors).toEqual([]);
});

test('the saved theme is painted before the app loads, so there is no light flash', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('thirumal-theme', 'dark'));
  // Block the application bundle: only public/theme-init.js can set the theme now.
  await page.route('**/src/main.tsx', (route) => route.abort());
  await page.route('**/assets/index-*.js', (route) => route.abort());
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#09090b');
});

test('coaches receive coach guidance and only their permitted pages in mobile navigation', async ({ page }) => {
  await mockWorkspace(page, coach);
  await page.goto('/help', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: 'Coach guide' })).toBeVisible();
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByRole('navigation', { name: 'Primary mobile navigation' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  await page.getByRole('button', { name: 'More workspace pages' }).click();
  const mobileMore = page.getByRole('navigation', { name: 'More workspace pages' });
  await expect(mobileMore.getByRole('link', { name: 'Help & guides' })).toBeVisible();
  await expect(mobileMore.getByRole('link', { name: 'Book a demo' })).toHaveCount(0);
  await expect(mobileMore.getByRole('link', { name: 'Coach accounts' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('a temporary API outage offers recovery without pretending the user is signed out', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/v1/auth/me', (route) => {
    requests += 1;
    return route.fulfill(requests === 1
      ? { status: 503, json: { detail: 'Temporarily unavailable' } }
      : { status: 401, json: { detail: 'Sign in required' } });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Workspace temporarily unavailable' })).toBeVisible();
  await page.getByRole('button', { name: 'Retry connection' }).click();
  await expect(page.getByLabel('Email address')).toBeVisible();
  expect(requests).toBe(2);
});
