// Guest -> sign up -> paywall -> pay (dev gateway) -> real encrypted HLS playback -> next episode -> session survives reload -> watchlist -> sign out
import { BASE, SHOTS, email as mkEmail, expectClean, isoYearsAgo, journey, launch, phone as mkPhone, watch } from './lib.mjs';
const browser = await launch(); const page = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
const problems = watch(page); const { step } = journey('viewer-journey', page, browser);
await step('guest browses the catalog and sees locked episodes', async () => {
  await page.goto(BASE); await page.getByText('Browse as guest').click(); await page.getByText('Trending now').waitFor();
  if (!(await page.locator('.poster-grid .show-card').count())) throw new Error('no series: seed the demo content first (backend: npm run seed:dev && npm run seed:demo)');
  await page.locator('.poster-grid .show-card').first().click(); await page.locator('.ep-chip').first().waitFor();
  if (!(await page.locator('.ep-chip.locked').count())) throw new Error('episodes should be locked for a guest');
});
await step('tapping a locked episode asks the guest to sign in', async () => { await page.locator('.ep-chip').first().click(); await page.getByText('Sign in to continue').waitFor(); });
await step('sign up with phone OTP and profile, then land on the paywall', async () => {
  await page.getByRole('button', { name: /Create an account/ }).click();
  await page.getByPlaceholder('Your name').fill('Journey Viewer'); await page.getByPlaceholder('you@example.com').fill(mkEmail('viewer')); await page.locator('input[type=date]').fill(isoYearsAgo(30)); await page.locator('.phone-input input').fill(mkPhone());
  await page.getByRole('button', { name: 'Send OTP' }).click(); await page.getByRole('button', { name: 'Use it' }).click(); await page.getByRole('button', { name: 'Verify & Continue' }).click();
  await page.getByText('Unlock the full story.').waitFor({ timeout: 15000 });
});
await step('dev payment activates the membership', async () => { await page.getByRole('button', { name: /^Pay / }).click(); await page.getByText('MEMBERSHIP ACTIVE').waitFor({ timeout: 15000 }); });
await step('real HLS playback: decrypted video advances', async () => {
  await page.getByRole('button', { name: 'Start Watching' }).click(); await page.locator('video.player-frame').waitFor();
  await page.waitForFunction(() => { const v = document.querySelector('video'); return v && v.readyState >= 2 && !v.paused && v.currentTime > 1; }, null, { timeout: 25000 });
  await page.screenshot({ path: `${SHOTS}/viewer-player.png` });
});
await step('next episode plays', async () => { await page.getByRole('button', { name: /^Next/ }).click(); await page.waitForFunction(() => { const v = document.querySelector('video'); return v && v.currentTime > 0.5 && !v.paused; }, null, { timeout: 25000 }); });
await step('reload keeps the session', async () => { await page.reload(); await page.getByText('Trending now').waitFor({ timeout: 15000 }); await page.getByRole('button', { name: 'Profile' }).first().click(); await page.getByText('AIVISTRO Premium').first().waitFor(); });
await step('watchlist add persists on the server', async () => {
  await page.getByText('Home').first().click(); await page.locator('.hero-actions button', { hasText: /^\s*My list/ }).click(); await page.waitForTimeout(800);
  await page.reload(); await page.getByRole('button', { name: 'My list' }).first().click(); await page.locator('.list-grid .show-card').first().waitFor({ timeout: 8000 });
});
await step('sign out', async () => { await page.getByRole('button', { name: 'Profile' }).first().click(); await page.getByRole('button', { name: 'Sign out' }).click(); await page.getByText('Trending now').waitFor(); });
expectClean(problems); await browser.close();
