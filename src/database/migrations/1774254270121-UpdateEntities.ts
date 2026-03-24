import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdateEntities1774254270121 implements MigrationInterface {
    name = 'UpdateEntities1774254270121'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "refresh_tokens" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "token" character varying(512) NOT NULL, "userId" uuid NOT NULL, "expiresAt" TIMESTAMP NOT NULL, "revoked" boolean NOT NULL DEFAULT false, "ipAddress" character varying(45), "userAgent" character varying(512), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_4542dd2f38a61354a040ba9fd57" UNIQUE ("token"), CONSTRAINT "PK_7d8bee0204106019488c4c50ffa" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_610102b60fea1455310ccd299d" ON "refresh_tokens" ("userId") `);
        await queryRunner.query(`CREATE INDEX "IDX_4542dd2f38a61354a040ba9fd5" ON "refresh_tokens" ("token") `);
        await queryRunner.query(`CREATE TYPE "public"."users_role_enum" AS ENUM('admin', 'hr', 'recruiter')`);
        await queryRunner.query(`CREATE TYPE "public"."users_status_enum" AS ENUM('active', 'inactive', 'suspended')`);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "firstName" character varying(100) NOT NULL, "lastName" character varying(100) NOT NULL, "email" character varying(255) NOT NULL, "passwordHash" character varying NOT NULL, "role" "public"."users_role_enum" NOT NULL DEFAULT 'hr', "status" "public"."users_status_enum" NOT NULL DEFAULT 'active', "lastLoginAt" TIMESTAMP, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_97672ac88f789774dd47f7c8be" ON "users" ("email") `);
        await queryRunner.query(`CREATE TABLE "candidate_profiles" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "applicationId" uuid NOT NULL, "skills" jsonb NOT NULL, "experience" jsonb NOT NULL, "education" jsonb NOT NULL, "certifications" jsonb, "languages" jsonb, "totalExperienceYears" integer, "currentTitle" character varying(255), "currentCompany" character varying(255), "summary" text, "qdrantPointId" uuid, "isIndexed" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "REL_48b3cb71362dcf3d6064388e19" UNIQUE ("applicationId"), CONSTRAINT "PK_8e8cf5b54118601673585218cc4" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_f3333d800f94d2190260f3cf15" ON "candidate_profiles" ("qdrantPointId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_48b3cb71362dcf3d6064388e19" ON "candidate_profiles" ("applicationId") `);
        await queryRunner.query(`CREATE TYPE "public"."applications_status_enum" AS ENUM('pending', 'processing', 'completed', 'failed')`);
        await queryRunner.query(`CREATE TABLE "applications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "firstName" character varying(100) NOT NULL, "lastName" character varying(100) NOT NULL, "email" character varying(255) NOT NULL, "phone" character varying(20), "linkedinUrl" character varying(512), "portfolioUrl" character varying(512), "positionAppliedFor" character varying(255), "resumeKey" character varying(512) NOT NULL, "resumeContentType" character varying(50) NOT NULL, "resumeSize" bigint NOT NULL, "status" "public"."applications_status_enum" NOT NULL DEFAULT 'pending', "processingAttempts" integer NOT NULL DEFAULT '0', "failureReason" text, "rawResumeText" text, "processedAt" TIMESTAMP, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_938c0a27255637bde919591888f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_6e708aed356015cc7338ca25b7" ON "applications" ("createdAt") `);
        await queryRunner.query(`CREATE INDEX "IDX_8ee114cee92e995a9e75c05cfb" ON "applications" ("status") `);
        await queryRunner.query(`CREATE INDEX "IDX_ac02d723199b0ebf2d838a9fc4" ON "applications" ("email") `);
        await queryRunner.query(`CREATE TYPE "public"."audit_logs_action_enum" AS ENUM('login', 'logout', 'login_failed', 'token_refresh', 'application_created', 'application_status_changed', 'search_performed', 'profile_viewed', 'user_created', 'user_updated', 'user_deactivated', 'resume_downloaded')`);
        await queryRunner.query(`CREATE TABLE "audit_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid, "action" "public"."audit_logs_action_enum" NOT NULL, "resourceId" uuid, "resourceType" character varying(50), "metadata" jsonb, "ipAddress" character varying(45), "userAgent" character varying(512), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_1bb179d048bbc581caa3b013439" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_b41c13e0a4212c95088d102981" ON "audit_logs" ("resourceId") `);
        await queryRunner.query(`CREATE INDEX "IDX_c69efb19bf127c97e6740ad530" ON "audit_logs" ("createdAt") `);
        await queryRunner.query(`CREATE INDEX "IDX_cee5459245f652b75eb2759b4c" ON "audit_logs" ("action") `);
        await queryRunner.query(`CREATE INDEX "IDX_cfa83f61e4d27a87fcae1e025a" ON "audit_logs" ("userId") `);
        await queryRunner.query(`ALTER TABLE "refresh_tokens" ADD CONSTRAINT "FK_610102b60fea1455310ccd299de" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "candidate_profiles" ADD CONSTRAINT "FK_48b3cb71362dcf3d6064388e198" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "candidate_profiles" DROP CONSTRAINT "FK_48b3cb71362dcf3d6064388e198"`);
        await queryRunner.query(`ALTER TABLE "refresh_tokens" DROP CONSTRAINT "FK_610102b60fea1455310ccd299de"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_cfa83f61e4d27a87fcae1e025a"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_cee5459245f652b75eb2759b4c"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c69efb19bf127c97e6740ad530"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b41c13e0a4212c95088d102981"`);
        await queryRunner.query(`DROP TABLE "audit_logs"`);
        await queryRunner.query(`DROP TYPE "public"."audit_logs_action_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ac02d723199b0ebf2d838a9fc4"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8ee114cee92e995a9e75c05cfb"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6e708aed356015cc7338ca25b7"`);
        await queryRunner.query(`DROP TABLE "applications"`);
        await queryRunner.query(`DROP TYPE "public"."applications_status_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_48b3cb71362dcf3d6064388e19"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f3333d800f94d2190260f3cf15"`);
        await queryRunner.query(`DROP TABLE "candidate_profiles"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_97672ac88f789774dd47f7c8be"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP TYPE "public"."users_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4542dd2f38a61354a040ba9fd5"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_610102b60fea1455310ccd299d"`);
        await queryRunner.query(`DROP TABLE "refresh_tokens"`);
    }

}
