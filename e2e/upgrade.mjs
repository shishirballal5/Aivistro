// Buy MONTHLY, then upgrade to ANNUAL: the plans page quotes the difference (credit for the unused month), pays it, and access runs ~12 months (not 13)
import { BASE, expectClean, journey, launch, signUpViaPhone, watch } from './lib.mjs';
const browser = await launch(); const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const problems = watch(page); const { step } = journey('upgrade', page, browser);
await step('sign up and buy the monthly plan', async () => {
  await signUpViaPhone(page, { name: 'Upgrade Tester' });
  await page.getByText('Explore Premium').click(); await page.getByText('Unlock the full story.').waitFor(); await page.getByRole('radio', { name: /Monthly/ }).click();
  await page.getByRole('button', { name: /^Pay ₹149/ }).click(); await page.getByText('MEMBERSHIP ACTIVE').waitFor({ timeout: 15000 }); await page.getByRole('button', { name: 'Explore AIVISTRO' }).click(); await page.getByText('Trending now').waitFor();
});
await step('annual is quoted as an upgrade with a credit, not the full price', async () => {
  await page.getByRole('button', { name: 'Profile' }).first().click(); await page.getByRole('button', { name: 'Extend membership' }).click(); await page.getByText('Unlock the full story.').waitFor();
  await page.getByRole('radio', { name: /Annual/ }).click(); await page.getByText('Upgrade: pay only the difference').waitFor();
  const btn = await page.getByRole('button', { name: /^Upgrade and pay/ }).innerText(); if (/1,199/.test(btn)) throw new Error(`still charging the full price: ${btn}`);
  console.log('    ', (await page.locator('[role=note]').first().innerText()).replace(/\s+/g, ' ').slice(0, 200));
});
await step('a same-length purchase is shown as an extension (no credit)', async () => { await page.getByRole('radio', { name: /Monthly/ }).click(); await page.getByText('This extends your membership').waitFor(); await page.getByRole('radio', { name: /Annual/ }).click(); await page.getByText('Upgrade: pay only the difference').waitFor(); });
await step('paying the upgrade activates annual and runs ~12 months', async () => {
  await page.getByRole('button', { name: /^Upgrade and pay/ }).click(); await page.getByText('MEMBERSHIP ACTIVE').waitFor({ timeout: 15000 });
  const m = /until (\d{2} \w{3} (\d{4}))/.exec(await page.locator('.success-modal p').innerText()); if (!m) throw new Error('no end date shown');
  const years = (new Date(m[1]).getTime() - Date.now()) / (365 * 86400000); if (years < 0.97 || years > 1.03) throw new Error(`access should run about 12 months, got ${years.toFixed(2)} years`);
});
expectClean(problems); await browser.close();
