import { MigrationInterface, QueryRunner } from "typeorm";

export class VideoAndPlayback1791784340325 implements MigrationInterface {
    name = 'VideoAndPlayback1791784340325'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // `episodes.current_asset_id` was reserved before video assets existed and nothing could set it (publishing required an asset).
        // Clear any stray values so the new foreign key can be added; MySQL DDL is not transactional, so a failure here must not leave half a schema.
        await queryRunner.query(`UPDATE \`episodes\` SET \`current_asset_id\` = NULL WHERE \`current_asset_id\` IS NOT NULL`);
        await queryRunner.query(`CREATE TABLE \`video_assets\` (\`created_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updated_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), \`id\` bigint UNSIGNED NOT NULL AUTO_INCREMENT, \`episode_id\` bigint UNSIGNED NOT NULL, \`status\` enum ('UPLOADING', 'UPLOADED', 'PROCESSING', 'READY', 'FAILED') NOT NULL DEFAULT 'UPLOADING', \`source_key\` varchar(500) NOT NULL, \`source_filename\` varchar(255) NOT NULL, \`content_type\` varchar(100) NOT NULL, \`declared_size_bytes\` bigint UNSIGNED NOT NULL, \`size_bytes\` bigint UNSIGNED NULL, \`checksum_sha256\` char(64) NULL, \`hls_prefix\` varchar(500) NULL, \`variants\` json NULL, \`duration_seconds\` int UNSIGNED NULL, \`width\` int UNSIGNED NULL, \`height\` int UNSIGNED NULL, \`thumbnail_key\` varchar(500) NULL, \`encryption_key_enc\` varchar(255) NULL, \`processing_attempts\` int UNSIGNED NOT NULL DEFAULT '0', \`generation\` int UNSIGNED NOT NULL DEFAULT '0', \`failure_reason\` varchar(500) NULL, \`processing_started_at\` datetime(3) NULL, \`processed_at\` datetime(3) NULL, \`created_by_admin_id\` bigint UNSIGNED NULL, INDEX \`idx_assets_status\` (\`status\`, \`updated_at\`), INDEX \`idx_assets_episode\` (\`episode_id\`, \`created_at\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`video_subtitles\` (\`created_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updated_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), \`id\` bigint UNSIGNED NOT NULL AUTO_INCREMENT, \`asset_id\` bigint UNSIGNED NOT NULL, \`language\` varchar(10) NOT NULL, \`label\` varchar(60) NOT NULL, \`storage_key\` varchar(500) NOT NULL, UNIQUE INDEX \`uq_subtitle_asset_lang\` (\`asset_id\`, \`language\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`playback_sessions\` (\`created_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updated_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), \`id\` bigint UNSIGNED NOT NULL AUTO_INCREMENT, \`user_id\` bigint UNSIGNED NOT NULL, \`episode_id\` bigint UNSIGNED NOT NULL, \`asset_id\` bigint UNSIGNED NOT NULL, \`token_hash\` char(64) NOT NULL, \`expires_at\` datetime(3) NOT NULL, \`hard_expires_at\` datetime(3) NOT NULL, \`last_heartbeat_at\` datetime(3) NOT NULL, \`position_seconds\` int UNSIGNED NOT NULL DEFAULT '0', \`ip_address\` varchar(45) NULL, \`user_agent\` varchar(255) NULL, \`ended_at\` datetime(3) NULL, \`revoked_at\` datetime(3) NULL, \`revoked_reason\` varchar(60) NULL, INDEX \`idx_playback_episode\` (\`episode_id\`), INDEX \`idx_playback_user_active\` (\`user_id\`, \`ended_at\`, \`revoked_at\`, \`expires_at\`), UNIQUE INDEX \`uq_playback_token_hash\` (\`token_hash\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`episodes\` ADD CONSTRAINT \`FK_958dd0d3004e849879bc77fec20\` FOREIGN KEY (\`current_asset_id\`) REFERENCES \`video_assets\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`video_assets\` ADD CONSTRAINT \`FK_4d05082775b450b4c5e47201703\` FOREIGN KEY (\`episode_id\`) REFERENCES \`episodes\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`video_subtitles\` ADD CONSTRAINT \`FK_59943146aa4e8d3150bbaed83d1\` FOREIGN KEY (\`asset_id\`) REFERENCES \`video_assets\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`playback_sessions\` ADD CONSTRAINT \`FK_0fe3fbaf6603fca327c9deaaea6\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`playback_sessions\` ADD CONSTRAINT \`FK_8dc30ac16db07f5863218debd1b\` FOREIGN KEY (\`episode_id\`) REFERENCES \`episodes\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`playback_sessions\` ADD CONSTRAINT \`FK_dcbeeb209ef465732525d34de76\` FOREIGN KEY (\`asset_id\`) REFERENCES \`video_assets\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`playback_sessions\` DROP FOREIGN KEY \`FK_dcbeeb209ef465732525d34de76\``);
        await queryRunner.query(`ALTER TABLE \`playback_sessions\` DROP FOREIGN KEY \`FK_8dc30ac16db07f5863218debd1b\``);
        await queryRunner.query(`ALTER TABLE \`playback_sessions\` DROP FOREIGN KEY \`FK_0fe3fbaf6603fca327c9deaaea6\``);
        await queryRunner.query(`ALTER TABLE \`video_subtitles\` DROP FOREIGN KEY \`FK_59943146aa4e8d3150bbaed83d1\``);
        await queryRunner.query(`ALTER TABLE \`video_assets\` DROP FOREIGN KEY \`FK_4d05082775b450b4c5e47201703\``);
        await queryRunner.query(`ALTER TABLE \`episodes\` DROP FOREIGN KEY \`FK_958dd0d3004e849879bc77fec20\``);
        await queryRunner.query(`DROP INDEX \`uq_playback_token_hash\` ON \`playback_sessions\``);
        await queryRunner.query(`DROP INDEX \`idx_playback_user_active\` ON \`playback_sessions\``);
        await queryRunner.query(`DROP INDEX \`idx_playback_episode\` ON \`playback_sessions\``);
        await queryRunner.query(`DROP TABLE \`playback_sessions\``);
        await queryRunner.query(`DROP INDEX \`uq_subtitle_asset_lang\` ON \`video_subtitles\``);
        await queryRunner.query(`DROP TABLE \`video_subtitles\``);
        await queryRunner.query(`DROP INDEX \`idx_assets_episode\` ON \`video_assets\``);
        await queryRunner.query(`DROP INDEX \`idx_assets_status\` ON \`video_assets\``);
        await queryRunner.query(`DROP TABLE \`video_assets\``);
    }

}
