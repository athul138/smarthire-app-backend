import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import { UserEntity } from './database/entities/user.entity';
import { ApplicationEntity } from './database/entities/application.entity';
import { CandidateProfileEntity } from './database/entities/candidate-profile.entity';
import { AuditLogEntity } from './database/entities/audit-log.entity';
import { RefreshTokenEntity } from './database/entities/refresh-token.entity';

dotenv.config();

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'smarthire',
  password: process.env.DB_PASSWORD || 'smarthire_secret',
  database: process.env.DB_NAME || 'smarthire',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  synchronize: false,
  logging: process.env.DB_LOGGING === 'true',
  entities: [
    UserEntity,
    ApplicationEntity,
    CandidateProfileEntity,
    AuditLogEntity,
    RefreshTokenEntity,
  ],
  migrations: ['src/database/migrations/*{.ts,.js}'],
  migrationsRun: false,
});