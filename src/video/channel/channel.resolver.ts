import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { Channel } from './channel.entity';
import { ChannelService } from './channel.service';
import { CreateChannelInput } from './dto/create-channel.input';
import { GqlAuthGuard } from '../../user/guards/gql-auth.guard';
import { RolesGuard } from '../../user/guards/roles.guard';
import { Roles } from '../../user/decorators/roles.decorator';
import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { UserRole } from '../../user/entities/user.entity';
import { JwtPayload } from '../../user/types/jwt-payload.type';

@Resolver(() => Channel)
export class ChannelResolver {
  constructor(private readonly channelService: ChannelService) {}

  @Mutation(() => Channel)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.CREATOR)
  async createChannel(
    @Args('input') input: CreateChannelInput,
    @CurrentUser() user: JwtPayload,
  ): Promise<Channel> {
    return this.channelService.createChannel(user.userId, input);
  }

  @Query(() => [Channel])
  @UseGuards(GqlAuthGuard)
  async myChannels(@CurrentUser() user: JwtPayload): Promise<Channel[]> {
    return this.channelService.findByCreator(user.userId);
  }

  @Query(() => Channel)
  @UseGuards(GqlAuthGuard)
  async channel(@Args('id') id: string): Promise<Channel> {
    return this.channelService.findById(id);
  }
}
