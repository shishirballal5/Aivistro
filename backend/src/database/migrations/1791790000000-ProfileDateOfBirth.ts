import { MigrationInterface, QueryRunner } from 'typeorm';

/** Adds the date of birth used to enforce the minimum sign-up age. Nullable: accounts created earlier have none. */
export class ProfileDateOfBirth1791790000000 implements MigrationInterface {
  name = 'ProfileDateOfBirth1791790000000';
  public async up(q: QueryRunner): Promise<void> { await q.query('ALTER TABLE `profiles` ADD `date_of_birth` date NULL'); }
  public async down(q: QueryRunner): Promise<void> { await q.query('ALTER TABLE `profiles` DROP COLUMN `date_of_birth`'); }
}
