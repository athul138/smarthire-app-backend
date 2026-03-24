import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UsersService } from './users.service';
import { UserEntity, UserRole, UserStatus } from '../../database/entities/user.entity';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../../database/entities/audit-log.entity';
import { PaginationDto } from '../../common/dto/pagination.dto';

const mockUserRepo = () => ({
  findOne: jest.fn(),
  findAndCount: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
});

const mockAuditService = () => ({
  log: jest.fn().mockResolvedValue(undefined),
});

function buildUser(overrides: Partial<UserEntity> = {}): UserEntity {
  return {
    id: 'user-uuid-1',
    email: 'hr@example.com',
    firstName: 'Jane',
    lastName: 'Doe',
    passwordHash: '$2b$12$hashedpassword',
    role: UserRole.HR,
    status: UserStatus.ACTIVE,
    lastLoginAt: null,
    refreshTokens: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as UserEntity;
}

describe('UsersService', () => {
  let service: UsersService;
  let userRepo: ReturnType<typeof mockUserRepo>;
  let auditService: ReturnType<typeof mockAuditService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(UserEntity), useFactory: mockUserRepo },
        { provide: AuditService, useFactory: mockAuditService },
      ],
    }).compile();

    service = module.get(UsersService);
    userRepo = module.get(getRepositoryToken(UserEntity));
    auditService = module.get(AuditService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── create ──────────────────────────────────────────────────────────────────

  describe('create', () => {
    const dto = {
      firstName: 'John',
      lastName: 'Smith',
      email: 'john@example.com',
      password: 'SecurePass1!',
      role: UserRole.RECRUITER,
    };

    it('throws ConflictException if email is already taken', async () => {
      userRepo.findOne.mockResolvedValue(buildUser());

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });

    it('normalises email to lowercase', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const saved = buildUser({ email: 'john@example.com' });
      userRepo.create.mockReturnValue(saved);
      userRepo.save.mockResolvedValue(saved);

      await service.create({ ...dto, email: 'JOHN@Example.COM' });

      expect(userRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'john@example.com' }),
      );
    });

    it('hashes the password before saving', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const saved = buildUser();
      userRepo.create.mockReturnValue(saved);
      userRepo.save.mockResolvedValue(saved);

      await service.create(dto);

      const callArg = userRepo.create.mock.calls[0][0];
      expect(callArg.passwordHash).toBeDefined();
      expect(callArg.passwordHash).not.toBe(dto.password);
      const valid = await bcrypt.compare(dto.password, callArg.passwordHash);
      expect(valid).toBe(true);
    });

    it('logs USER_CREATED audit event', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const saved = buildUser();
      userRepo.create.mockReturnValue(saved);
      userRepo.save.mockResolvedValue(saved);

      await service.create(dto, 'admin-uuid');

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.USER_CREATED,
          userId: 'admin-uuid',
          resourceId: saved.id,
        }),
      );
    });

    it('returns the saved user', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const saved = buildUser();
      userRepo.create.mockReturnValue(saved);
      userRepo.save.mockResolvedValue(saved);

      const result = await service.create(dto);

      expect(result).toBe(saved);
    });
  });

  // ─── findAll ─────────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns paginated result', async () => {
      const users = [buildUser(), buildUser({ id: 'user-uuid-2', email: 'b@x.com' })];
      userRepo.findAndCount.mockResolvedValue([users, 2]);

      const pagination = Object.assign(new PaginationDto(), { page: 1, limit: 20 });
      const result = await service.findAll(pagination);

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.totalPages).toBe(1);
    });

    it('uses skip/take from pagination DTO', async () => {
      userRepo.findAndCount.mockResolvedValue([[], 0]);

      const pagination = Object.assign(new PaginationDto(), { page: 3, limit: 10 });
      await service.findAll(pagination);

      expect(userRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });
  });

  // ─── findOne ─────────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('returns user when found', async () => {
      const user = buildUser();
      userRepo.findOne.mockResolvedValue(user);

      const result = await service.findOne('user-uuid-1');

      expect(result).toBe(user);
    });

    it('throws NotFoundException when user does not exist', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('missing-id')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── findByEmail ──────────────────────────────────────────────────────────────

  describe('findByEmail', () => {
    it('looks up by lowercased email', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await service.findByEmail('HR@Example.COM');

      expect(userRepo.findOne).toHaveBeenCalledWith({ where: { email: 'hr@example.com' } });
    });
  });

  // ─── update ──────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('throws NotFoundException when updating a non-existent user', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.update('missing-id', { firstName: 'New' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException when new email is already taken', async () => {
      const existing = buildUser();
      const other = buildUser({ id: 'other-uuid', email: 'taken@x.com' });
      // first call: findOne for the user being updated
      // second call: email uniqueness check
      userRepo.findOne.mockResolvedValueOnce(existing).mockResolvedValueOnce(other);

      await expect(
        service.update('user-uuid-1', { email: 'taken@x.com' }),
      ).rejects.toThrow(ConflictException);
    });

    it('hashes password when password is included in update', async () => {
      const user = buildUser();
      userRepo.findOne.mockResolvedValue(user);
      userRepo.update.mockResolvedValue({});

      await service.update('user-uuid-1', { password: 'NewPass1!' });

      const callArg = userRepo.update.mock.calls[0][1];
      expect(callArg.passwordHash).toBeDefined();
      const valid = await bcrypt.compare('NewPass1!', callArg.passwordHash);
      expect(valid).toBe(true);
    });

    it('logs USER_UPDATED audit event', async () => {
      const user = buildUser();
      userRepo.findOne.mockResolvedValue(user);
      userRepo.update.mockResolvedValue({});

      await service.update('user-uuid-1', { firstName: 'Updated' }, 'admin-uuid');

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.USER_UPDATED,
          userId: 'admin-uuid',
          resourceId: 'user-uuid-1',
        }),
      );
    });
  });

  // ─── deactivate ──────────────────────────────────────────────────────────────

  describe('deactivate', () => {
    it('throws NotFoundException when user does not exist', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.deactivate('missing-id')).rejects.toThrow(NotFoundException);
    });

    it('sets status to INACTIVE', async () => {
      userRepo.findOne.mockResolvedValue(buildUser());
      userRepo.update.mockResolvedValue({});

      await service.deactivate('user-uuid-1');

      expect(userRepo.update).toHaveBeenCalledWith('user-uuid-1', {
        status: UserStatus.INACTIVE,
      });
    });

    it('logs USER_DEACTIVATED audit event', async () => {
      userRepo.findOne.mockResolvedValue(buildUser());
      userRepo.update.mockResolvedValue({});

      await service.deactivate('user-uuid-1', 'admin-uuid');

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.USER_DEACTIVATED,
          resourceId: 'user-uuid-1',
        }),
      );
    });
  });
});
