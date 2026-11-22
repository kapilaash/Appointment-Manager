import { createHmac } from 'node:crypto';
import { expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';

export const adminEmail = process.env.E2E_ADMIN_EMAIL ?? 'e2e-admin@example.com';
export const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? 'ChessTestAccount!2026';
export const mailpit = process.env.MAILPIT_URL ?? 'http://127.0.0.1:8025';

export async function signIn(page: Page, email: string, password: string) {
  page.setDefaultNavigationTimeout(90_000);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: /Sign out/ }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
}

/** Mutating API calls need the CSRF token the server set as a cookie at sign-in. */
export async function csrfHeaders(context: BrowserContext) {
  const token = (await context.cookies()).find((cookie) => cookie.name === 'csrf_token')?.value ?? '';
  return { 'X-CSRF-Token': decodeURIComponent(token) };
}

export async function api<T>(
  request: APIRequestContext, context: BrowserContext, method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string,
  data?: unknown, extraHeaders: Record<string, string> = {},
): Promise<T> {
  const response = await request.fetch(url, { method, data, headers: { ...(method === 'GET' ? {} : await csrfHeaders(context)), ...extraHeaders } });
  expect(response.ok(), `${method} ${url} → ${response.status()} ${await response.text()}`).toBeTruthy();
  return response.status() === 204 ? (undefined as T) : (await response.json() as T);
}

type MailSummary = { ID: string; Subject: string; Created: string };

export async function mailTo(request: APIRequestContext, address: string): Promise<MailSummary[]> {
  const response = await request.get(`${mailpit}/api/v1/search`, { params: { query: `to:"${address}"` } });
  if (!response.ok()) return [];
  return ((await response.json()) as { messages?: MailSummary[] }).messages ?? [];
}

export async function mailText(request: APIRequestContext, id: string): Promise<string> {
  const response = await request.get(`${mailpit}/api/v1/message/${id}`);
  return ((await response.json()) as { Text: string }).Text;
}

export const isoDate = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

/** Create a coach through the admin API (invitation + registration). Returns ids for cleanup. */
export async function createCoach(admin: Page, adminContext: BrowserContext, coachContext: BrowserContext, email: string, name: string, password: string) {
  const invite = await api<{ registration_url: string }>(admin.request, adminContext, 'POST', '/api/v1/admin/coaches/invitations', { email });
  // The token travels in the URL fragment so it never reaches server logs or referrers.
  const token = new URLSearchParams(new URL(invite.registration_url).hash.slice(1)).get('token') ?? '';
  const registered = await api<{ id: string }>(coachContext.request, coachContext, 'POST', '/api/v1/auth/coach-register', {
    token, full_name: name, display_name: name, country_code: 'US', timezone: 'America/New_York', password,
  });
  return registered.id;
}

export async function deactivateUser(admin: Page, adminContext: BrowserContext, userId: string) {
  await admin.request.patch(`/api/v1/admin/coaches/${userId}/active`, { data: { active: false }, headers: await csrfHeaders(adminContext) });
}

function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const character of input.replace(/[\s=]/g, '').toUpperCase()) bits += alphabet.indexOf(character).toString(2).padStart(5, '0');
  const bytes = bits.match(/.{8}/g) ?? [];
  return Buffer.from(bytes.map((byte) => parseInt(byte, 2)));
}

/** RFC 6238 code, as an authenticator app would show it (test helper only). */
export function totp(secret: string, at = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const digest = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return value.toString().padStart(6, '0');
}
