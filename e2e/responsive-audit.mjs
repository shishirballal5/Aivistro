// Desktop / tablet / phone: no horizontal overflow, no broken images, no layout shift, no console errors on the main viewer screens
import { BASE, SHOTS, launch, watch } from './lib.mjs';
const browser = await launch(); const sizes = { desktop: { width: 1440, height: 900 }, tablet: { width: 820, height: 1100 }, phone: { width: 390, height: 844 } }; let bad = 0;
for (const [sz, vp] of Object.entries(sizes)) {
  const ctx = await browser.newContext({ viewport: vp, isMobile: sz === 'phone' }); const page = await ctx.newPage(); const problems = watch(page);
  await page.addInitScript(() => { window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); });
  const check = async (label) => {
    await page.waitForTimeout(1500);
    const r = await page.evaluate(() => ({ over: document.documentElement.scrollWidth - window.innerWidth, broken: [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.src && !i.src.startsWith('data:')).length, cls: +(window.__cls || 0).toFixed(3) }));
    await page.screenshot({ path: `${SHOTS}/audit-${sz}-${label}.png` });
    const fail = r.over > 1 || r.broken || r.cls > 0.1; if (fail) bad++; console.log(`  ${fail ? '✗' : '✓'} ${sz.padEnd(7)} ${label.padEnd(9)} overflow=${r.over} brokenImages=${r.broken} CLS=${r.cls}`);
  };
  await page.goto(BASE); await check('welcome'); await page.getByText('Browse as guest').click(); await page.getByText('Trending now').waitFor(); await check('home');
  await page.locator('.poster-grid .show-card').first().click(); await page.locator('.ep-chip').first().waitFor(); await check('series');
  await page.goto(BASE); await page.getByText('Browse as guest').click(); await page.getByText('Trending now').waitFor(); await page.getByText('See Membership').click(); await page.getByText('Unlock the full story.').waitFor(); await check('plans');
  const issues = problems.filter((p) => !p.includes('401')); if (issues.length) { bad++; console.log('  ✗', sz, issues.slice(0, 3)); }
  await ctx.close();
}
await browser.close(); process.exit(bad ? 1 : 0);
