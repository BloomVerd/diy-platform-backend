import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';

@Resolver()
export class ChannelManagementResolver {
  // Queries

  @Mutation(() => String)
  async createChannel(
    @Args('userId') userId: string,
    @Args('channelName') channelName: string,
    @Args('description') description: string,
  ) {
    // Logic to create a channel
    return this.createChannel(userId, channelName, description);
  }
}
