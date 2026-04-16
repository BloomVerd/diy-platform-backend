import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import type { StringValue } from 'ms';
import { Repository } from 'typeorm';
import { User, UserRole } from './entities/user.entity';
import { CreateUserInput } from './dto/create-user.input';
import { UpdateUserInput } from './dto/update-user.input';
import { LoginInput } from './dto/login.input';
import { ChangePasswordInput } from './dto/change-password.input';
import { AuthResponse } from './dto/auth-response.type';
import { PaginatedUsersResponse } from './dto/paginated-users-response.type';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private jwtService: JwtService,
    private configService: ConfigService,
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
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordValid = await argon2.verify(user.password, input.password);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.generateTokens(user.id, user.email, user.role);
    user.refreshToken = await argon2.hash(tokens.refreshToken);
    user.lastLoginAt = new Date();
    await this.userRepository.save(user);

    return { ...tokens, user };
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
