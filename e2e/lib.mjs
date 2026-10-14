// Shared helpers for the browser journeys. They drive the REAL website and admin against a REAL running stack.
import { chromium } from 'playwright-core';
import { createHmac } from 'node:crypto';

export const BASE = process.env.BASE || 'http://localhost:5173';
export const API = process.env.API || `${BASE}/api/v1`;           // the dev/preview server proxies /api, so this works for both
export const SHOTS = process.env.SHOTS || 'e2e/screenshots';

/** Chrome (not bundled Chromium): the video tests need H.264/AAC decoders. Override with E2E_CHANNEL / E2E_EXECUTABLE. */
export async function launch(opts = {}) {
  return chromium.launch({ channel: process.env.E2E_EXECUTABLE ? undefined : (process.env.E2E_CHANNEL || 'chrome'), executablePath: process.env.E2E_EXECUTABLE || undefined, headless: process.env.E2E_HEADED ? false : true, ...opts });
}

export const unique = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
export const phone = () => `9${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 10)}`.slice(0, 10);
export const email = (tag = 'e2e') => `${tag}${unique()}@example.com`;
export const isoYearsAgo = (years, days = 0) => { const t = new Date(); return new Date(Date.UTC(t.getUTCFullYear() - years, t.getUTCMonth(), t.getUTCDate() + days)).toISOString().slice(0, 10); };

/** Runs named steps; the first failure screenshots the page and exits non-zero (so an automated run fails). */
export function journey(name, page, browser) {
  const failures = [];
  const step = async (label, fn) => {
    try { await fn(); console.log('  ✓', label); }
    catch (e) {
      console.log('  ✗', label, '-', String(e.message).split('\n')[0]);
      await page.screenshot({ path: `${SHOTS}/${name}-FAIL-${label.replace(/\W+/g, '_').slice(0, 40)}.png` }).catch(() => {});
      await browser.close().catch(() => {}); process.exit(1);
    }
  };
  console.log(name);
  return { step, failures };
}

/** Collects page errors, failed API calls and Content-Security-Policy violations. */
export function watch(page) {
  const problems = [];
  page.on('pageerror', (e) => problems.push(`page error: ${e.message.slice(0, 120)}`));
  page.on('console', (m) => { if (m.type() === 'error' || /Content Security Policy|Refused to/.test(m.text())) problems.push(`console: ${m.text().slice(0, 120)}`); });
  return problems;
}
export const expectClean = (problems, allow = []) => { const bad = problems.filter((p) => !allow.some((a) => p.includes(a))); if (bad.length) { console.log('  ✗ browser problems:', bad.slice(0, 5)); process.exit(1); } console.log('  ✓ no page errors, no CSP violations'); };

// --- admin authenticator (RFC 6238 TOTP), so tests can sign in to the real MFA login ---
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const fromBase32 = (s) => { let bits = ''; for (const c of s.replace(/=+$/, '').toUpperCase()) bits += B32.indexOf(c).toString(2).padStart(5, '0'); const o = []; for (let i = 0; i + 8 <= bits.length; i += 8) o.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(o); };
export function totp(secret, t = Date.now()) { const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(Math.floor(t / 30000))); const h = createHmac('sha1', fromBase32(secret)).update(c).digest(); const o = h[19] & 15; return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0'); }

export function adminCreds() {
  const { E2E_ADMIN_EMAIL: e, E2E_ADMIN_PASSWORD: p, E2E_ADMIN_TOTP_SECRET: s } = process.env;
  if (!e || !p || !s) { console.log('SKIP: set E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD and E2E_ADMIN_TOTP_SECRET (see e2e/README.md, e2e/tools/enrol-admin.mjs)'); process.exit(0); }
  return { email: e, password: p, secret: s };
}

/** Signs in through the real admin login (password, then authenticator code), retrying across 30 s windows if a code was just used. */
export async function adminLogin(page, { email: e, password, secret }) {
  await page.goto(`${BASE}/admin`);
  await page.getByLabel('Admin email').fill(e); await page.getByLabel('Password').fill(password); await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByText('Two-step verification').waitFor();
  for (let i = 0; i < 3; i++) {
    await page.getByLabel('Authenticator code').fill(totp(secret)); await page.getByRole('button', { name: 'Verify and sign in' }).click();
    try { await page.locator('.admin-shell').waitFor({ timeout: 4000 }); return; } catch { await page.waitForTimeout(31000 - (Date.now() % 30000)); }
  }
  throw new Error('admin login failed after 3 authenticator windows');
}

/** Dev helper: reads the code or link the dev OTP/email adapters "sent" (only exists when the API runs the dev adapters). */
export async function devMessage(to) { const r = await fetch(`${API}/dev/outbox?to=${encodeURIComponent(to)}`); return (await r.json()).message?.body ?? null; }

/** Signs up a brand-new viewer through the real UI (phone OTP + profile). Returns the credentials used. */
export async function signUpViaPhone(page, { name = 'E2E Viewer', age = 30 } = {}) {
  const ph = phone(); const mail = email('viewer');
  await page.goto(BASE); await page.getByRole('button', { name: 'Get Started' }).click();
  await page.getByPlaceholder('Your name').fill(name); await page.getByPlaceholder('you@example.com').fill(mail); await page.locator('input[type=date]').fill(isoYearsAgo(age)); await page.locator('.phone-input input').fill(ph);
  await page.getByRole('button', { name: 'Send OTP' }).click(); await page.getByRole('button', { name: 'Use it' }).click(); await page.getByRole('button', { name: 'Verify & Continue' }).click();
  await page.getByText('Trending now').waitFor();
  return { phone: ph, email: mail };
}

/** Admin API access token through the real two-step login (for tests that need to read or prepare server state). */
export async function adminApiToken({ email: e, password, secret }) {
  const post = async (p, b) => { const r = await fetch(API + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); const j = await r.json().catch(() => ({})); return { ok: r.ok, status: r.status, body: j }; };
  const step = await post('/admin/auth/login', { email: e, password }); if (!step.ok) throw new Error(`admin login failed (${step.status})`);
  for (let i = 0; i < 3; i++) { const v = await post('/admin/auth/mfa/verify', { challengeToken: step.body.challengeToken, code: totp(secret) }); if (v.ok) return v.body.accessToken; await new Promise((r) => setTimeout(r, 31000 - (Date.now() % 30000))); }
  throw new Error('admin MFA failed');
}
export const adminGet = async (token, path) => (await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } })).json();
