import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { UserEntity, UserRole, UserStatus } from '../../database/entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { PaginationDto, PaginatedResult, paginate } from '../../common/dto/pagination.dto';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../../database/entities/audit-log.entity';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly repo: Repository<UserEntity>,
    private readonly auditService: AuditService,
  ) {}

  async create(dto: CreateUserDto, createdByUserId?: string): Promise<UserEntity> {
    const existing = await this.repo.findOne({ where: { email: dto.email.toLowerCase() } });
    if (existing) throw new ConflictException('Email already in use');

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const user = this.repo.create({
      ...dto,
      email: dto.email.toLowerCase(),
      passwordHash,
    });

    const saved = await this.repo.save(user);

    await this.auditService.log({
      userId: createdByUserId,
      action: AuditAction.USER_CREATED,
      resourceId: saved.id,
      resourceType: 'user',
      metadata: { email: saved.email, role: saved.role },
    });

    return saved;
  }

  async findAll(pagination: PaginationDto): Promise<PaginatedResult<UserEntity>> {
    const [items, total] = await this.repo.findAndCount({
      order: { createdAt: 'DESC' },
      skip: pagination.skip,
      take: pagination.limit,
    });
    return paginate(items, total, pagination);
  }

  async findOne(id: string): Promise<UserEntity> {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async findByEmail(email: string): Promise<UserEntity | null> {
    return this.repo.findOne({ where: { email: email.toLowerCase() } });
  }

  async update(id: string, dto: UpdateUserDto, updatedByUserId?: string): Promise<UserEntity> {
    const user = await this.findOne(id);

    if (dto.email && dto.email !== user.email) {
      const existing = await this.repo.findOne({ where: { email: dto.email.toLowerCase() } });
      if (existing) throw new ConflictException('Email already in use');
    }

    const updates: Partial<UserEntity> = {
      ...(dto.firstName && { firstName: dto.firstName }),
      ...(dto.lastName && { lastName: dto.lastName }),
      ...(dto.email && { email: dto.email.toLowerCase() }),
      ...(dto.role && { role: dto.role }),
      ...(dto.status && { status: dto.status }),
    };

    if (dto.password) {
      updates.passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    }

    await this.repo.update(id, updates);

    await this.auditService.log({
      userId: updatedByUserId,
      action: AuditAction.USER_UPDATED,
      resourceId: id,
      resourceType: 'user',
    });

    return this.findOne(id);
  }

  async deactivate(id: string, deactivatedByUserId?: string): Promise<void> {
    await this.findOne(id);
    await this.repo.update(id, { status: UserStatus.INACTIVE });

    await this.auditService.log({
      userId: deactivatedByUserId,
      action: AuditAction.USER_DEACTIVATED,
      resourceId: id,
      resourceType: 'user',
    });
  }
}
