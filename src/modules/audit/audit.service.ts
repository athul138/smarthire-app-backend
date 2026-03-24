import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, FindOptionsWhere } from 'typeorm';
import { AuditLogEntity, AuditAction } from '../../database/entities/audit-log.entity';
import { PaginationDto, PaginatedResult, paginate } from '../../common/dto/pagination.dto';

interface LogParams {
  userId?: string;
  action: AuditAction;
  resourceId?: string;
  resourceType?: string;
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly repo: Repository<AuditLogEntity>,
  ) {}

  async log(params: LogParams): Promise<void> {
    try {
      await this.repo.save({
        userId: params.userId ?? null,
        action: params.action,
        resourceId: params.resourceId ?? null,
        resourceType: params.resourceType ?? null,
        metadata: params.metadata ?? null,
        ipAddress: params?.ipAddress ?? null,
        userAgent: params.userAgent ?? null,
      });
    } catch (err) {
      // Never throw — audit failures must not break business logic
      this.logger.error('Failed to write audit log', err);
    }
  }

  async findAll(
    pagination: PaginationDto,
    filters?: { userId?: string; action?: AuditAction; from?: Date; to?: Date },
  ): Promise<PaginatedResult<AuditLogEntity>> {
    const where: FindOptionsWhere<AuditLogEntity> = {};

    if (filters?.userId) where.userId = filters.userId;
    if (filters?.action) where.action = filters.action;
    if (filters?.from && filters?.to) {
      where.createdAt = Between(filters.from, filters.to);
    }

    const [items, total] = await this.repo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: pagination.skip,
      take: pagination.limit,
    });

    return paginate(items, total, pagination);
  }
}
