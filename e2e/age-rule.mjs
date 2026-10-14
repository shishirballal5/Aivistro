// Sign-up needs name + email + date of birth, minimum age 14: the form, the date picker limit, and the server (new number, email, boundary day)
import { BASE, email as mkEmail, expectClean, isoYearsAgo, journey, launch, phone as mkPhone, watch } from './lib.mjs';
const browser = await launch(); const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const problems = watch(page); const { step } = journey('age-rule', page, browser);
const err = async () => (await page.locator('.form-error').first().innerText()).trim();
await step('sign-up form asks for name, email, date of birth and mobile', async () => { await page.goto(BASE); await page.getByRole('button', { name: 'Get Started' }).click(); for (const l of ['Full name', 'Email address', 'Date of birth', 'Mobile number']) await page.getByText(l, { exact: true }).first().waitFor(); });
await step('missing details are refused before any request', async () => {
  await page.locator('.phone-input input').fill('9876543210'); await page.getByRole('button', { name: 'Send OTP' }).click(); if (!/full name/i.test(await err())) throw new Error('name not required');
  await page.getByPlaceholder('Your name').fill('Teen Tester'); await page.getByRole('button', { name: 'Send OTP' }).click(); if (!/email/i.test(await err())) throw new Error('email not required');
  await page.getByPlaceholder('you@example.com').fill(mkEmail('age')); await page.getByRole('button', { name: 'Send OTP' }).click(); if (!/date of birth/i.test(await err())) throw new Error('dob not required');
});
await step('one day short of 14 is refused', async () => { await page.locator('input[type=date]').fill(isoYearsAgo(14, 1)); await page.getByRole('button', { name: 'Send OTP' }).click(); if (!/at least 14/.test(await err())) throw new Error('age message missing'); });
await step('the date picker will not offer an under-14 date', async () => { if ((await page.locator('input[type=date]').getAttribute('max')) !== isoYearsAgo(14)) throw new Error('max attribute wrong'); });
await step('exactly 14 today is accepted and the account is created', async () => {
  await page.locator('input[type=date]').fill(isoYearsAgo(14)); await page.locator('.phone-input input').fill(mkPhone()); await page.getByRole('button', { name: 'Send OTP' }).click();
  await page.getByRole('button', { name: 'Use it' }).click(); await page.getByRole('button', { name: 'Verify & Continue' }).click(); await page.getByText('Trending now').waitFor();
  await page.getByRole('button', { name: 'Profile' }).first().click(); await page.getByText('Teen Tester').first().waitFor();
});
await step('a NEW phone number signing in gets the details step; under-14 refused, adult accepted', async () => {
  await page.getByRole('button', { name: 'Sign out' }).click(); await page.getByText('Trending now').waitFor();
  await page.getByRole('button', { name: 'Sign in' }).first().click(); await page.locator('.phone-input input').fill(mkPhone()); await page.getByRole('button', { name: 'Send OTP' }).click();
  await page.getByRole('button', { name: 'Use it' }).click(); await page.getByRole('button', { name: 'Verify & Continue' }).click(); await page.getByRole('heading', { name: 'Tell us about you' }).waitFor();
  await page.getByPlaceholder('Your name').fill('Late Joiner'); await page.getByPlaceholder('you@example.com').fill(mkEmail('late')); await page.locator('input[type=date]').fill(isoYearsAgo(12)); await page.getByRole('button', { name: 'Create my account' }).click();
  if (!/at least 14/.test(await err())) throw new Error('no age message'); await page.locator('input[type=date]').fill(isoYearsAgo(30)); await page.getByRole('button', { name: 'Create my account' }).click(); await page.getByText('Trending now').waitFor();
});
expectClean(problems); await browser.close();
