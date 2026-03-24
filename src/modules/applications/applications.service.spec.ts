import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ApplicationsService } from './applications.service';
import {
  ApplicationEntity,
  ApplicationStatus,
} from '../../database/entities/application.entity';
import { CandidateProfileEntity } from '../../database/entities/candidate-profile.entity';
import { StorageService } from './storage.service';
import { QueueService } from '../queue/queue.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../../database/entities/audit-log.entity';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { ApplicationQueryDto } from './dto/application-query.dto';

const mockAppRepo = () => ({
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  update: jest.fn(),
  increment: jest.fn(),
  createQueryBuilder: jest.fn(),
});

const mockProfileRepo = () => ({});

const mockStorageService = () => ({
  upload: jest.fn(),
  getSignedUrl: jest.fn(),
});

const mockQueueService = () => ({
  publishApplicationJob: jest.fn().mockResolvedValue(undefined),
});

const mockAuditService = () => ({
  log: jest.fn().mockResolvedValue(undefined),
});

function buildApplication(overrides: Partial<ApplicationEntity> = {}): ApplicationEntity {
  return {
    id: 'app-uuid-1',
    firstName: 'Alice',
    lastName: 'Wonder',
    email: 'alice@example.com',
    phone: null,
    linkedinUrl: null,
    portfolioUrl: null,
    positionAppliedFor: 'Software Engineer',
    resumeKey: 'resumes/app-uuid-1.pdf',
    resumeContentType: 'application/pdf',
    resumeSize: 204800,
    status: ApplicationStatus.PENDING,
    processingAttempts: 0,
    failureReason: null,
    rawResumeText: null,
    processedAt: null,
    candidateProfile: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ApplicationEntity;
}

function buildMulterFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: 'resume',
    originalname: 'cv.pdf',
    encoding: '7bit',
    mimetype: 'application/pdf',
    buffer: Buffer.from('pdf content'),
    size: 1024,
    stream: null as any,
    destination: '',
    filename: 'cv.pdf',
    path: '',
    ...overrides,
  };
}

describe('ApplicationsService', () => {
  let service: ApplicationsService;
  let appRepo: ReturnType<typeof mockAppRepo>;
  let storageService: ReturnType<typeof mockStorageService>;
  let queueService: ReturnType<typeof mockQueueService>;
  let auditService: ReturnType<typeof mockAuditService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApplicationsService,
        { provide: getRepositoryToken(ApplicationEntity), useFactory: mockAppRepo },
        { provide: getRepositoryToken(CandidateProfileEntity), useFactory: mockProfileRepo },
        { provide: StorageService, useFactory: mockStorageService },
        { provide: QueueService, useFactory: mockQueueService },
        { provide: AuditService, useFactory: mockAuditService },
      ],
    }).compile();

    service = module.get(ApplicationsService);
    appRepo = module.get(getRepositoryToken(ApplicationEntity));
    storageService = module.get(StorageService);
    queueService = module.get(QueueService);
    auditService = module.get(AuditService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── create ──────────────────────────────────────────────────────────────────

  describe('create', () => {
    const dto = {
      firstName: 'Alice',
      lastName: 'Wonder',
      email: 'Alice@Example.COM',
      positionAppliedFor: 'Engineer',
    };

    it('throws BadRequestException when no file is provided', async () => {
      await expect(service.create(dto as any, null as any)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for unsupported MIME type', async () => {
      const file = buildMulterFile({ mimetype: 'image/png' });

      await expect(service.create(dto as any, file)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when file exceeds 10 MB', async () => {
      const file = buildMulterFile({ size: 11 * 1024 * 1024 });

      await expect(service.create(dto as any, file)).rejects.toThrow(BadRequestException);
    });

    it('uploads file to S3 and saves application', async () => {
      const file = buildMulterFile();
      const saved = buildApplication();
      storageService.upload.mockResolvedValue({
        key: 'resumes/app-uuid-1.pdf',
        contentType: 'application/pdf',
        size: 1024,
      });
      appRepo.create.mockReturnValue(saved);
      appRepo.save.mockResolvedValue(saved);

      await service.create(dto as any, file);

      expect(storageService.upload).toHaveBeenCalledWith(file, 'resumes');
      expect(appRepo.save).toHaveBeenCalled();
    });

    it('normalises email to lowercase', async () => {
      const file = buildMulterFile();
      const saved = buildApplication();
      storageService.upload.mockResolvedValue({
        key: 'k',
        contentType: 'application/pdf',
        size: 100,
      });
      appRepo.create.mockReturnValue(saved);
      appRepo.save.mockResolvedValue(saved);

      await service.create(dto as any, file);

      expect(appRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'alice@example.com' }),
      );
    });

    it('publishes to queue after saving', async () => {
      const file = buildMulterFile();
      const saved = buildApplication();
      storageService.upload.mockResolvedValue({
        key: 'k',
        contentType: 'application/pdf',
        size: 100,
      });
      appRepo.create.mockReturnValue(saved);
      appRepo.save.mockResolvedValue(saved);

      await service.create(dto as any, file);

      expect(queueService.publishApplicationJob).toHaveBeenCalledWith(saved.id);
    });

    it('logs APPLICATION_CREATED audit event', async () => {
      const file = buildMulterFile();
      const saved = buildApplication();
      storageService.upload.mockResolvedValue({
        key: 'k',
        contentType: 'application/pdf',
        size: 100,
      });
      appRepo.create.mockReturnValue(saved);
      appRepo.save.mockResolvedValue(saved);

      await service.create(dto as any, file);

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.APPLICATION_CREATED }),
      );
    });

    it('accepts DOCX MIME type', async () => {
      const file = buildMulterFile({
        mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      const saved = buildApplication();
      storageService.upload.mockResolvedValue({
        key: 'k',
        contentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: 100,
      });
      appRepo.create.mockReturnValue(saved);
      appRepo.save.mockResolvedValue(saved);

      await expect(service.create(dto as any, file)).resolves.toBeDefined();
    });
  });

  // ─── findOne ─────────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('returns application when found', async () => {
      const app = buildApplication();
      appRepo.findOne.mockResolvedValue(app);

      const result = await service.findOne('app-uuid-1');

      expect(result).toBe(app);
    });

    it('throws NotFoundException when not found', async () => {
      appRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('missing-id')).rejects.toThrow(NotFoundException);
    });

    it('logs PROFILE_VIEWED when userId is provided', async () => {
      appRepo.findOne.mockResolvedValue(buildApplication());

      await service.findOne('app-uuid-1', 'user-uuid-1');

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.PROFILE_VIEWED,
          userId: 'user-uuid-1',
          resourceId: 'app-uuid-1',
        }),
      );
    });

    it('does not log when userId is not provided', async () => {
      appRepo.findOne.mockResolvedValue(buildApplication());

      await service.findOne('app-uuid-1');

      expect(auditService.log).not.toHaveBeenCalled();
    });
  });

  // ─── getResumeUrl ────────────────────────────────────────────────────────────

  describe('getResumeUrl', () => {
    it('returns signed URL', async () => {
      appRepo.findOne.mockResolvedValue(buildApplication());
      storageService.getSignedUrl.mockResolvedValue('https://s3.example.com/signed');

      const url = await service.getResumeUrl('app-uuid-1');

      expect(url).toBe('https://s3.example.com/signed');
    });

    it('logs RESUME_DOWNLOADED when userId is provided', async () => {
      appRepo.findOne.mockResolvedValue(buildApplication());
      storageService.getSignedUrl.mockResolvedValue('https://s3.example.com/signed');

      await service.getResumeUrl('app-uuid-1', 'user-uuid-1');

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.RESUME_DOWNLOADED }),
      );
    });
  });

  // ─── updateStatus ────────────────────────────────────────────────────────────

  describe('updateStatus', () => {
    it('updates status and logs APPLICATION_STATUS_CHANGED', async () => {
      appRepo.update.mockResolvedValue({});

      await service.updateStatus('app-uuid-1', ApplicationStatus.COMPLETED);

      expect(appRepo.update).toHaveBeenCalledWith('app-uuid-1', {
        status: ApplicationStatus.COMPLETED,
      });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.APPLICATION_STATUS_CHANGED }),
      );
    });
  });

  // ─── markFailed ──────────────────────────────────────────────────────────────

  describe('markFailed', () => {
    it('increments processingAttempts and sets FAILED status with reason', async () => {
      appRepo.increment.mockResolvedValue({});
      appRepo.update.mockResolvedValue({});

      await service.markFailed('app-uuid-1', 'AI parsing error');

      expect(appRepo.increment).toHaveBeenCalledWith({ id: 'app-uuid-1' }, 'processingAttempts', 1);
      expect(appRepo.update).toHaveBeenCalledWith('app-uuid-1', {
        status: ApplicationStatus.FAILED,
        failureReason: 'AI parsing error',
      });
    });
  });

  // ─── markProcessing / markCompleted ──────────────────────────────────────────

  describe('markProcessing', () => {
    it('sets status to PROCESSING', async () => {
      appRepo.update.mockResolvedValue({});

      await service.markProcessing('app-uuid-1');

      expect(appRepo.update).toHaveBeenCalledWith('app-uuid-1', {
        status: ApplicationStatus.PROCESSING,
      });
    });
  });

  describe('markCompleted', () => {
    it('sets status to COMPLETED with processedAt timestamp', async () => {
      appRepo.update.mockResolvedValue({});

      await service.markCompleted('app-uuid-1');

      expect(appRepo.update).toHaveBeenCalledWith(
        'app-uuid-1',
        expect.objectContaining({
          status: ApplicationStatus.COMPLETED,
          processedAt: expect.any(Date),
        }),
      );
    });
  });
});
