import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { Livestream, LivestreamStatus } from './livestream.entity';
import { LivestreamProduct } from './livestream-product.entity';
import { LivestreamService } from './livestream.service';
import { LivestreamConnection } from './dto/livestream-connection.type';
import { ScheduleLivestreamInput } from './dto/schedule-livestream.input';
import { UpdateLivestreamInput } from './dto/update-livestream.input';
import { LinkProductsToLivestreamInput } from './dto/link-products-to-livestream.input';
import { GqlAuthGuard } from '../../user/guards/gql-auth.guard';
import { RolesGuard } from '../../user/guards/roles.guard';
import { Roles } from '../../user/decorators/roles.decorator';
import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { UserRole } from '../../user/entities/user.entity';
import { JwtPayload } from '../../user/types/jwt-payload.type';

@Resolver(() => Livestream)
export class LivestreamResolver {
  constructor(private readonly livestreamService: LivestreamService) {}

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  @Mutation(() => Livestream)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.CREATOR)
  async scheduleLivestream(
    @Args('input') input: ScheduleLivestreamInput,
    @CurrentUser() user: JwtPayload,
  ): Promise<Livestream> {
    return this.livestreamService.scheduleLivestream(user.userId, input);
  }

  @Mutation(() => Livestream)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.CREATOR)
  async startLivestream(
    @Args('livestreamId', { type: () => ID }) livestreamId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<Livestream> {
    return this.livestreamService.startLivestream(user.userId, livestreamId);
  }

  @Mutation(() => Livestream)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.CREATOR)
  async endLivestream(
    @Args('livestreamId', { type: () => ID }) livestreamId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<Livestream> {
    return this.livestreamService.endLivestream(user.userId, livestreamId);
  }

  @Mutation(() => Livestream)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.CREATOR)
  async cancelLivestream(
    @Args('livestreamId', { type: () => ID }) livestreamId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<Livestream> {
    return this.livestreamService.cancelLivestream(user.userId, livestreamId);
  }

  @Mutation(() => Livestream)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.CREATOR)
  async updateLivestream(
    @Args('input') input: UpdateLivestreamInput,
    @CurrentUser() user: JwtPayload,
  ): Promise<Livestream> {
    return this.livestreamService.updateLivestream(user.userId, input);
  }

  @Mutation(() => Livestream)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.CREATOR)
  async linkProductsToLivestream(
    @Args('input') input: LinkProductsToLivestreamInput,
    @CurrentUser() user: JwtPayload,
  ): Promise<Livestream> {
    return this.livestreamService.linkProducts(user.userId, input);
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.CREATOR)
  async unlinkProductFromLivestream(
    @Args('livestreamId', { type: () => ID }) livestreamId: string,
    @Args('productId', { type: () => ID }) productId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<boolean> {
    return this.livestreamService.unlinkProduct(user.userId, livestreamId, productId);
  }

  @Mutation(() => LivestreamProduct)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.CREATOR)
  async pinProductInLivestream(
    @Args('livestreamId', { type: () => ID }) livestreamId: string,
    @Args('productId', { type: () => ID }) productId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<LivestreamProduct> {
    return this.livestreamService.pinProduct(user.userId, livestreamId, productId);
  }

  @Mutation(() => LivestreamProduct)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.CREATOR)
  async unpinProductInLivestream(
    @Args('livestreamId', { type: () => ID }) livestreamId: string,
    @Args('productId', { type: () => ID }) productId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<LivestreamProduct> {
    return this.livestreamService.unpinProduct(user.userId, livestreamId, productId);
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  @Query(() => Livestream)
  async livestream(
    @Args('id', { type: () => ID }) id: string,
  ): Promise<Livestream> {
    return this.livestreamService.findById(id);
  }

  @Query(() => LivestreamConnection)
  async channelLivestreams(
    @Args('channelId', { type: () => ID }) channelId: string,
    @Args('status', { type: () => LivestreamStatus, nullable: true }) status?: LivestreamStatus,
    @Args('cursor', { nullable: true }) cursor?: string,
    @Args('limit', { type: () => Int, defaultValue: 20 }) limit: number = 20,
  ): Promise<LivestreamConnection> {
    return this.livestreamService.listChannelLivestreams(channelId, status, cursor, limit);
  }

  @Query(() => [LivestreamProduct])
  async livestreamProducts(
    @Args('livestreamId', { type: () => ID }) livestreamId: string,
  ): Promise<LivestreamProduct[]> {
    return this.livestreamService.listLinkedProducts(livestreamId);
  }
}
