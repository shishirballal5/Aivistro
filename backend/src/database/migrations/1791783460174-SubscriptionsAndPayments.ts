import { MigrationInterface, QueryRunner } from "typeorm";

export class SubscriptionsAndPayments1791783460174 implements MigrationInterface {
    name = 'SubscriptionsAndPayments1791783460174'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`subscription_plans\` (\`created_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updated_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), \`id\` bigint UNSIGNED NOT NULL AUTO_INCREMENT, \`code\` varchar(30) NOT NULL, \`name\` varchar(80) NOT NULL, \`description\` varchar(255) NOT NULL DEFAULT '', \`duration_months\` smallint UNSIGNED NOT NULL, \`price_paise\` bigint UNSIGNED NOT NULL, \`currency\` char(3) NOT NULL DEFAULT 'INR', \`active\` tinyint NOT NULL DEFAULT 1, \`sort_order\` int NOT NULL DEFAULT '0', UNIQUE INDEX \`uq_plans_code\` (\`code\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`payments\` (\`created_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updated_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), \`id\` bigint UNSIGNED NOT NULL AUTO_INCREMENT, \`user_id\` bigint UNSIGNED NOT NULL, \`plan_id\` bigint UNSIGNED NOT NULL, \`plan_code\` varchar(30) NOT NULL, \`duration_months\` smallint UNSIGNED NOT NULL, \`provider\` varchar(20) NOT NULL, \`provider_order_id\` varchar(64) NOT NULL, \`provider_payment_id\` varchar(64) NULL, \`receipt\` varchar(40) NOT NULL, \`amount_paise\` bigint UNSIGNED NOT NULL, \`currency\` char(3) NOT NULL, \`status\` enum ('CREATED', 'CAPTURED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED') NOT NULL DEFAULT 'CREATED', \`method\` varchar(30) NULL, \`failure_code\` varchar(60) NULL, \`failure_reason\` varchar(255) NULL, \`captured_at\` datetime(3) NULL, \`refunded_paise\` bigint UNSIGNED NOT NULL DEFAULT '0', INDEX \`idx_payments_status_created\` (\`status\`, \`created_at\`), INDEX \`idx_payments_user_created\` (\`user_id\`, \`created_at\`), UNIQUE INDEX \`uq_payments_receipt\` (\`receipt\`), UNIQUE INDEX \`uq_payments_provider_payment\` (\`provider_payment_id\`), UNIQUE INDEX \`uq_payments_order\` (\`provider_order_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`subscriptions\` (\`created_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updated_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), \`id\` bigint UNSIGNED NOT NULL AUTO_INCREMENT, \`user_id\` bigint UNSIGNED NOT NULL, \`plan_id\` bigint UNSIGNED NOT NULL, \`payment_id\` bigint UNSIGNED NULL, \`source\` enum ('PURCHASE', 'ADMIN_GRANT') NOT NULL DEFAULT 'PURCHASE', \`status\` enum ('ACTIVE', 'EXPIRED', 'CANCELLED', 'REFUNDED') NOT NULL DEFAULT 'ACTIVE', \`starts_at\` datetime(3) NOT NULL, \`ends_at\` datetime(3) NOT NULL, \`cancelled_at\` datetime(3) NULL, \`cancel_at_period_end\` tinyint NOT NULL DEFAULT 0, \`granted_by_admin_id\` bigint UNSIGNED NULL, \`grant_reason\` varchar(255) NULL, INDEX \`idx_subscriptions_status_ends\` (\`status\`, \`ends_at\`), INDEX \`idx_subscriptions_user\` (\`user_id\`, \`ends_at\`), UNIQUE INDEX \`uq_subscriptions_payment\` (\`payment_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`entitlements\` (\`created_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updated_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), \`id\` bigint UNSIGNED NOT NULL AUTO_INCREMENT, \`user_id\` bigint UNSIGNED NOT NULL, \`subscription_id\` bigint UNSIGNED NOT NULL, \`starts_at\` datetime(3) NOT NULL, \`ends_at\` datetime(3) NOT NULL, \`revoked_at\` datetime(3) NULL, \`revoked_reason\` varchar(60) NULL, INDEX \`idx_entitlements_user_window\` (\`user_id\`, \`starts_at\`, \`ends_at\`), UNIQUE INDEX \`uq_entitlements_subscription\` (\`subscription_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`payment_webhook_events\` (\`created_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updated_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), \`id\` bigint UNSIGNED NOT NULL AUTO_INCREMENT, \`provider\` varchar(20) NOT NULL, \`provider_event_id\` varchar(100) NOT NULL, \`event_type\` varchar(60) NOT NULL, \`payload_hash\` char(64) NOT NULL, \`payload\` json NOT NULL, \`status\` enum ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED') NOT NULL DEFAULT 'RECEIVED', \`attempts\` int UNSIGNED NOT NULL DEFAULT '0', \`note\` varchar(500) NULL, \`processed_at\` datetime(3) NULL, INDEX \`idx_webhook_status\` (\`status\`, \`created_at\`), UNIQUE INDEX \`uq_webhook_provider_event\` (\`provider\`, \`provider_event_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`refunds\` (\`created_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updated_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), \`id\` bigint UNSIGNED NOT NULL AUTO_INCREMENT, \`payment_id\` bigint UNSIGNED NOT NULL, \`provider_refund_id\` varchar(64) NULL, \`amount_paise\` bigint UNSIGNED NOT NULL, \`reason\` varchar(255) NOT NULL, \`status\` enum ('PENDING', 'PROCESSED', 'FAILED') NOT NULL DEFAULT 'PENDING', \`requested_by_admin_id\` bigint UNSIGNED NULL, \`failure_reason\` varchar(255) NULL, \`processed_at\` datetime(3) NULL, INDEX \`idx_refunds_payment\` (\`payment_id\`), UNIQUE INDEX \`uq_refunds_provider\` (\`provider_refund_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`payments\` ADD CONSTRAINT \`FK_427785468fb7d2733f59e7d7d39\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`payments\` ADD CONSTRAINT \`FK_f9b6a4c3196864cdd91b1a440ee\` FOREIGN KEY (\`plan_id\`) REFERENCES \`subscription_plans\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`subscriptions\` ADD CONSTRAINT \`FK_d0a95ef8a28188364c546eb65c1\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`subscriptions\` ADD CONSTRAINT \`FK_e45fca5d912c3a2fab512ac25dc\` FOREIGN KEY (\`plan_id\`) REFERENCES \`subscription_plans\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`subscriptions\` ADD CONSTRAINT \`FK_21babc4a80c4b6155e23c1155a5\` FOREIGN KEY (\`payment_id\`) REFERENCES \`payments\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`entitlements\` ADD CONSTRAINT \`FK_30d2208c43f245217c03cb7ce31\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`entitlements\` ADD CONSTRAINT \`FK_466a14443d295327ac3f88cd897\` FOREIGN KEY (\`subscription_id\`) REFERENCES \`subscriptions\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`refunds\` ADD CONSTRAINT \`FK_7f48aa5d56c42aeb495db016683\` FOREIGN KEY (\`payment_id\`) REFERENCES \`payments\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`refunds\` DROP FOREIGN KEY \`FK_7f48aa5d56c42aeb495db016683\``);
        await queryRunner.query(`ALTER TABLE \`entitlements\` DROP FOREIGN KEY \`FK_466a14443d295327ac3f88cd897\``);
        await queryRunner.query(`ALTER TABLE \`entitlements\` DROP FOREIGN KEY \`FK_30d2208c43f245217c03cb7ce31\``);
        await queryRunner.query(`ALTER TABLE \`subscriptions\` DROP FOREIGN KEY \`FK_21babc4a80c4b6155e23c1155a5\``);
        await queryRunner.query(`ALTER TABLE \`subscriptions\` DROP FOREIGN KEY \`FK_e45fca5d912c3a2fab512ac25dc\``);
        await queryRunner.query(`ALTER TABLE \`subscriptions\` DROP FOREIGN KEY \`FK_d0a95ef8a28188364c546eb65c1\``);
        await queryRunner.query(`ALTER TABLE \`payments\` DROP FOREIGN KEY \`FK_f9b6a4c3196864cdd91b1a440ee\``);
        await queryRunner.query(`ALTER TABLE \`payments\` DROP FOREIGN KEY \`FK_427785468fb7d2733f59e7d7d39\``);
        await queryRunner.query(`DROP INDEX \`uq_refunds_provider\` ON \`refunds\``);
        await queryRunner.query(`DROP INDEX \`idx_refunds_payment\` ON \`refunds\``);
        await queryRunner.query(`DROP TABLE \`refunds\``);
        await queryRunner.query(`DROP INDEX \`uq_webhook_provider_event\` ON \`payment_webhook_events\``);
        await queryRunner.query(`DROP INDEX \`idx_webhook_status\` ON \`payment_webhook_events\``);
        await queryRunner.query(`DROP TABLE \`payment_webhook_events\``);
        await queryRunner.query(`DROP INDEX \`uq_entitlements_subscription\` ON \`entitlements\``);
        await queryRunner.query(`DROP INDEX \`idx_entitlements_user_window\` ON \`entitlements\``);
        await queryRunner.query(`DROP TABLE \`entitlements\``);
        await queryRunner.query(`DROP INDEX \`uq_subscriptions_payment\` ON \`subscriptions\``);
        await queryRunner.query(`DROP INDEX \`idx_subscriptions_user\` ON \`subscriptions\``);
        await queryRunner.query(`DROP INDEX \`idx_subscriptions_status_ends\` ON \`subscriptions\``);
        await queryRunner.query(`DROP TABLE \`subscriptions\``);
        await queryRunner.query(`DROP INDEX \`uq_payments_order\` ON \`payments\``);
        await queryRunner.query(`DROP INDEX \`uq_payments_provider_payment\` ON \`payments\``);
        await queryRunner.query(`DROP INDEX \`uq_payments_receipt\` ON \`payments\``);
        await queryRunner.query(`DROP INDEX \`idx_payments_user_created\` ON \`payments\``);
        await queryRunner.query(`DROP INDEX \`idx_payments_status_created\` ON \`payments\``);
        await queryRunner.query(`DROP TABLE \`payments\``);
        await queryRunner.query(`DROP INDEX \`uq_plans_code\` ON \`subscription_plans\``);
        await queryRunner.query(`DROP TABLE \`subscription_plans\``);
    }

}
