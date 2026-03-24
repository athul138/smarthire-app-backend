import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApplicationEntity } from '../../database/entities/application.entity';
import { CandidateProfileEntity } from '../../database/entities/candidate-profile.entity';
import { AiService } from './ai.service';
import { ResumeParserService } from './resume-parser.service';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { ApplicationsService } from '../applications/applications.service';
import { StorageService } from '../applications/storage.service';

@Injectable()
export class AiPipelineService {
  private readonly logger = new Logger(AiPipelineService.name);

  constructor(
    @InjectRepository(ApplicationEntity)
    private readonly appRepo: Repository<ApplicationEntity>,
    @InjectRepository(CandidateProfileEntity)
    private readonly profileRepo: Repository<CandidateProfileEntity>,
    private readonly aiService: AiService,
    private readonly parser: ResumeParserService,
    private readonly embeddings: EmbeddingsService,
    private readonly applicationsService: ApplicationsService,
    private readonly storage: StorageService,
  ) {}

  async processApplication(applicationId: string): Promise<void> {
    const app = await this.appRepo.findOne({ where: { id: applicationId } });
    if (!app) throw new Error(`Application not found: ${applicationId}`);

    this.logger.log(`Starting AI pipeline for application ${applicationId}`);

    // Step 1: Mark as processing
    await this.applicationsService.markProcessing(applicationId);

    // Step 2: Fetch resume from S3 and extract text (skipped on retry if already done)
    let rawText = app.rawResumeText;
    if (!rawText) {
      const resumeBuffer = await this.storage.getObject(app.resumeKey);
      rawText = await this.parser.extractText(resumeBuffer, app.resumeContentType);
      // Persist immediately so retries skip S3 + extraction
      await this.appRepo.update(app.id, { rawResumeText: rawText });
      this.logger.log(`Extracted ${rawText.length} chars from resume`);
    } else {
      this.logger.log(`Reusing cached resume text (${rawText.length} chars)`);
    }

    // Step 4: Parse via AI → structured JSON
    const parsedProfile = await this.aiService.parseResume(rawText);
    this.logger.log(`AI parsing complete for application ${applicationId}`);

    // Step 5: Build embedding text and generate vector
    const embeddingText = this.aiService.buildEmbeddingText(parsedProfile);
    const vector = await this.aiService.generateEmbedding(embeddingText, 'RETRIEVAL_DOCUMENT');
    this.logger.log(`Generated embedding vector (dim=${vector.length})`);

    // Step 6: Store in Qdrant (delete stale point first if reprocessing)
    const existingProfile = await this.profileRepo.findOne({
      where: { applicationId },
    });

    if (existingProfile?.qdrantPointId) {
      try {
        await this.embeddings.delete(existingProfile.qdrantPointId);
        this.logger.log(`Deleted stale Qdrant point ${existingProfile.qdrantPointId}`);
      } catch (err) {
        this.logger.warn(`Could not delete stale Qdrant point: ${err.message}`);
      }
    }

    const qdrantPointId = await this.embeddings.upsert(applicationId, vector, {
      applicationId,
      email: app.email,
      firstName: app.firstName,
      lastName: app.lastName,
      skills: parsedProfile.skills,
      currentTitle: parsedProfile.currentTitle,
      totalExperienceYears: parsedProfile.totalExperienceYears,
    });
    this.logger.log(`Indexed in Qdrant with point ID: ${qdrantPointId}`);

    const profileData = {
      applicationId,
      skills: parsedProfile.skills,
      experience: parsedProfile.experience,
      education: parsedProfile.education,
      certifications: parsedProfile.certifications ?? null,
      languages: parsedProfile.languages ?? null,
      totalExperienceYears: parsedProfile.totalExperienceYears ?? null,
      currentTitle: parsedProfile.currentTitle ?? null,
      currentCompany: parsedProfile.currentCompany ?? null,
      summary: parsedProfile.summary ?? null,
      qdrantPointId,
      isIndexed: true,
    };

    if (existingProfile) {
      await this.profileRepo.update(existingProfile.id, profileData);
      this.logger.log(`Updated existing candidate profile ${existingProfile.id}`);
    } else {
      await this.profileRepo.save(profileData);
    }

    // Step 8: Mark application as completed
    await this.applicationsService.markCompleted(applicationId);

    this.logger.log(`Pipeline complete for application ${applicationId}`);
  }
}
