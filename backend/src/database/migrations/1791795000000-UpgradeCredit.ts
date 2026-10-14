import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Upgrade pricing. `amount_paise` stays "what was charged"; `credit_paise` is the unused value of the plan being replaced
 * that was deducted from the new plan's list price, and `upgrade_from_subscription_id` says which period it replaces.
 */
export class UpgradeCredit1791795000000 implements MigrationInterface {
  name = 'UpgradeCredit1791795000000';
  public async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE `payments` ADD `credit_paise` bigint UNSIGNED NOT NULL DEFAULT 0, ADD `upgrade_from_subscription_id` bigint UNSIGNED NULL');
  }
  public async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE `payments` DROP COLUMN `upgrade_from_subscription_id`, DROP COLUMN `credit_paise`');
  }
}
