import { MigrationInterface, QueryRunner } from 'typeorm';

/** Admin suspend reason (with when) and the moment a viewer deleted their own account (the row stays as an anonymised tombstone). */
export class AccountDataRights1791810000000 implements MigrationInterface {
  name = 'AccountDataRights1791810000000';
  public async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE `users` ADD `suspended_reason` varchar(255) NULL, ADD `suspended_at` datetime(3) NULL, ADD `deleted_at` datetime(3) NULL');
  }
  public async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE `users` DROP COLUMN `deleted_at`, DROP COLUMN `suspended_at`, DROP COLUMN `suspended_reason`');
  }
}
