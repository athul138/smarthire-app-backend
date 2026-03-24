/**
 * One-time seed: creates the initial admin user.
 * Run: ts-node src/database/seeds/seed-admin.ts
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';
import { UserEntity, UserRole, UserStatus } from '../entities/user.entity';
import { RefreshTokenEntity } from '@database/entities/refresh-token.entity';

dotenv.config();

async function seed() {
  const ds = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    // entities: [UserEntity,RefreshTokenEntity],
    entities: [__dirname + '/../**/*.entity.{ts,js}'],
    synchronize: false,
  });

  await ds.initialize();

  const repo = ds.getRepository(UserEntity);
  const email = process.env.ADMIN_EMAIL || 'admin@smarthire.io';
  const password = process.env.ADMIN_PASSWORD || 'Admin@123456!';

  const existing = await repo.findOne({ where: { email } });
  if (existing) {
    console.log(`Admin user already exists: ${email}`);
    await ds.destroy();
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await repo.save({
    firstName: 'System',
    lastName: 'Admin',
    email,
    passwordHash,
    role: UserRole.ADMIN,
    status: UserStatus.ACTIVE,
  });

  console.log(`Admin user created: ${email}`);
  await ds.destroy();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
