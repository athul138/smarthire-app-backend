import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { UserEntity, UserRole, UserStatus } from '../../database/entities/user.entity';
import { RefreshTokenEntity } from '../../database/entities/refresh-token.entity';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../../database/entities/audit-log.entity';

const mockUserRepo = () => ({
  findOne: jest.fn(),
  update: jest.fn(),
  save: jest.fn(),
});

const mockTokenRepo = () => ({
  findOne: jest.fn(),
  update: jest.fn(),
  save: jest.fn(),
});

const mockJwtService = () => ({
  sign: jest.fn().mockReturnValue('signed.jwt.token'),
});

const mockConfigService = () => ({
  get: jest.fn((key: string, defaultVal?: any) => {
    const config: Record<string, any> = {
      'jwt.refreshSecret': 'refresh-secret',
      'jwt.refreshExpiresIn': '7d',
      'jwt.expiresIn': '15m',
    };
    return config[key] ?? defaultVal;
  }),
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

describe('AuthService', () => {
  let service: AuthService;
  let userRepo: ReturnType<typeof mockUserRepo>;
  let tokenRepo: ReturnType<typeof mockTokenRepo>;
  let jwtService: ReturnType<typeof mockJwtService>;
  let auditService: ReturnType<typeof mockAuditService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(UserEntity), useFactory: mockUserRepo },
        { provide: getRepositoryToken(RefreshTokenEntity), useFactory: mockTokenRepo },
        { provide: JwtService, useFactory: mockJwtService },
        { provide: ConfigService, useFactory: mockConfigService },
        { provide: AuditService, useFactory: mockAuditService },
      ],
    }).compile();

    service = module.get(AuthService);
    userRepo = module.get(getRepositoryToken(UserEntity));
    tokenRepo = module.get(getRepositoryToken(RefreshTokenEntity));
    jwtService = module.get(JwtService);
    auditService = module.get(AuditService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── validateUser ────────────────────────────────────────────────────────────

  describe('validateUser', () => {
    it('returns null when user does not exist', async () => {
      userRepo.findOne.mockResolvedValue(null);

      const result = await service.validateUser('missing@example.com', 'password');

      expect(result).toBeNull();
    });

    it('returns null when user is not ACTIVE', async () => {
      userRepo.findOne.mockResolvedValue(buildUser({ status: UserStatus.INACTIVE }));
      jest.spyOn(bcrypt, 'compare' as any).mockResolvedValue(true as never);

      const result = await service.validateUser('hr@example.com', 'password');

      expect(result).toBeNull();
    });

    it('returns null when password does not match', async () => {
      userRepo.findOne.mockResolvedValue(buildUser());
      jest.spyOn(bcrypt, 'compare' as any).mockResolvedValue(false as never);

      const result = await service.validateUser('hr@example.com', 'wrongpass');

      expect(result).toBeNull();
    });

    it('returns user entity on valid credentials', async () => {
      const user = buildUser();
      userRepo.findOne.mockResolvedValue(user);
      jest.spyOn(bcrypt, 'compare' as any).mockResolvedValue(true as never);

      const result = await service.validateUser('hr@example.com', 'correctpass');

      expect(result).toBe(user);
    });

    it('normalises email to lowercase before lookup', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await service.validateUser('HR@Example.COM', 'password');

      expect(userRepo.findOne).toHaveBeenCalledWith({
        where: { email: 'hr@example.com' },
      });
    });
  });

  // ─── login ───────────────────────────────────────────────────────────────────

  describe('login', () => {
    it('throws UnauthorizedException and logs LOGIN_FAILED when credentials are invalid', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.login({ email: 'x@x.com', password: 'bad' })).rejects.toThrow(
        UnauthorizedException,
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.LOGIN_FAILED }),
      );
    });

    it('returns token pair and logs LOGIN on success', async () => {
      const user = buildUser();
      userRepo.findOne.mockResolvedValue(user);
      jest.spyOn(bcrypt, 'compare' as any).mockResolvedValue(true as never);
      tokenRepo.save.mockResolvedValue({});
      userRepo.update.mockResolvedValue({});

      const result = await service.login(
        { email: 'hr@example.com', password: 'valid' },
        '127.0.0.1',
        'Mozilla',
      );

      expect(result.accessToken).toBe('signed.jwt.token');
      expect(result.refreshToken).toBeDefined();
      expect(result.user.email).toBe(user.email);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.LOGIN, userId: user.id }),
      );
    });

    it('updates lastLoginAt on successful login', async () => {
      const user = buildUser();
      userRepo.findOne.mockResolvedValue(user);
      jest.spyOn(bcrypt, 'compare' as any).mockResolvedValue(true as never);
      tokenRepo.save.mockResolvedValue({});
      userRepo.update.mockResolvedValue({});

      await service.login({ email: 'hr@example.com', password: 'valid' });

      expect(userRepo.update).toHaveBeenCalledWith(
        user.id,
        expect.objectContaining({ lastLoginAt: expect.any(Date) }),
      );
    });
  });

  // ─── refresh ─────────────────────────────────────────────────────────────────

  describe('refresh', () => {
    it('throws UnauthorizedException when token is not found', async () => {
      tokenRepo.findOne.mockResolvedValue(null);

      await expect(service.refresh('unknown-token')).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when stored token is invalid', async () => {
      tokenRepo.findOne.mockResolvedValue({
        id: 'tok-1',
        isValid: false,
        user: buildUser(),
      });

      await expect(service.refresh('expired-token')).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when user account is not ACTIVE', async () => {
      tokenRepo.findOne.mockResolvedValue({
        id: 'tok-1',
        isValid: true,
        user: buildUser({ status: UserStatus.SUSPENDED }),
      });

      await expect(service.refresh('valid-token')).rejects.toThrow(UnauthorizedException);
    });

    it('rotates token and returns new pair on valid refresh', async () => {
      const user = buildUser();
      tokenRepo.findOne.mockResolvedValue({ id: 'tok-1', isValid: true, user });
      tokenRepo.update.mockResolvedValue({});
      tokenRepo.save.mockResolvedValue({});

      const result = await service.refresh('valid-token');

      expect(tokenRepo.update).toHaveBeenCalledWith('tok-1', { revoked: true });
      expect(result.accessToken).toBe('signed.jwt.token');
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.TOKEN_REFRESH }),
      );
    });
  });

  // ─── logout ──────────────────────────────────────────────────────────────────

  describe('logout', () => {
    it('revokes the specific refresh token and logs LOGOUT', async () => {
      tokenRepo.update.mockResolvedValue({});

      await service.logout('user-uuid-1', 'refresh-token-xyz');

      expect(tokenRepo.update).toHaveBeenCalledWith(
        { userId: 'user-uuid-1', token: 'refresh-token-xyz' },
        { revoked: true },
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.LOGOUT, userId: 'user-uuid-1' }),
      );
    });
  });

  // ─── logoutAll ───────────────────────────────────────────────────────────────

  describe('logoutAll', () => {
    it('revokes all tokens for the user', async () => {
      tokenRepo.update.mockResolvedValue({});

      await service.logoutAll('user-uuid-1');

      expect(tokenRepo.update).toHaveBeenCalledWith({ userId: 'user-uuid-1' }, { revoked: true });
    });
  });

  // ─── hashPassword ────────────────────────────────────────────────────────────

  describe('hashPassword', () => {
    it('returns a bcrypt hash', async () => {
      const hash = await service.hashPassword('my-secret');

      expect(hash).not.toBe('my-secret');
      const isValid = await bcrypt.compare('my-secret', hash);
      expect(isValid).toBe(true);
    });
  });
});
