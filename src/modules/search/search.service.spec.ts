import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SearchService } from './search.service';
import { ApplicationEntity, ApplicationStatus } from '../../database/entities/application.entity';
import { CandidateProfileEntity } from '../../database/entities/candidate-profile.entity';
import { AiService } from '../ai/ai.service';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../../database/entities/audit-log.entity';

const mockAppRepo = () => ({
  find: jest.fn(),
});

const mockProfileRepo = () => ({
  find: jest.fn(),
});

const mockAiService = () => ({
  generateEmbedding: jest.fn(),
});

const mockEmbeddingsService = () => ({
  search: jest.fn(),
});

const mockAuditService = () => ({
  log: jest.fn().mockResolvedValue(undefined),
});

const QUERY_VECTOR = Array.from({ length: 768 }, (_, i) => i * 0.001);

function buildVectorResult(applicationId: string, score = 0.95) {
  return {
    applicationId,
    score,
    payload: {
      applicationId,
      email: 'alice@example.com',
      firstName: 'Alice',
      lastName: 'Wonder',
      skills: ['TypeScript', 'NestJS'],
      currentTitle: 'Backend Developer',
      totalExperienceYears: 5,
    },
  };
}

function buildApplication(id = 'app-uuid-1'): ApplicationEntity {
  return {
    id,
    firstName: 'Alice',
    lastName: 'Wonder',
    email: 'alice@example.com',
    status: ApplicationStatus.COMPLETED,
    createdAt: new Date('2024-01-15'),
    updatedAt: new Date(),
  } as ApplicationEntity;
}

function buildProfile(applicationId = 'app-uuid-1'): CandidateProfileEntity {
  return {
    id: 'profile-uuid-1',
    applicationId,
    skills: ['TypeScript', 'NestJS'],
    currentTitle: 'Backend Developer',
    currentCompany: 'Acme Corp',
    totalExperienceYears: 5,
    summary: 'Experienced backend developer.',
    isIndexed: true,
  } as CandidateProfileEntity;
}

describe('SearchService', () => {
  let service: SearchService;
  let appRepo: ReturnType<typeof mockAppRepo>;
  let profileRepo: ReturnType<typeof mockProfileRepo>;
  let aiService: ReturnType<typeof mockAiService>;
  let embeddingsService: ReturnType<typeof mockEmbeddingsService>;
  let auditService: ReturnType<typeof mockAuditService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        { provide: getRepositoryToken(ApplicationEntity), useFactory: mockAppRepo },
        { provide: getRepositoryToken(CandidateProfileEntity), useFactory: mockProfileRepo },
        { provide: AiService, useFactory: mockAiService },
        { provide: EmbeddingsService, useFactory: mockEmbeddingsService },
        { provide: AuditService, useFactory: mockAuditService },
      ],
    }).compile();

    service = module.get(SearchService);
    appRepo = module.get(getRepositoryToken(ApplicationEntity));
    profileRepo = module.get(getRepositoryToken(CandidateProfileEntity));
    aiService = module.get(AiService);
    embeddingsService = module.get(EmbeddingsService);
    auditService = module.get(AuditService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('search', () => {
    it('returns empty array when Qdrant finds no results', async () => {
      aiService.generateEmbedding.mockResolvedValue(QUERY_VECTOR);
      embeddingsService.search.mockResolvedValue([]);

      const result = await service.search({ query: 'senior TypeScript developer' });

      expect(result).toEqual([]);
    });

    it('generates embedding with RETRIEVAL_QUERY task type', async () => {
      aiService.generateEmbedding.mockResolvedValue(QUERY_VECTOR);
      embeddingsService.search.mockResolvedValue([]);

      await service.search({ query: 'React developer' });

      expect(aiService.generateEmbedding).toHaveBeenCalledWith('React developer', 'RETRIEVAL_QUERY');
    });

    it('passes limit and filters to EmbeddingsService', async () => {
      aiService.generateEmbedding.mockResolvedValue(QUERY_VECTOR);
      embeddingsService.search.mockResolvedValue([]);

      await service.search({ query: 'Go developer', limit: 5, minExperienceYears: 3, requiredSkills: ['Go'] });

      expect(embeddingsService.search).toHaveBeenCalledWith(QUERY_VECTOR, 5, {
        minExperienceYears: 3,
        skills: ['Go'],
      });
    });

    it('uses default limit of 20 when not specified', async () => {
      aiService.generateEmbedding.mockResolvedValue(QUERY_VECTOR);
      embeddingsService.search.mockResolvedValue([]);

      await service.search({ query: 'developer' });

      expect(embeddingsService.search).toHaveBeenCalledWith(
        QUERY_VECTOR,
        20,
        expect.any(Object),
      );
    });

    it('returns ranked results with correct shape', async () => {
      aiService.generateEmbedding.mockResolvedValue(QUERY_VECTOR);
      embeddingsService.search.mockResolvedValue([buildVectorResult('app-uuid-1', 0.92)]);
      appRepo.find.mockResolvedValue([buildApplication()]);
      profileRepo.find.mockResolvedValue([buildProfile()]);

      const results = await service.search({ query: 'backend developer' });

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        applicationId: 'app-uuid-1',
        score: 0.92,
        candidate: {
          firstName: 'Alice',
          lastName: 'Wonder',
          email: 'alice@example.com',
          currentTitle: 'Backend Developer',
          skills: ['TypeScript', 'NestJS'],
          totalExperienceYears: 5,
        },
      });
    });

    it('rounds score to 2 decimal places', async () => {
      aiService.generateEmbedding.mockResolvedValue(QUERY_VECTOR);
      embeddingsService.search.mockResolvedValue([buildVectorResult('app-uuid-1', 0.9234567)]);
      appRepo.find.mockResolvedValue([buildApplication()]);
      profileRepo.find.mockResolvedValue([buildProfile()]);

      const results = await service.search({ query: 'developer' });

      expect(results[0].score).toBe(0.92);
    });

    it('excludes results where application or profile is missing in PostgreSQL', async () => {
      aiService.generateEmbedding.mockResolvedValue(QUERY_VECTOR);
      embeddingsService.search.mockResolvedValue([
        buildVectorResult('app-uuid-1', 0.9),
        buildVectorResult('app-uuid-missing', 0.85),
      ]);
      // Only app-uuid-1 exists in DB
      appRepo.find.mockResolvedValue([buildApplication('app-uuid-1')]);
      profileRepo.find.mockResolvedValue([buildProfile('app-uuid-1')]);

      const results = await service.search({ query: 'developer' });

      expect(results).toHaveLength(1);
      expect(results[0].applicationId).toBe('app-uuid-1');
    });

    it('logs SEARCH_PERFORMED audit event with results', async () => {
      aiService.generateEmbedding.mockResolvedValue(QUERY_VECTOR);
      embeddingsService.search.mockResolvedValue([buildVectorResult('app-uuid-1')]);
      appRepo.find.mockResolvedValue([buildApplication()]);
      profileRepo.find.mockResolvedValue([buildProfile()]);

      await service.search({ query: 'developer' }, 'user-uuid-1');

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.SEARCH_PERFORMED,
          userId: 'user-uuid-1',
          metadata: expect.objectContaining({ query: 'developer' }),
        }),
      );
    });

    it('does not log audit when Qdrant returns no results (early return)', async () => {
      aiService.generateEmbedding.mockResolvedValue(QUERY_VECTOR);
      embeddingsService.search.mockResolvedValue([]);

      await service.search({ query: 'developer' }, 'user-uuid-1');

      expect(auditService.log).not.toHaveBeenCalled();
    });

    it('includes resultsCount in audit metadata', async () => {
      aiService.generateEmbedding.mockResolvedValue(QUERY_VECTOR);
      embeddingsService.search.mockResolvedValue([buildVectorResult('app-uuid-1')]);
      appRepo.find.mockResolvedValue([buildApplication()]);
      profileRepo.find.mockResolvedValue([buildProfile()]);

      await service.search({ query: 'developer' }, 'user-uuid-1');

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ resultsCount: 1 }),
        }),
      );
    });
  });
});
