import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialFoundation1791680424234 implements MigrationInterface {
    name = 'InitialFoundation1791680424234'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`system_settings\` (\`created_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updated_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), \`setting_key\` varchar(100) NOT NULL, \`value\` json NOT NULL, \`description\` varchar(255) NULL, PRIMARY KEY (\`setting_key\`)) ENGINE=InnoDB`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE \`system_settings\``);
    }

}
