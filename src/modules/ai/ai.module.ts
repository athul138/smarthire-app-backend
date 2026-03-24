import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApplicationEntity } from '../../database/entities/application.entity';
import { CandidateProfileEntity } from '../../database/entities/candidate-profile.entity';
import { AiService } from './ai.service';
import { AiPipelineService } from './ai-pipeline.service';
import { ResumeParserService } from './resume-parser.service';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { ApplicationsModule } from '../applications/applications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ApplicationEntity, CandidateProfileEntity]),
    EmbeddingsModule,
    ApplicationsModule,
  ],
  providers: [AiService, AiPipelineService, ResumeParserService],
  exports: [AiService, AiPipelineService, ResumeParserService],
})
export class AiModule {}
