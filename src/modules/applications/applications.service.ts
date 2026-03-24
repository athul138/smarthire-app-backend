import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ApplicationEntity,
  ApplicationStatus,
} from '../../database/entities/application.entity';
import { CandidateProfileEntity } from '../../database/entities/candidate-profile.entity';
import { CreateApplicationDto } from './dto/create-application.dto';
import { StorageService } from './storage.service';
import { QueueService } from '../queue/queue.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../../database/entities/audit-log.entity';
import { PaginationDto, PaginatedResult, paginate } from '../../common/dto/pagination.dto';
import { ApplicationQueryDto } from './dto/application-query.dto';

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

@Injectable()
export class ApplicationsService {
  private readonly logger = new Logger(ApplicationsService.name);

  constructor(
    @InjectRepository(ApplicationEntity)
    private readonly repo: Repository<ApplicationEntity>,
    @InjectRepository(CandidateProfileEntity)
    private readonly profileRepo: Repository<CandidateProfileEntity>,
    private readonly storage: StorageService,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
  ) {}

  async create(
    dto: CreateApplicationDto,
    file: Express.Multer.File,
  ): Promise<ApplicationEntity> {
    this.validateFile(file);

    const { key, contentType, size } = await this.storage.upload(file, 'resumes');

    const application = this.repo.create({
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email.toLowerCase(),
      phone: dto.phone ?? null,
      linkedinUrl: dto.linkedinUrl ?? null,
      portfolioUrl: dto.portfolioUrl ?? null,
      positionAppliedFor: dto.positionAppliedFor ?? null,
      resumeKey: key,
      resumeContentType: contentType,
      resumeSize: size,
      status: ApplicationStatus.PENDING,
    });

    const saved = await this.repo.save(application);

    // Publish to queue for async AI processing
    await this.queue.publishApplicationJob(saved.id);

    await this.audit.log({
      action: AuditAction.APPLICATION_CREATED,
      resourceId: saved.id,
      resourceType: 'application',
      metadata: { email: saved.email },
    });

    this.logger.log(`Application created: ${saved.id} for ${saved.email}`);
    return saved;
  }

  async findAll(
    query: ApplicationQueryDto,
    pagination: PaginationDto,
  ): Promise<PaginatedResult<ApplicationEntity>> {
    const qb = this.repo
      .createQueryBuilder('app')
      .leftJoinAndSelect('app.candidateProfile', 'profile')
      .orderBy('app.createdAt', 'DESC');

    if (query.status) qb.andWhere('app.status = :status', { status: query.status });
    if (query.email) qb.andWhere('app.email ILIKE :email', { email: `%${query.email}%` });

    qb.skip(pagination.skip).take(pagination.limit);

    const [items, total] = await qb.getManyAndCount();
    return paginate(items, total, pagination);
  }

  async findOne(id: string, userId?: string): Promise<ApplicationEntity> {
    const app = await this.repo.findOne({
      where: { id },
      relations: ['candidateProfile'],
    });
    if (!app) throw new NotFoundException('Application not found');

    if (userId) {
      await this.audit.log({
        userId,
        action: AuditAction.PROFILE_VIEWED,
        resourceId: id,
        resourceType: 'application',
      });
    }

    return app;
  }

  async getResumeUrl(id: string, userId?: string): Promise<string> {
    const app = await this.findOne(id);

    if (userId) {
      await this.audit.log({
        userId,
        action: AuditAction.RESUME_DOWNLOADED,
        resourceId: id,
        resourceType: 'application',
      });
    }

    return this.storage.getSignedUrl(app.resumeKey);
  }

  async updateStatus(id: string, status: ApplicationStatus): Promise<void> {
    await this.repo.update(id, { status });

    await this.audit.log({
      action: AuditAction.APPLICATION_STATUS_CHANGED,
      resourceId: id,
      resourceType: 'application',
      metadata: { status },
    });
  }

  async markProcessing(id: string): Promise<void> {
    await this.repo.update(id, {
      status: ApplicationStatus.PROCESSING,
    });
  }

  async markCompleted(id: string): Promise<void> {
    await this.repo.update(id, {
      status: ApplicationStatus.COMPLETED,
      processedAt: new Date(),
    });
  }

  async markFailed(id: string, reason: string): Promise<void> {
    await this.repo.increment({ id }, 'processingAttempts', 1);
    await this.repo.update(id, {
      status: ApplicationStatus.FAILED,
      failureReason: reason,
    });
  }

  private validateFile(file: Express.Multer.File): void {
    if (!file) throw new BadRequestException('Resume file is required');
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Only PDF and Word documents are accepted');
    }
    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException('File size must not exceed 10 MB');
    }
  }
}
