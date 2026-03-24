import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditService } from './audit.service';
import { AuditLogEntity, AuditAction } from '../../database/entities/audit-log.entity';
import { PaginationDto } from '../../common/dto/pagination.dto';

const mockAuditRepo = () => ({
  save: jest.fn(),
  findAndCount: jest.fn(),
});

describe('AuditService', () => {
  let service: AuditService;
  let auditRepo: ReturnType<typeof mockAuditRepo>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: getRepositoryToken(AuditLogEntity), useFactory: mockAuditRepo },
      ],
    }).compile();

    service = module.get(AuditService);
    auditRepo = module.get(getRepositoryToken(AuditLogEntity));
  });

  afterEach(() => jest.clearAllMocks());

  // ─── log ────────────────────────────────────────────────────────────────────

  describe('log', () => {
    it('saves an audit log entry with all provided fields', async () => {
      auditRepo.save.mockResolvedValue({});

      await service.log({
        userId: 'user-uuid-1',
        action: AuditAction.LOGIN,
        resourceId: 'res-uuid-1',
        resourceType: 'user',
        metadata: { ip: '127.0.0.1' },
        ipAddress: '127.0.0.1',
        userAgent: 'Mozilla/5.0',
      });

      expect(auditRepo.save).toHaveBeenCalledWith({
        userId: 'user-uuid-1',
        action: AuditAction.LOGIN,
        resourceId: 'res-uuid-1',
        resourceType: 'user',
        metadata: { ip: '127.0.0.1' },
        ipAddress: '127.0.0.1',
        userAgent: 'Mozilla/5.0',
      });
    });

    it('uses null for optional fields when not provided', async () => {
      auditRepo.save.mockResolvedValue({});

      await service.log({ action: AuditAction.SEARCH_PERFORMED });

      expect(auditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: null,
          resourceId: null,
          resourceType: null,
          metadata: null,
          ipAddress: null,
          userAgent: null,
        }),
      );
    });

    it('does not throw when save fails — audit must never break business logic', async () => {
      auditRepo.save.mockRejectedValue(new Error('DB connection lost'));

      await expect(
        service.log({ action: AuditAction.APPLICATION_CREATED }),
      ).resolves.toBeUndefined();
    });

    it('calls save with the correct AuditAction', async () => {
      auditRepo.save.mockResolvedValue({});

      await service.log({ action: AuditAction.LOGOUT, userId: 'u1' });

      expect(auditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.LOGOUT }),
      );
    });
  });

  // ─── findAll ─────────────────────────────────────────────────────────────────

  describe('findAll', () => {
    const pagination = Object.assign(new PaginationDto(), { page: 1, limit: 20 });

    it('returns paginated audit logs without filters', async () => {
      const entries = [{ id: 'log-1', action: AuditAction.LOGIN }];
      auditRepo.findAndCount.mockResolvedValue([entries, 1]);

      const result = await service.findAll(pagination);

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
    });

    it('applies userId filter', async () => {
      auditRepo.findAndCount.mockResolvedValue([[], 0]);

      await service.findAll(pagination, { userId: 'user-uuid-1' });

      expect(auditRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId: 'user-uuid-1' }) }),
      );
    });

    it('applies action filter', async () => {
      auditRepo.findAndCount.mockResolvedValue([[], 0]);

      await service.findAll(pagination, { action: AuditAction.SEARCH_PERFORMED });

      expect(auditRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ action: AuditAction.SEARCH_PERFORMED }),
        }),
      );
    });

    it('applies date range filter when both from and to are provided', async () => {
      auditRepo.findAndCount.mockResolvedValue([[], 0]);
      const from = new Date('2024-01-01');
      const to = new Date('2024-01-31');

      await service.findAll(pagination, { from, to });

      const callArg = auditRepo.findAndCount.mock.calls[0][0];
      expect(callArg.where.createdAt).toBeDefined();
    });

    it('does not apply date range when only one bound is provided', async () => {
      auditRepo.findAndCount.mockResolvedValue([[], 0]);

      await service.findAll(pagination, { from: new Date('2024-01-01') });

      const callArg = auditRepo.findAndCount.mock.calls[0][0];
      expect(callArg.where.createdAt).toBeUndefined();
    });

    it('orders results by createdAt DESC', async () => {
      auditRepo.findAndCount.mockResolvedValue([[], 0]);

      await service.findAll(pagination);

      expect(auditRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ order: { createdAt: 'DESC' } }),
      );
    });

    it('calculates correct totalPages', async () => {
      auditRepo.findAndCount.mockResolvedValue([[], 45]);

      const result = await service.findAll(pagination); // limit=20

      expect(result.totalPages).toBe(3); // ceil(45/20)
    });
  });
});
