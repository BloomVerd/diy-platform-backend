import { Args, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards, ForbiddenException } from '@nestjs/common';
import { UserService } from './user.service';
import { User, UserRole } from './entities/user.entity';
import { AuthResponse } from './dto/auth-response.type';
import { CreateUserInput } from './dto/create-user.input';
import { UpdateUserInput } from './dto/update-user.input';
import { LoginInput } from './dto/login.input';
import { OAuthLoginInput } from './dto/oauth-login.input';
import { RequestOtpInput } from './dto/request-otp.input';
import { VerifyOtpInput } from './dto/verify-otp.input';
import { ChangePasswordInput } from './dto/change-password.input';
import { PaginatedUsersResponse } from './dto/paginated-users-response.type';
import { GqlAuthGuard } from './guards/gql-auth.guard';
import { GqlRefreshGuard } from './guards/gql-refresh.guard';
import { RolesGuard } from './guards/roles.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { Roles } from './decorators/roles.decorator';
import { JwtPayload } from './types/jwt-payload.type';

@Resolver(() => User)
export class UserResolver {
  constructor(private readonly userService: UserService) {}

  // --- Public mutations ---

  @Mutation(() => AuthResponse)
  async signup(@Args('input') input: CreateUserInput): Promise<AuthResponse> {
    await this.userService.create(input);
    return this.userService.login({
      email: input.email,
      password: input.password,
    });
  }

  @Mutation(() => AuthResponse)
  async login(@Args('input') input: LoginInput): Promise<AuthResponse> {
    return this.userService.login(input);
  }

  @Mutation(() => AuthResponse)
  async loginWithOAuth(
    @Args('input') input: OAuthLoginInput,
  ): Promise<AuthResponse> {
    return this.userService.loginWithOAuth(input.provider, input.idToken);
  }

  @Mutation(() => Boolean)
  async requestEmailOtp(
    @Args('input') input: RequestOtpInput,
  ): Promise<boolean> {
    return this.userService.requestEmailOtp(input.email);
  }

  @Mutation(() => AuthResponse)
  async loginWithOtp(
    @Args('input') input: VerifyOtpInput,
  ): Promise<AuthResponse> {
    return this.userService.loginWithOtp(input.email, input.code);
  }

  @Mutation(() => AuthResponse)
  @UseGuards(GqlRefreshGuard)
  async refreshTokens(
    @CurrentUser() user: JwtPayload & { refreshToken: string },
  ): Promise<AuthResponse> {
    return this.userService.refreshTokens(user.userId, user.refreshToken);
  }

  // --- Authenticated queries ---

  @Query(() => User)
  @UseGuards(GqlAuthGuard)
  async me(@CurrentUser() user: JwtPayload): Promise<User> {
    return this.userService.findById(user.userId);
  }

  @Query(() => PaginatedUsersResponse)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async users(
    @Args('skip', { type: () => Int, defaultValue: 0 }) skip: number,
    @Args('take', { type: () => Int, defaultValue: 25 }) take: number,
  ): Promise<PaginatedUsersResponse> {
    return this.userService.findAll(skip, take);
  }

  @Query(() => User)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async user(@Args('id', { type: () => String }) id: string): Promise<User> {
    return this.userService.findById(id);
  }

  // --- Authenticated mutations ---

  @Mutation(() => User)
  @UseGuards(GqlAuthGuard)
  async updateUser(
    @Args('input') input: UpdateUserInput,
    @CurrentUser() currentUser: JwtPayload,
  ): Promise<User> {
    if (
      currentUser.userId !== input.id &&
      currentUser.role !== UserRole.ADMIN
    ) {
      throw new ForbiddenException('You can only update your own profile');
    }
    return this.userService.update(input.id, input);
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  async changePassword(
    @Args('input') input: ChangePasswordInput,
    @CurrentUser() user: JwtPayload,
  ): Promise<boolean> {
    return this.userService.changePassword(user.userId, input);
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  async logout(@CurrentUser() user: JwtPayload): Promise<boolean> {
    return this.userService.logout(user.userId);
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async removeUser(
    @Args('id', { type: () => String }) id: string,
  ): Promise<boolean> {
    return this.userService.remove(id);
  }
}
