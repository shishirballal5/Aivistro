import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reference data: the three launch plans (editable later by admins with `plans.manage`) and the
 * `subscriptions.manage` permission. Prices are in PAISE: 14900 = ₹149, 39900 = ₹399, 119900 = ₹1,199.
 */
export class SeedPlansAndPermission1791783460175 implements MigrationInterface {
  name = 'SeedPlansAndPermission1791783460175';

  public async up(q: QueryRunner): Promise<void> {
    const plans: [string, string, string, number, number, number][] = [
      ['monthly', 'Monthly', 'Every episode, billed for one month', 1, 14900, 1],
      ['quarterly', 'Quarterly', 'Every episode, billed for three months', 3, 39900, 2],
      ['annual', 'Annual', 'Every episode, billed for twelve months', 12, 119900, 3],
    ];
    for (const [code, name, description, months, pricePaise, sortOrder] of plans) {
      await q.query('INSERT INTO `subscription_plans` (`code`, `name`, `description`, `duration_months`, `price_paise`, `currency`, `active`, `sort_order`) VALUES (?, ?, ?, ?, ?, \'INR\', 1, ?)', [code, name, description, months, pricePaise, sortOrder]);
    }
    await q.query("INSERT INTO `permissions` (`code`, `description`) VALUES ('subscriptions.manage', 'Grant, revoke and adjust subscriptions')");
    for (const role of ['SUPER_ADMIN', 'FINANCE']) {
      await q.query("INSERT INTO `role_permissions` (`role_id`, `permission_id`) SELECT r.`id`, p.`id` FROM `roles` r, `permissions` p WHERE r.`name` = ? AND p.`code` = 'subscriptions.manage'", [role]);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query("DELETE FROM `role_permissions` WHERE `permission_id` IN (SELECT `id` FROM `permissions` WHERE `code` = 'subscriptions.manage')");
    await q.query("DELETE FROM `permissions` WHERE `code` = 'subscriptions.manage'");
    await q.query("DELETE FROM `subscription_plans` WHERE `code` IN ('monthly', 'quarterly', 'annual')");
  }
}
