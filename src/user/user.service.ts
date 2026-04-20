import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as argon2 from 'argon2';
import { randomInt } from 'crypto';
import type { StringValue } from 'ms';
import { Repository } from 'typeorm';
import { AuthProvider, User, UserRole } from './entities/user.entity';
import { CreateUserInput } from './dto/create-user.input';
import { UpdateUserInput } from './dto/update-user.input';
import { LoginInput } from './dto/login.input';
import { ChangePasswordInput } from './dto/change-password.input';
import { AuthResponse } from './dto/auth-response.type';
import { PaginatedUsersResponse } from './dto/paginated-users-response.type';
import { OAuthService, OAuthProfile } from './services/oauth.service';
import { OTP_QUEUE, OtpEmailJobPayload } from './processing/otp.queue';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private jwtService: JwtService,
    private configService: ConfigService,
    private oauthService: OAuthService,
    @InjectQueue(OTP_QUEUE)
    private otpQueue: Queue<OtpEmailJobPayload>,
  ) {}

  async create(input: CreateUserInput): Promise<User> {
    const existing = await this.userRepository.findOne({
      where: { email: input.email.toLowerCase() },
    });
    if (existing) {
      throw new ConflictException('User with this email already exists');
    }

    const hashedPassword = await argon2.hash(input.password);
    const user = this.userRepository.create({
      ...input,
      password: hashedPassword,
      provider: AuthProvider.LOCAL,
    });
    return this.userRepository.save(user);
  }

  async findAll(skip: number, take: number): Promise<PaginatedUsersResponse> {
    const [items, totalCount] = await this.userRepository.findAndCount({
      skip,
      take,
    });
    return {
      items,
      totalCount,
      hasMore: skip + take < totalCount,
    };
  }

  async findById(id: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { email: email.toLowerCase() },
    });
  }

  async update(id: string, input: UpdateUserInput): Promise<User> {
    const user = await this.findById(id);
    Object.assign(user, input);
    return this.userRepository.save(user);
  }

  async remove(id: string): Promise<boolean> {
    const user = await this.findById(id);
    user.isActive = false;
    await this.userRepository.save(user);
    return true;
  }

  async login(input: LoginInput): Promise<AuthResponse> {
    const user = await this.findByEmail(input.email);
    if (!user || !user.password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordValid = await argon2.verify(user.password, input.password);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.issueTokens(user);
  }

  async loginWithOAuth(
    provider: AuthProvider,
    idToken: string,
  ): Promise<AuthResponse> {
    if (provider === AuthProvider.LOCAL) {
      throw new BadRequestException('OAuth provider required');
    }

    const profile = await this.oauthService.verify(provider, idToken);
    const user = await this.findOrCreateFromOAuth(profile);
    return this.issueTokens(user);
  }

  async requestEmailOtp(email: string): Promise<boolean> {
    const user = await this.findByEmail(email);
    // Always return true to avoid email enumeration.
    if (!user || !user.isActive) {
      return true;
    }

    const code = this.generateOtpCode();
    const expiryMinutes = this.configService.get<number>(
      'OTP_EXPIRY_MINUTES',
      10,
    );

    user.otpCodeHash = await argon2.hash(code);
    user.otpExpiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);
    user.otpAttempts = 0;
    await this.userRepository.save(user);

    await this.otpQueue.add(
      'send-otp',
      { email: user.email, code, expiryMinutes },
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    );

    return true;
  }

  async loginWithOtp(email: string, code: string): Promise<AuthResponse> {
    const user = await this.findByEmail(email);
    if (!user || !user.isActive || !user.otpCodeHash || !user.otpExpiresAt) {
      throw new UnauthorizedException('Invalid or expired code');
    }

    const maxAttempts = this.configService.get<number>('OTP_MAX_ATTEMPTS', 5);
    if (user.otpAttempts >= maxAttempts) {
      await this.clearOtp(user);
      throw new UnauthorizedException('Too many attempts. Request a new code.');
    }

    if (user.otpExpiresAt.getTime() < Date.now()) {
      await this.clearOtp(user);
      throw new UnauthorizedException('Invalid or expired code');
    }

    const valid = await argon2.verify(user.otpCodeHash, code);
    if (!valid) {
      user.otpAttempts += 1;
      await this.userRepository.save(user);
      throw new UnauthorizedException('Invalid or expired code');
    }

    await this.clearOtp(user, { save: false });
    return this.issueTokens(user);
  }

  async refreshTokens(
    userId: string,
    refreshToken: string,
  ): Promise<AuthResponse> {
    const user = await this.findById(userId);
    if (!user.refreshToken) {
      throw new ForbiddenException('Access denied');
    }

    const tokenMatches = await argon2.verify(user.refreshToken, refreshToken);
    if (!tokenMatches) {
      throw new ForbiddenException('Access denied');
    }

    const tokens = await this.generateTokens(user.id, user.email, user.role);
    user.refreshToken = await argon2.hash(tokens.refreshToken);
    await this.userRepository.save(user);

    return { ...tokens, user };
  }

  async isCreatorEligible(creatorId: string): Promise<boolean> {
    const user = await this.findById(creatorId);
    return user.isActive && user.role === UserRole.CREATOR;
  }

  async logout(userId: string): Promise<boolean> {
    await this.userRepository.update(userId, { refreshToken: undefined });
    return true;
  }

  async changePassword(
    userId: string,
    input: ChangePasswordInput,
  ): Promise<boolean> {
    const user = await this.findById(userId);

    if (!user.password) {
      throw new BadRequestException(
        'Account has no password. Set one via password reset.',
      );
    }

    const passwordValid = await argon2.verify(
      user.password,
      input.currentPassword,
    );
    if (!passwordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    user.password = await argon2.hash(input.newPassword);
    user.refreshToken = undefined;
    await this.userRepository.save(user);
    return true;
  }

  private async findOrCreateFromOAuth(profile: OAuthProfile): Promise<User> {
    const existingByProvider = await this.userRepository.findOne({
      where: { provider: profile.provider, providerId: profile.providerId },
    });
    if (existingByProvider) {
      return existingByProvider;
    }

    const existingByEmail = await this.findByEmail(profile.email);
    if (existingByEmail) {
      if (
        existingByEmail.provider !== AuthProvider.LOCAL &&
        existingByEmail.provider !== profile.provider
      ) {
        throw new ConflictException(
          'Email is registered with a different provider',
        );
      }
      existingByEmail.provider = profile.provider;
      existingByEmail.providerId = profile.providerId;
      if (profile.emailVerified) {
        existingByEmail.isVerified = true;
      }
      return this.userRepository.save(existingByEmail);
    }

    const user = this.userRepository.create({
      email: profile.email,
      firstName: profile.firstName ?? '',
      lastName: profile.lastName ?? '',
      provider: profile.provider,
      providerId: profile.providerId,
      isVerified: profile.emailVerified,
    });
    return this.userRepository.save(user);
  }

  private async issueTokens(user: User): Promise<AuthResponse> {
    const tokens = await this.generateTokens(user.id, user.email, user.role);
    user.refreshToken = await argon2.hash(tokens.refreshToken);
    user.lastLoginAt = new Date();
    await this.userRepository.save(user);
    return { ...tokens, user };
  }

  private generateOtpCode(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  private async clearOtp(
    user: User,
    opts: { save?: boolean } = { save: true },
  ): Promise<void> {
    user.otpCodeHash = undefined;
    user.otpExpiresAt = undefined;
    user.otpAttempts = 0;
    if (opts.save !== false) {
      await this.userRepository.save(user);
    }
  }

  private async generateTokens(
    userId: string,
    email: string,
    role: UserRole,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const payload = { sub: userId, email, role };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.configService.get<string>(
          'JWT_ACCESS_EXPIRY',
          '15m',
        ) as StringValue,
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.configService.get<string>(
          'JWT_REFRESH_EXPIRY',
          '7d',
        ) as StringValue,
      }),
    ]);

    return { accessToken, refreshToken };
  }
}
