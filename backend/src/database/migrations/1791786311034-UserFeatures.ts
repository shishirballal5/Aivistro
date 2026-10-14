import { MigrationInterface, QueryRunner } from "typeorm";

export class UserFeatures1791786311034 implements MigrationInterface {
    name = 'UserFeatures1791786311034'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`watch_progress\` (\`created_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updated_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), \`id\` bigint UNSIGNED NOT NULL AUTO_INCREMENT, \`user_id\` bigint UNSIGNED NOT NULL, \`episode_id\` bigint UNSIGNED NOT NULL, \`series_id\` bigint UNSIGNED NOT NULL, \`position_seconds\` int UNSIGNED NOT NULL DEFAULT '0', \`duration_seconds\` int UNSIGNED NOT NULL DEFAULT '0', \`completed\` tinyint NOT NULL DEFAULT 0, \`last_watched_at\` datetime(3) NOT NULL, INDEX \`idx_progress_user_recent\` (\`user_id\`, \`last_watched_at\`), UNIQUE INDEX \`uq_progress_user_episode\` (\`user_id\`, \`episode_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`watch_history\` (\`created_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updated_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), \`id\` bigint UNSIGNED NOT NULL AUTO_INCREMENT, \`user_id\` bigint UNSIGNED NOT NULL, \`series_id\` bigint UNSIGNED NOT NULL, \`last_episode_id\` bigint UNSIGNED NOT NULL, \`last_episode_number\` int UNSIGNED NOT NULL, \`last_position_seconds\` int UNSIGNED NOT NULL DEFAULT '0', \`last_completed\` tinyint NOT NULL DEFAULT 0, \`episodes_completed\` int UNSIGNED NOT NULL DEFAULT '0', \`last_watched_at\` datetime(3) NOT NULL, INDEX \`idx_history_user_recent\` (\`user_id\`, \`last_watched_at\`), UNIQUE INDEX \`uq_history_user_series\` (\`user_id\`, \`series_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`watchlists\` (\`created_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updated_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), \`id\` bigint UNSIGNED NOT NULL AUTO_INCREMENT, \`user_id\` bigint UNSIGNED NOT NULL, UNIQUE INDEX \`uq_watchlist_user\` (\`user_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`watchlist_items\` (\`id\` bigint UNSIGNED NOT NULL AUTO_INCREMENT, \`watchlist_id\` bigint UNSIGNED NOT NULL, \`series_id\` bigint UNSIGNED NOT NULL, \`added_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), INDEX \`idx_watchlist_recent\` (\`watchlist_id\`, \`id\`), UNIQUE INDEX \`uq_watchlist_item\` (\`watchlist_id\`, \`series_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`notifications\` (\`created_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updated_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), \`id\` bigint UNSIGNED NOT NULL AUTO_INCREMENT, \`title\` varchar(120) NOT NULL, \`body\` varchar(500) NOT NULL, \`audience\` enum ('ALL', 'SUBSCRIBERS', 'NON_SUBSCRIBERS') NOT NULL DEFAULT 'ALL', \`category\` enum ('MARKETING', 'NEW_EPISODES', 'BILLING') NOT NULL DEFAULT 'MARKETING', \`status\` enum ('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'CANCELLED') NOT NULL DEFAULT 'DRAFT', \`data\` json NULL, \`scheduled_at\` datetime(3) NULL, \`sent_at\` datetime(3) NULL, \`recipient_count\` int UNSIGNED NOT NULL DEFAULT '0', \`progress_cursor\` bigint UNSIGNED NOT NULL DEFAULT '0', \`created_by_admin_id\` bigint UNSIGNED NULL, INDEX \`idx_campaign_status_sched\` (\`status\`, \`scheduled_at\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`user_notifications\` (\`id\` bigint UNSIGNED NOT NULL AUTO_INCREMENT, \`user_id\` bigint UNSIGNED NOT NULL, \`notification_id\` bigint UNSIGNED NULL, \`title\` varchar(120) NOT NULL, \`body\` varchar(500) NOT NULL, \`category\` enum ('MARKETING', 'NEW_EPISODES', 'BILLING') NOT NULL DEFAULT 'MARKETING', \`data\` json NULL, \`read_at\` datetime(3) NULL, \`created_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), INDEX \`idx_usernotif_unread\` (\`user_id\`, \`read_at\`), INDEX \`idx_usernotif_user_created\` (\`user_id\`, \`id\`), UNIQUE INDEX \`uq_user_notification_campaign\` (\`notification_id\`, \`user_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`device_tokens\` (\`created_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updated_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), \`id\` bigint UNSIGNED NOT NULL AUTO_INCREMENT, \`user_id\` bigint UNSIGNED NOT NULL, \`token\` varchar(255) NOT NULL, \`platform\` enum ('android', 'ios', 'web') NOT NULL, \`last_seen_at\` datetime(3) NOT NULL, \`revoked_at\` datetime(3) NULL, INDEX \`idx_device_user\` (\`user_id\`), UNIQUE INDEX \`uq_device_token\` (\`token\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`analytics_events\` (\`id\` bigint UNSIGNED NOT NULL AUTO_INCREMENT, \`user_id\` bigint UNSIGNED NULL, \`event_type\` varchar(60) NOT NULL, \`entity_type\` varchar(40) NULL, \`entity_id\` varchar(64) NULL, \`properties\` json NULL, \`occurred_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), INDEX \`idx_events_time\` (\`occurred_at\`), INDEX \`idx_events_user_time\` (\`user_id\`, \`occurred_at\`), INDEX \`idx_events_type_time\` (\`event_type\`, \`occurred_at\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`watch_progress\` ADD CONSTRAINT \`FK_4a10da827bd3f6cdc00a7cba930\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`watch_progress\` ADD CONSTRAINT \`FK_677f8579d5e79b6c77dce357160\` FOREIGN KEY (\`episode_id\`) REFERENCES \`episodes\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`watch_history\` ADD CONSTRAINT \`FK_5e1169219c2bda5624a4b65742d\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`watch_history\` ADD CONSTRAINT \`FK_54c99588fc8dd815b3524ce352b\` FOREIGN KEY (\`series_id\`) REFERENCES \`series\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`watchlists\` ADD CONSTRAINT \`FK_3e8bccad3dcd75fa977892c54bb\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`watchlist_items\` ADD CONSTRAINT \`FK_39dffbdc9256662f284befadc16\` FOREIGN KEY (\`watchlist_id\`) REFERENCES \`watchlists\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`watchlist_items\` ADD CONSTRAINT \`FK_b6617e97abfd8e41db550a192dc\` FOREIGN KEY (\`series_id\`) REFERENCES \`series\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`user_notifications\` ADD CONSTRAINT \`FK_ae9b1d1f1fe780ef8e3e7d0c0f6\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`user_notifications\` ADD CONSTRAINT \`FK_944431ae979397c8b56a99bf024\` FOREIGN KEY (\`notification_id\`) REFERENCES \`notifications\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`device_tokens\` ADD CONSTRAINT \`FK_17e1f528b993c6d55def4cf5bea\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`device_tokens\` DROP FOREIGN KEY \`FK_17e1f528b993c6d55def4cf5bea\``);
        await queryRunner.query(`ALTER TABLE \`user_notifications\` DROP FOREIGN KEY \`FK_944431ae979397c8b56a99bf024\``);
        await queryRunner.query(`ALTER TABLE \`user_notifications\` DROP FOREIGN KEY \`FK_ae9b1d1f1fe780ef8e3e7d0c0f6\``);
        await queryRunner.query(`ALTER TABLE \`watchlist_items\` DROP FOREIGN KEY \`FK_b6617e97abfd8e41db550a192dc\``);
        await queryRunner.query(`ALTER TABLE \`watchlist_items\` DROP FOREIGN KEY \`FK_39dffbdc9256662f284befadc16\``);
        await queryRunner.query(`ALTER TABLE \`watchlists\` DROP FOREIGN KEY \`FK_3e8bccad3dcd75fa977892c54bb\``);
        await queryRunner.query(`ALTER TABLE \`watch_history\` DROP FOREIGN KEY \`FK_54c99588fc8dd815b3524ce352b\``);
        await queryRunner.query(`ALTER TABLE \`watch_history\` DROP FOREIGN KEY \`FK_5e1169219c2bda5624a4b65742d\``);
        await queryRunner.query(`ALTER TABLE \`watch_progress\` DROP FOREIGN KEY \`FK_677f8579d5e79b6c77dce357160\``);
        await queryRunner.query(`ALTER TABLE \`watch_progress\` DROP FOREIGN KEY \`FK_4a10da827bd3f6cdc00a7cba930\``);
        await queryRunner.query(`DROP INDEX \`idx_events_type_time\` ON \`analytics_events\``);
        await queryRunner.query(`DROP INDEX \`idx_events_user_time\` ON \`analytics_events\``);
        await queryRunner.query(`DROP INDEX \`idx_events_time\` ON \`analytics_events\``);
        await queryRunner.query(`DROP TABLE \`analytics_events\``);
        await queryRunner.query(`DROP INDEX \`uq_device_token\` ON \`device_tokens\``);
        await queryRunner.query(`DROP INDEX \`idx_device_user\` ON \`device_tokens\``);
        await queryRunner.query(`DROP TABLE \`device_tokens\``);
        await queryRunner.query(`DROP INDEX \`uq_user_notification_campaign\` ON \`user_notifications\``);
        await queryRunner.query(`DROP INDEX \`idx_usernotif_user_created\` ON \`user_notifications\``);
        await queryRunner.query(`DROP INDEX \`idx_usernotif_unread\` ON \`user_notifications\``);
        await queryRunner.query(`DROP TABLE \`user_notifications\``);
        await queryRunner.query(`DROP INDEX \`idx_campaign_status_sched\` ON \`notifications\``);
        await queryRunner.query(`DROP TABLE \`notifications\``);
        await queryRunner.query(`DROP INDEX \`uq_watchlist_item\` ON \`watchlist_items\``);
        await queryRunner.query(`DROP INDEX \`idx_watchlist_recent\` ON \`watchlist_items\``);
        await queryRunner.query(`DROP TABLE \`watchlist_items\``);
        await queryRunner.query(`DROP INDEX \`uq_watchlist_user\` ON \`watchlists\``);
        await queryRunner.query(`DROP TABLE \`watchlists\``);
        await queryRunner.query(`DROP INDEX \`uq_history_user_series\` ON \`watch_history\``);
        await queryRunner.query(`DROP INDEX \`idx_history_user_recent\` ON \`watch_history\``);
        await queryRunner.query(`DROP TABLE \`watch_history\``);
        await queryRunner.query(`DROP INDEX \`uq_progress_user_episode\` ON \`watch_progress\``);
        await queryRunner.query(`DROP INDEX \`idx_progress_user_recent\` ON \`watch_progress\``);
        await queryRunner.query(`DROP TABLE \`watch_progress\``);
    }

}
