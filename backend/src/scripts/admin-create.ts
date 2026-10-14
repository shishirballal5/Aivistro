import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import { AdminStatus, AdminUser, Role } from '../database/entities/index';
import { buildTypeOrmOptions } from '../database/typeorm.options';
import { PasswordsService } from '../modules/auth/passwords.service';

/**
 * Creates a SUPER_ADMIN. This is the ONLY way the first admin comes into existence (migrations create no accounts).
 *
 *   ADMIN_EMAIL=you@company.com ADMIN_NAME="Your Name" npm run admin:create
 *
 * If ADMIN_PASSWORD is not given, a random one is generated and printed ONCE. The admin must enrol MFA at first sign-in.
 */
async function main() {
  config({ path: process.env.ENV_FILE ?? '.env' });
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Set ADMIN_EMAIL to a valid email address');
  const name = process.env.ADMIN_NAME?.trim() || 'Administrator';
  const passwords = new PasswordsService();
  const generated = !process.env.ADMIN_PASSWORD;
  const password = process.env.ADMIN_PASSWORD ?? randomBytes(18).toString('base64url');
  passwords.assertStrong(password);

  const ds = await new DataSource(buildTypeOrmOptions()).initialize();
  try {
    if (await ds.getRepository(AdminUser).exists({ where: { email } })) throw new Error(`An admin with email ${email} already exists`);
    const role = await ds.getRepository(Role).findOne({ where: { name: 'SUPER_ADMIN' }, relations: { permissions: true } });
    if (!role) throw new Error('SUPER_ADMIN role not found. Run migrations first (npm run migration:run).');
    await ds.getRepository(AdminUser).save({ email, name, passwordHash: await passwords.hash(password), status: AdminStatus.Active, failedLoginCount: 0, lockedUntil: null, lastLoginAt: null, mfaSecretEnc: null, mfaPendingSecretEnc: null, mfaEnabledAt: null, mfaLastUsedStep: null, mfaRecoveryHashes: null, roles: [role] });
    console.log(`Created SUPER_ADMIN ${email}`);
    if (generated) console.log(`Temporary password (shown once, store it securely): ${password}`);
    console.log('At first sign-in you will be asked to set up an authenticator app (MFA).');
  } finally {
    await ds.destroy();
  }
}
main().catch((e) => { console.error(`admin:create failed: ${e.message}`); process.exit(1); });
