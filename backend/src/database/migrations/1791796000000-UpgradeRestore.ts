import { MigrationInterface, QueryRunner } from 'typeorm';

/** Remembers when the replaced plan WOULD have ended, so fully refunding an upgrade can put that plan back. */
export class UpgradeRestore1791796000000 implements MigrationInterface {
  name = 'UpgradeRestore1791796000000';
  public async up(q: QueryRunner): Promise<void> { await q.query('ALTER TABLE `payments` ADD `upgrade_replaced_ends_at` datetime(3) NULL'); }
  public async down(q: QueryRunner): Promise<void> { await q.query('ALTER TABLE `payments` DROP COLUMN `upgrade_replaced_ends_at`'); }
}
