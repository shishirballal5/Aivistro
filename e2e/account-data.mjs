// Viewer data rights: payment history, "Download my data" (real file), "Delete my account" with the active-subscription guard,
// tokens dead afterwards, and the same phone can sign up again as a brand-new account.
import { readFileSync } from 'node:fs';
import { BASE, email as mkEmail, expectClean, isoYearsAgo, journey, launch, watch } from './lib.mjs';
const browser = await launch(); const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true })).newPage();
const problems = watch(page); const { step } = journey('account-data', page, browser);
const ph = `9${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 10)}`.slice(0, 10); const mail = mkEmail('data');
const signUp = async (name, mailAddr) => {
  await page.goto(BASE); await page.getByRole('button', { name: 'Get Started' }).click();
  await page.getByPlaceholder('Your name').fill(name); await page.getByPlaceholder('you@example.com').fill(mailAddr); await page.locator('input[type=date]').fill(isoYearsAgo(28)); await page.locator('.phone-input input').fill(ph);
  await page.getByRole('button', { name: 'Send OTP' }).click(); await page.getByRole('button', { name: 'Use it' }).click(); await page.getByRole('button', { name: 'Verify & Continue' }).click(); await page.getByText('Trending now').waitFor();
};
await step('sign up and buy a monthly plan', async () => {
  await signUp('Data Tester', mail);
  await page.getByText('Explore Premium').click(); await page.getByText('Unlock the full story.').waitFor(); await page.getByRole('radio', { name: /Monthly/ }).click();
  await page.getByRole('button', { name: /^Pay ₹149/ }).click(); await page.getByText('MEMBERSHIP ACTIVE').waitFor({ timeout: 15000 }); await page.getByRole('button', { name: 'Explore AIVISTRO' }).click(); await page.getByText('Trending now').waitFor();
});
await step('profile shows the payment in the payment history', async () => {
  await page.getByRole('button', { name: 'Profile' }).first().click(); const hist = page.getByLabel('Payment history'); await hist.waitFor();
  const txt = await hist.innerText(); if (!/149/.test(txt)) throw new Error(`payment not listed: ${txt.slice(0, 120)}`);
});
await step('"Download my data" saves a real JSON file with my data and no secrets', async () => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download my data' }).click()]);
  const raw = readFileSync(await dl.path(), 'utf8'); const data = JSON.parse(raw);
  const flat = raw.toLowerCase();
  if (!flat.includes(mail.toLowerCase())) throw new Error('own email missing from export');
  if (!data.generatedAt) throw new Error('no generatedAt');
  for (const banned of ['tokenhash', 'password_hash', 'passwordhash', 'refresh_token', '"secret"']) if (flat.includes(banned)) throw new Error(`export contains ${banned}`);
  console.log('    export keys:', Object.keys(data).join(', '));
});
await step('delete: confirmation needs the word DELETE, and the active subscription must be acknowledged', async () => {
  await page.getByRole('button', { name: 'Delete my account' }).first().click(); await page.getByRole('heading', { name: 'Delete your account?' }).waitFor();
  const del = page.locator('.ad-dialog').getByRole('button', { name: 'Delete my account' });
  if (!(await del.isDisabled())) throw new Error('delete enabled before typing DELETE');
  await page.getByLabel('Type DELETE to confirm').fill('DELETE'); await del.click();
  await page.locator('.ad-dialog .form-error').waitFor(); console.log('    server said:', (await page.locator('.ad-dialog .form-error').innerText()).replace(/\s+/g, ' ').slice(0, 120));
  await page.locator('.ad-check input').check(); await del.click();
});
await step('account deleted: back on the home page signed out, and a reload finds no session', async () => {
  await page.getByText('Trending now').waitFor({ timeout: 15000 }); await page.getByRole('button', { name: 'Sign in' }).first().waitFor();
  await page.reload(); await page.getByRole('button', { name: 'Get Started' }).waitFor(); // a signed-out visitor lands on the welcome screen
});
await step('the same phone number can sign up again as a brand-new account (no subscription, nothing restored)', async () => {
  await signUp('Second Life', mkEmail('again'));
  await page.getByRole('button', { name: 'Profile' }).first().click(); await page.getByText('Second Life').first().waitFor();
  if (await page.getByText('AIVISTRO Premium').count()) throw new Error('old subscription leaked into the new account');
  if (await page.getByText('Data Tester').count()) throw new Error('old name came back');
});
expectClean(problems, ['status of 401', 'status of 409']); // expected: the deleted account's old token is rejected (401); the subscription guard answers 409 await browser.close();
