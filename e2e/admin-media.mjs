// Admin media: upload a poster (real file, real server-side verification), see it served publicly, reject a fake image, and reorder episodes in one request.
import { readFileSync, writeFileSync } from 'node:fs';
import { BASE, adminApiToken, adminCreds, adminGet, adminLogin, expectClean, journey, launch, unique, watch } from './lib.mjs';
const creds = adminCreds(); const title = `Media Test ${unique()}`;
const jpg = new URL('../backend/seed-assets/images/couple.jpg', import.meta.url).pathname; const fake = '/tmp/not-really-a-png.png'; writeFileSync(fake, 'this is plain text pretending to be an image');
const browser = await launch(); const page = await (await browser.newContext({ viewport: { width: 1360, height: 1000 } })).newPage();
const problems = watch(page); const { step } = journey('admin-media', page, browser);
await step('admin signs in', async () => { await adminLogin(page, creds); });
await step('a fake image is refused by the server with a clear message', async () => {
  await page.evaluate(() => { location.hash = '/series/new'; }); await page.getByText('Poster (required to publish)').first().waitFor();
  await page.getByLabel('Poster (required to publish)').setInputFiles(fake); await page.locator('.iu .a-error, .iu [role=alert], .iu .form-error, .iu small.err, .iu .iu-err').first().waitFor({ timeout: 15000 });
});
await step('a real JPEG uploads, is verified, previews, and is served publicly', async () => {
  await page.getByLabel('Poster (required to publish)').setInputFiles(jpg);
  const img = page.locator('img[alt="Poster (required to publish) preview"]'); await img.waitFor({ timeout: 20000 });
  await page.waitForFunction(() => { const i = document.querySelector('img[alt="Poster (required to publish) preview"]'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 15000 });
  const src = await img.getAttribute('src'); const r = await fetch(new URL(src, BASE)); if (r.status !== 200 || !/image\/jpeg/.test(r.headers.get('content-type') ?? '')) throw new Error(`public image not served: ${r.status} ${r.headers.get('content-type')}`);
  const bytes = Buffer.from(await r.arrayBuffer()); if (Buffer.compare(bytes, readFileSync(jpg)) !== 0) throw new Error('served bytes differ from the uploaded file');
  console.log('    served:', src, `(${bytes.length} bytes, identical to the upload)`);
});
await step('the series saves with that poster', async () => {
  await page.getByPlaceholder('e.g. What She Left Behind').fill(title); await page.locator('textarea').first().fill('A test series created by the browser journey to prove poster upload works.');
  await page.getByRole('button', { name: /Create series/ }).first().click(); await page.waitForTimeout(1500);
  const token = await adminApiToken(creds); const found = (await adminGet(token, `/admin/series?q=${encodeURIComponent(title)}`)).items?.[0];
  if (!found) throw new Error('series not created'); if (!found.posterUrl) throw new Error('poster not saved on the series');
});
await step('episodes reorder with ONE request, and the new order is what the server stores', async () => {
  const token = await adminApiToken(creds); const list = (await adminGet(token, '/admin/series?limit=50')).items; const target = list.find((s) => /Moonlit Contract/.test(s.title)) ?? list.find((s) => s.title !== title);
  const before = (await adminGet(token, `/admin/series/${target.id}/episodes`)).map?.((e) => e.id) ?? (await adminGet(token, `/admin/series/${target.id}/episodes`)).items.map((e) => e.id);
  await page.evaluate((id) => { location.hash = `/episodes/${id}`; }, target.id); await page.getByRole('button', { name: 'Move episode 2 up' }).waitFor({ timeout: 15000 });
  const reorders = []; page.on('request', (rq) => { if (/episodes\/reorder/.test(rq.url()) && rq.method() === 'POST') reorders.push(rq.url()); });
  await page.getByRole('button', { name: 'Move episode 2 up' }).click(); await page.waitForTimeout(1500);
  const afterRaw = await adminGet(token, `/admin/series/${target.id}/episodes`); const after = (afterRaw.items ?? afterRaw).map((e) => e.id);
  if (after[0] !== before[1] || after[1] !== before[0]) throw new Error('order did not change on the server'); if (reorders.length !== 1) throw new Error(`expected 1 reorder request, saw ${reorders.length}`);
  await page.getByRole('button', { name: 'Move episode 2 up' }).click().catch(() => {}); // put it back so the demo data is as it was
  await page.getByRole('button', { name: 'Move episode 1 down' }).click().catch(() => {}); await page.waitForTimeout(1200);
});
expectClean(problems, ['status of 400', 'status of 409']); await browser.close();
