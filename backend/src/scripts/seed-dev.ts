import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import { AdminStatus, AdminUser, Category, ContentStatus, Episode, Genre, Role, Series } from '../database/entities/index';
import { buildTypeOrmOptions } from '../database/typeorm.options';
import { PasswordsService } from '../modules/auth/passwords.service';
import { slugify } from '../modules/catalog/catalog.util';

/**
 * DEVELOPMENT ONLY. Refuses to run when NODE_ENV=production. Creates a dev admin (random password, printed once),
 * sample genres/categories, and sample series with DRAFT episodes. Sample series cannot be published until a real
 * video is uploaded and processed, exactly like real content.
 */
async function main() {
  config({ path: process.env.ENV_FILE ?? '.env' });
  if (process.env.NODE_ENV === 'production') throw new Error('seed:dev refuses to run in production');
  const ds = await new DataSource(buildTypeOrmOptions()).initialize();
  try {
    const passwords = new PasswordsService();
    const email = 'dev-admin@aivistro.local';
    if (!(await ds.getRepository(AdminUser).exists({ where: { email } }))) {
      const password = randomBytes(18).toString('base64url');
      const role = await ds.getRepository(Role).findOneByOrFail({ name: 'SUPER_ADMIN' });
      await ds.getRepository(AdminUser).save({ email, name: 'Dev Admin', passwordHash: await passwords.hash(password), status: AdminStatus.Active, failedLoginCount: 0, lockedUntil: null, lastLoginAt: null, mfaSecretEnc: null, mfaPendingSecretEnc: null, mfaEnabledAt: null, mfaLastUsedStep: null, mfaRecoveryHashes: null, roles: [role] });
      console.log(`Dev admin: ${email}  password (shown once): ${password}  (enrol MFA at first sign-in)`);
    } else console.log(`Dev admin ${email} already exists (password not shown again).`);

    const genres = new Map<string, Genre>();
    for (const name of ['Romance', 'Mystery', 'Thriller', 'Revenge', 'Fantasy', 'Drama', 'Crime']) {
      const slug = slugify(name);
      genres.set(name, (await ds.getRepository(Genre).findOne({ where: { slug } })) ?? (await ds.getRepository(Genre).save({ name, slug })));
    }
    for (const [i, name] of ['Billionaire', 'Second Chances', 'Werewolf', 'Dubbed in Hindi'].entries()) {
      const slug = slugify(name);
      if (!(await ds.getRepository(Category).exists({ where: { slug } }))) await ds.getRepository(Category).save({ name, slug, sortOrder: i });
    }
    const samples: [string, string, string, number][] = [
      ['What She Left Behind', 'Romance', 'Five years after Elise disappears, Theo begins receiving letters only she could have written.', 8],
      ['The Last Alibi', 'Mystery', 'A flawless alibi, a missing hour and a detective who knows the suspect far too well.', 6],
      ['The Heiress Code', 'Revenge', 'Cast out of her own family, she returns with a new name and one rule: never forgive.', 6],
      ['Love, Rewritten', 'Romance', 'She edits his bestselling love stories. He has no idea she is the heroine of every one.', 6],
      ['After Midnight', 'Thriller', 'Every night at 12:07 the same stranger calls. Tonight, she answers.', 6],
      ['Borrowed Vows', 'Drama', 'A marriage of convenience was supposed to last one year. Nobody planned on falling in love.', 6],
      ['Silent Witness', 'Crime', 'The only witness to the crime has not spoken in ten years. Today she takes the stand.', 6],
      ['Moonlit Contract', 'Romance', 'One signature, one summer, and a CEO who is not as cold as his reputation.', 6],
      ['Crown of Ashes', 'Fantasy', 'A kingdom burns. Its forgotten princess walks out of the ashes carrying a stolen crown.', 6],
      ["The Wolf's Promise", 'Fantasy', 'Bound by a promise older than their packs, two enemies must protect the same secret.', 6],
      ['Vengeance in Silk', 'Revenge', 'She ruined his empire thread by thread. Then he asked her to marry him.', 6],
      ['Midnight Tenant', 'Thriller', 'The new tenant pays in cash, never sleeps, and knows what happened in apartment 4B.', 6],
    ];
    for (const [title, genre, synopsis, count] of samples) {
      const slug = slugify(title);
      if (await ds.getRepository(Series).exists({ where: { slug } })) continue;
      const s = await ds.getRepository(Series).save({ slug, title, synopsis, language: 'hi', maturityRating: '16+', releaseYear: 2026, posterKey: null, bannerKey: null, status: ContentStatus.Draft, publishAt: null, publishedAt: null, sortWeight: 0, isFeatured: false, genres: [genres.get(genre)!], categories: [] });
      for (let n = 1; n <= count; n++) await ds.getRepository(Episode).save({ seriesId: s.id, number: n, title: `Episode ${n}`, description: null, durationSeconds: 0, thumbnailKey: null, status: ContentStatus.Draft, publishAt: null, publishedAt: null, currentAssetId: null });
      console.log(`Seeded series "${title}" with ${count} draft episodes`);
    }
  } finally { await ds.destroy(); }
}
main().catch((e) => { console.error(`seed:dev failed: ${e.message}`); process.exit(1); });
