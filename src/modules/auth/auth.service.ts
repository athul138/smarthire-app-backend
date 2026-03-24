import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { UserEntity, UserStatus } from '../../database/entities/user.entity';
import { RefreshTokenEntity } from '../../database/entities/refresh-token.entity';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../../database/entities/audit-log.entity';
import { LoginDto } from './dto/login.dto';
import { TokenResponseDto } from './dto/token-response.dto';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(RefreshTokenEntity)
    private readonly tokenRepo: Repository<RefreshTokenEntity>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly auditService: AuditService,
  ) {}

  async validateUser(email: string, password: string): Promise<UserEntity | null> {
    const user = await this.userRepo.findOne({ where: { email: email.toLowerCase() } });
    if (!user) return null;
    if (user.status !== UserStatus.ACTIVE) return null;

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) return null;

    return user;
  }

  async login(dto: LoginDto, ip?: string, userAgent?: string): Promise<TokenResponseDto> {
    const user = await this.validateUser(dto.email, dto.password);

    if (!user) {
      await this.auditService.log({
        action: AuditAction.LOGIN_FAILED,
        metadata: { email: dto.email },
        ipAddress: ip,
        userAgent,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.generateTokenPair(user, ip, userAgent);

    await this.userRepo.update(user.id, { lastLoginAt: new Date() });

    await this.auditService.log({
      userId: user.id,
      action: AuditAction.LOGIN,
      ipAddress: ip,
      userAgent,
    });

    return tokens;
  }

  async refresh(token: string, ip?: string, userAgent?: string): Promise<TokenResponseDto> {
    const stored = await this.tokenRepo.findOne({
      where: { token },
      relations: ['user'],
    });

    if (!stored || !stored.isValid) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (stored.user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Account is not active');
    }

    // Rotate: revoke old, issue new
    await this.tokenRepo.update(stored.id, { revoked: true });

    const tokens = await this.generateTokenPair(stored.user, ip, userAgent);

    await this.auditService.log({
      userId: stored.user.id,
      action: AuditAction.TOKEN_REFRESH,
      ipAddress: ip,
      userAgent,
    });

    return tokens;
  }

  async logout(userId: string, refreshToken: string): Promise<void> {
    await this.tokenRepo.update({ userId, token: refreshToken }, { revoked: true });

    await this.auditService.log({
      userId,
      action: AuditAction.LOGOUT,
    });
  }

  async logoutAll(userId: string): Promise<void> {
    await this.tokenRepo.update({ userId }, { revoked: true });
  }

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
  }

  private async generateTokenPair(
    user: UserEntity,
    ip?: string,
    userAgent?: string,
  ): Promise<TokenResponseDto> {
    const payload = { sub: user.id, email: user.email, role: user.role };
    const accessToken = this.jwtService.sign(payload);

    const refreshSecret = this.configService.get<string>('jwt.refreshSecret');
    const refreshExpiresIn = this.configService.get<string>('jwt.refreshExpiresIn', '7d');
    const rawRefreshToken = uuidv4();

    const expiresAt = this.parseExpiry(refreshExpiresIn);
    await this.tokenRepo.save({
      token: rawRefreshToken,
      userId: user.id,
      expiresAt,
      ipAddress: ip ?? null,
      userAgent: userAgent ?? null,
    });

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      expiresIn: this.configService.get<string>('jwt.expiresIn', '15m'),
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
    };
  }

  private parseExpiry(expiry: string): Date {
    const now = new Date();
    const match = expiry.match(/^(\d+)([smhd])$/);
    if (!match) return new Date(now.getTime() + 7 * 24 * 3600 * 1000);

    const value = parseInt(match[1], 10);
    const unit = match[2];
    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 3600 * 1000,
      d: 86400 * 1000,
    };
    return new Date(now.getTime() + value * (multipliers[unit] ?? 0));
  }
}
