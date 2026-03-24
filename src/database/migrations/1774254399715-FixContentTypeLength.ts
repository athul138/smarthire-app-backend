import { MigrationInterface, QueryRunner } from "typeorm";

export class FixContentTypeLength1774254399715 implements MigrationInterface {
    name = 'FixContentTypeLength1774254399715'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "applications" DROP COLUMN "resumeContentType"`);
        await queryRunner.query(`ALTER TABLE "applications" ADD "resumeContentType" character varying(100) NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "applications" DROP COLUMN "resumeContentType"`);
        await queryRunner.query(`ALTER TABLE "applications" ADD "resumeContentType" character varying(50) NOT NULL`);
    }

}
