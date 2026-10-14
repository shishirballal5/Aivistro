// Real admin login (password + authenticator code), every page loads without errors, sign out, stays signed out after reload
import { BASE, SHOTS, adminCreds, adminLogin, expectClean, journey, launch, watch } from './lib.mjs';
const creds = adminCreds();
const browser = await launch(); const page = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
const problems = watch(page); const { step } = journey('admin-smoke', page, browser);
await step('admin signs in with MFA', async () => { await adminLogin(page, creds); if (await page.getByText('Admin@123').count()) throw new Error('a prototype password is visible on the page'); });
for (const [route, text] of [['dashboard', /Dashboard|revenue/i], ['series', /Series/], ['episodes', /Episodes/], ['users', /Users/], ['subscriptions', /Subscriptions|Payments/], ['analytics', /Analytics/], ['banners', /Banners/], ['notifications', /Notifications|campaign/i], ['settings', /Team|account/i]]) {
  await step(`page loads: ${route}`, async () => { await page.evaluate((r) => { location.hash = `/${r}`; }, route); await page.waitForTimeout(900); await page.locator('.admin-main').getByText(text).first().waitFor({ timeout: 8000 }); if (await page.locator('.processing-ring').count()) throw new Error('still loading'); await page.screenshot({ path: `${SHOTS}/admin-${route}.png` }); });
}
await step('sign out, and stay signed out after a reload', async () => { await page.locator('.admin-logout').click(); await page.getByText('Admin sign in').waitFor(); await page.reload(); await page.getByText('Admin sign in').waitFor(); });
expectClean(problems); await browser.close();
