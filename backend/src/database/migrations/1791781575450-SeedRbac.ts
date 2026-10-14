import { MigrationInterface, QueryRunner } from 'typeorm';
import { PERMISSIONS, SYSTEM_ROLES } from '../rbac-seed';

/**
 * Seeds permissions and the four system roles. This is reference data only: it creates NO accounts
 * and NO credentials. The first admin is created with `npm run admin:create` (see README).
 */
export class SeedRbac1791781575450 implements MigrationInterface {
  name = 'SeedRbac1791781575450';

  public async up(q: QueryRunner): Promise<void> {
    for (const [code, description] of Object.entries(PERMISSIONS)) {
      await q.query('INSERT INTO `permissions` (`code`, `description`) VALUES (?, ?)', [code, description]);
    }
    for (const [name, role] of Object.entries(SYSTEM_ROLES)) {
      await q.query('INSERT INTO `roles` (`name`, `description`, `is_system`) VALUES (?, ?, 1)', [name, role.description]);
      const codes = role.permissions === 'ALL' ? Object.keys(PERMISSIONS) : role.permissions;
      for (const code of codes) {
        await q.query(
          'INSERT INTO `role_permissions` (`role_id`, `permission_id`) SELECT r.`id`, p.`id` FROM `roles` r, `permissions` p WHERE r.`name` = ? AND p.`code` = ?',
          [name, code],
        );
      }
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query('DELETE FROM `role_permissions`');
    await q.query('DELETE FROM `roles` WHERE `is_system` = 1');
    await q.query('DELETE FROM `permissions` WHERE `code` IN (' + Object.keys(PERMISSIONS).map(() => '?').join(',') + ')', Object.keys(PERMISSIONS));
  }
}
