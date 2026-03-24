import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApplicationEntity } from '../../database/entities/application.entity';
import { CandidateProfileEntity } from '../../database/entities/candidate-profile.entity';
import { ApplicationsService } from './applications.service';
import { ApplicationsController } from './applications.controller';
import { StorageService } from './storage.service';
import { QueueModule } from '../queue/queue.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ApplicationEntity, CandidateProfileEntity]),
    QueueModule,
    AuditModule,
  ],
  controllers: [ApplicationsController],
  providers: [ApplicationsService, StorageService],
  exports: [ApplicationsService, StorageService],
})
export class ApplicationsModule {}
