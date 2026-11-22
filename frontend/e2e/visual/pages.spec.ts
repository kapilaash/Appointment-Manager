import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mockApi } from './mockApi';

/**
 * Screenshot comparison and automated accessibility checks for key pages in every theme.
 * Run inside the official Playwright image (npm run test:visual) so pixels match CI exactly;
 * update the approved images deliberately with npm run test:visual:update.
 */
const pages = [
  { name: 'dashboard', path: '/', ready: 'Upcoming demos' },
  { name: 'approvals', path: '/requests', ready: 'Weekly availability change' },
  { name: 'availability', path: '/availability', ready: 'Coach country and time zone' },
  { name: 'team', path: '/team', ready: 'Sofia Laurent' },
  { name: 'appointments', path: '/appointments', ready: 'Maya Chen' },
  { name: 'settings', path: '/settings', ready: 'Demo class defaults' },
  { name: 'security', path: '/profile', ready: 'Two-step sign-in' },
] as const;
const themes = ['light', 'classic', 'dark'] as const;

async function open(page: Page, path: string, ready: string, theme: string) {
  await page.addInitScript((value) => window.localStorage.setItem('thirumal-theme', value), theme);
  await mockApi(page);
  await page.goto(path);
  // A cold dev server compiles each lazily loaded page on first visit.
  await expect(page.getByText(ready, { exact: false }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await page.evaluate(() => document.fonts.ready);
}

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map(
      (violation) =>
        `${violation.id}: ${violation.help} (${violation.nodes.length}) e.g. ${violation.nodes[0]?.target.join(' ')}`,
    );
}

for (const theme of themes) {
  for (const { name, path, ready } of pages) {
    test(`${name} looks right (${theme})`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 860 });
      await open(page, path, ready, theme);
      await expect(page).toHaveScreenshot(`${name}-${theme}-desktop.png`, { fullPage: true });
    });

    test(`${name} is accessible (${theme})`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 860 });
      await open(page, path, ready, theme);
      expect(await seriousViolations(page)).toEqual([]);
    });
  }
}

for (const { name, path, ready } of pages) {
  test(`${name} fits a phone screen`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, path, ready, 'light');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await expect(page).toHaveScreenshot(`${name}-light-mobile.png`, { fullPage: true });
  });
}

test('sign-in page looks right', async ({ page }) => {
  await mockApi(page, { signedIn: false });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot('sign-in.png');
});

test('sign-in page is accessible', async ({ page }) => {
  await mockApi(page, { signedIn: false });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

test.describe('phone bottom sheets', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('dialogs open as a bottom sheet that can be swiped down to close', async ({ page }) => {
    await open(page, '/appointments', 'Maya Chen', 'light');
    await page
      .getByRole('article')
      .filter({ hasText: 'Maya Chen' })
      .getByRole('button', { name: 'Cancel', exact: true })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Cancel this demo class?' });
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect(Math.round(box.y + box.height)).toBe(844); // anchored to the bottom edge
    expect(Math.round(box.width)).toBe(390); // full width
    await expect(page).toHaveScreenshot('cancel-dialog-light-mobile.png');

    // A short drag springs back; a longer one closes the sheet.
    const handle = dialog.locator('[aria-hidden="true"]').first();
    const start = (await handle.boundingBox())!;
    const drag = async (distance: number) => {
      await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
      await page.mouse.down();
      await page.mouse.move(start.x + start.width / 2, start.y + distance, { steps: 8 });
      await page.mouse.up();
    };
    await drag(40);
    await expect(dialog).toBeVisible();
    await drag(220);
    await expect(dialog).toBeHidden();
  });

  test('the More menu can also be swiped away', async ({ page }) => {
    await open(page, '/', 'Upcoming demos', 'light');
    await page.getByRole('button', { name: 'More workspace pages' }).click();
    const menu = page.getByRole('navigation', { name: 'More workspace pages' });
    await expect(menu).toBeVisible();
    const handle = (await menu.locator('[aria-hidden="true"]').first().boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 200, { steps: 8 });
    await page.mouse.up();
    await expect(menu).toBeHidden();
  });
});
