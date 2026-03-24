import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ApplicationEntity } from '../../database/entities/application.entity';
import { CandidateProfileEntity } from '../../database/entities/candidate-profile.entity';
import { AiService } from '../ai/ai.service';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../../database/entities/audit-log.entity';
import { SearchQueryDto } from './dto/search-query.dto';
import { SearchResultDto } from './dto/search-result.dto';

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    @InjectRepository(ApplicationEntity)
    private readonly appRepo: Repository<ApplicationEntity>,
    @InjectRepository(CandidateProfileEntity)
    private readonly profileRepo: Repository<CandidateProfileEntity>,
    private readonly aiService: AiService,
    private readonly embeddings: EmbeddingsService,
    private readonly audit: AuditService,
  ) {}

  async search(dto: SearchQueryDto, userId?: string): Promise<SearchResultDto[]> {
    this.logger.log(`Search query: "${dto.query}" by user ${userId}`);

    // Step 1: Convert query to embedding
    const queryVector = await this.aiService.generateEmbedding(dto.query, 'RETRIEVAL_QUERY');

    // Step 2: Query Qdrant for similar candidates
    const vectorResults = await this.embeddings.search(queryVector, dto.limit ?? 20, {
      minExperienceYears: dto.minExperienceYears,
      skills: dto.requiredSkills,
    });

    if (!vectorResults.length) return [];

    // Step 3: Fetch full data from PostgreSQL
    const applicationIds = vectorResults.map((r) => r.applicationId);

    const [applications, profiles] = await Promise.all([
      this.appRepo.find({
        where: { id: In(applicationIds) },
      }),
      this.profileRepo.find({
        where: { applicationId: In(applicationIds) },
      }),
    ]);

    // Step 4: Build ranked results
    const appMap = new Map(applications.map((a) => [a.id, a]));
    const profileMap = new Map(profiles.map((p) => [p.applicationId, p]));

    const results: SearchResultDto[] = vectorResults
      .map((vr) => {
        const app = appMap.get(vr.applicationId);
        const profile = profileMap.get(vr.applicationId);
        if (!app || !profile) return null;

        return {
          applicationId: app.id,
          score: Math.round(vr.score * 100) / 100,
          candidate: {
            firstName: app.firstName,
            lastName: app.lastName,
            email: app.email,
            currentTitle: profile.currentTitle,
            currentCompany: profile.currentCompany,
            totalExperienceYears: profile.totalExperienceYears,
            skills: profile.skills,
            summary: profile.summary,
            appliedAt: app.createdAt,
          },
        };
      })
      .filter((r): r is SearchResultDto => r !== null);

    // Step 5: Audit log the search
    await this.audit.log({
      userId,
      action: AuditAction.SEARCH_PERFORMED,
      metadata: {
        query: dto.query,
        resultsCount: results.length,
        filters: {
          minExperienceYears: dto.minExperienceYears,
          requiredSkills: dto.requiredSkills,
        },
      },
    });

    return results;
  }
}
