// Enrols an authenticator for an admin that has never signed in (created with `npm run admin:create` in backend/) and prints the
// TOTP secret to use as E2E_ADMIN_TOTP_SECRET. Usage: node e2e/tools/enrol-admin.mjs <email> <password>
import { API, totp } from '../lib.mjs';
const [email, password] = process.argv.slice(2); if (!email || !password) { console.error('usage: enrol-admin.mjs <email> <password>'); process.exit(2); }
const post = async (p, b) => { const r = await fetch(API + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${p} -> ${r.status} ${JSON.stringify(j)}`); return j; };
const step = await post('/admin/auth/login', { email, password });
if (step.status !== 'MFA_SETUP_REQUIRED') { console.error('This admin already has an authenticator enrolled. Use its existing secret.'); process.exit(1); }
const { secret } = await post('/admin/auth/mfa/enroll', { setupToken: step.setupToken });
await post('/admin/auth/mfa/confirm', { setupToken: step.setupToken, code: totp(secret) });
console.log(secret);
