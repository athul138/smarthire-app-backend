import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UserEntity } from './entities/user.entity';
import { ApplicationEntity } from './entities/application.entity';
import { CandidateProfileEntity } from './entities/candidate-profile.entity';
import { AuditLogEntity } from './entities/audit-log.entity';
import { RefreshTokenEntity } from './entities/refresh-token.entity';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('database.host'),
        port: config.get('database.port'),
        username: config.get('database.username'),
        password: config.get('database.password'),
        database: config.get('database.name'),
        ssl: config.get('database.ssl') ? { rejectUnauthorized: false } : false,
        synchronize: false, // Explicitly disable synchronization
        logging: config.get('database.logging'),
        entities: [
          UserEntity,
          ApplicationEntity,
          CandidateProfileEntity,
          AuditLogEntity,
          RefreshTokenEntity,
        ],
        migrations: [__dirname + '/migrations/*{.ts,.js}'],
        migrationsRun: false,
        autoLoadEntities: true,
        extra: {
          max: 20,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 2000,
        },
      }),
    }),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
