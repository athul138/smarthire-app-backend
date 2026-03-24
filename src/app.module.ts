import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { appConfig } from './config/app.config';
import { databaseConfig } from './config/database.config';
import { jwtConfig } from './config/jwt.config';
import { awsConfig } from './config/aws.config';
import { openaiConfig } from './config/openai.config';
import { geminiConfig } from './config/gemini.config';
import { qdrantConfig } from './config/qdrant.config';
import { rabbitmqConfig } from './config/rabbitmq.config';
import { configValidationSchema } from './config/config.validation';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { QueueModule } from './modules/queue/queue.module';
import { AiModule } from './modules/ai/ai.module';
import { EmbeddingsModule } from './modules/embeddings/embeddings.module';
import { SearchModule } from './modules/search/search.module';
import { AuditModule } from './modules/audit/audit.module';
import { AdminModule } from './modules/admin/admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        appConfig,
        databaseConfig,
        jwtConfig,
        awsConfig,
        openaiConfig,
        geminiConfig,
        qdrantConfig,
        rabbitmqConfig,
      ],
      validationSchema: configValidationSchema,
      validationOptions: { abortEarly: false },
    }),
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1000, limit: 20 },
      { name: 'medium', ttl: 10000, limit: 100 },
      { name: 'long', ttl: 60000, limit: 500 },
    ]),
    DatabaseModule,
    AuthModule,
    UsersModule,
    ApplicationsModule,
    QueueModule,
    AiModule,
    EmbeddingsModule,
    SearchModule,
    AuditModule,
    AdminModule,
  ],
})
export class AppModule {}
