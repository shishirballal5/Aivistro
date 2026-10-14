// Email sign-up and verification, wrong password, password reset, unsubscribed paywall, a FAILED payment grants nothing
import { BASE, email as mkEmail, expectClean, isoYearsAgo, journey, launch, watch } from './lib.mjs';
const browser = await launch(); const page = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
const problems = watch(page); const { step } = journey('viewer-email', page, browser);
const mail = mkEmail('mail'); const pw1 = 'Correct-Horse-9'; const pw2 = 'Another-Horse-77';
const useDev = async () => { await page.getByText('Development only').waitFor(); await page.getByRole('button', { name: 'Use it' }).click(); };
const signIn = async (pw) => { await page.getByRole('tab', { name: 'Email' }).click(); await page.getByPlaceholder('you@example.com').fill(mail); await page.getByPlaceholder('Your password').fill(pw); await page.getByRole('button', { name: 'Sign In' }).click(); };
await step('email sign-up leads to "check your email"', async () => {
  await page.goto(BASE); await page.getByRole('button', { name: 'Get Started' }).click(); await page.getByRole('tab', { name: 'Email' }).click();
  await page.getByPlaceholder('Your name').fill('Test Viewer'); await page.getByPlaceholder('you@example.com').fill(mail); await page.getByPlaceholder('At least 10 characters').fill(pw1); await page.locator('input[type=date]').fill(isoYearsAgo(25));
  await page.getByRole('button', { name: 'Create Account' }).click(); await page.getByText('Check your email').waitFor();
});
await step('signing in before verifying is refused with a path to verify', async () => { await page.goto(BASE); await page.getByRole('button', { name: 'I already have an account' }).click(); await signIn(pw1); await page.getByText('Check your email').waitFor(); });
await step('verify with the captured link, then sign in', async () => { await useDev(); await page.getByRole('button', { name: 'Verify email' }).click(); await page.getByText('Sign in to continue').waitFor(); await signIn(pw1); await page.getByText('Trending now').waitFor(); });
await step('wrong password shows a server message', async () => {
  await page.getByRole('button', { name: 'Profile' }).first().click(); await page.getByRole('button', { name: 'Sign out' }).click(); await page.getByText('Trending now').waitFor();
  await page.getByRole('button', { name: 'Sign in' }).first().click(); await signIn('nope-nope-nope'); await page.locator('.form-error').waitFor();
});
await step('forgot + reset password: old rejected, new accepted', async () => {
  await page.getByRole('button', { name: 'Forgot password?' }).click(); await page.getByPlaceholder('you@example.com').fill(mail); await page.getByRole('button', { name: 'Send reset link' }).click();
  await page.getByText('Reset password').first().waitFor(); await useDev(); await page.getByPlaceholder('At least 10 characters').fill(pw2); await page.getByPlaceholder('Enter it again').fill(pw2); await page.getByRole('button', { name: 'Reset Password' }).click();
  await page.getByText('Sign in to continue').waitFor(); await signIn(pw1); await page.locator('.form-error').waitFor(); await page.getByPlaceholder('Your password').fill(pw2); await page.getByRole('button', { name: 'Sign In' }).click(); await page.getByText('Trending now').waitFor();
});
await step('unsubscribed viewer is sent to the plans page for a locked episode', async () => { await page.locator('.poster-grid .show-card').first().click(); await page.locator('.ep-chip').first().click(); await page.getByText('Unlock the full story.').waitFor(); });
await step('a FAILED payment grants nothing', async () => {
  await page.getByRole('button', { name: /Simulate a failed payment/ }).click(); await page.getByText('PAYMENT FAILED').waitFor(); await page.getByRole('button', { name: 'Try Again' }).click(); await page.getByRole('button', { name: 'Close' }).click();
  await page.locator('.ep-chip.locked').first().waitFor(); await page.reload(); await page.getByRole('button', { name: 'Profile' }).first().click(); await page.getByText('Subscribe to Watch').waitFor();
});
expectClean(problems, ['status of 401', 'status of 403']); // expected: wrong password (401), unverified email (403) await browser.close();
