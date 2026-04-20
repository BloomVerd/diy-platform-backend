import { Args, ID, Mutation, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { Video } from './video.entity';
import { VideoService } from './video.service';
import { UploadSession } from './dto/upload-session.type';
import { CreateVideoDraftInput } from './dto/create-video-draft.input';
import { CreateUploadSessionInput } from './dto/create-upload-session.input';
import { FinalizeUploadInput } from './dto/finalize-upload.input';
import { GqlAuthGuard } from '../../user/guards/gql-auth.guard';
import { RolesGuard } from '../../user/guards/roles.guard';
import { Roles } from '../../user/decorators/roles.decorator';
import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { UserRole } from '../../user/entities/user.entity';
import { JwtPayload } from '../../user/types/jwt-payload.type';

@Resolver(() => Video)
export class VideoResolver {
  constructor(private readonly videoService: VideoService) {}

  @Mutation(() => Video)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.CREATOR)
  async createVideoDraft(
    @Args('input') input: CreateVideoDraftInput,
    @CurrentUser() user: JwtPayload,
  ): Promise<Video> {
    return this.videoService.createVideoDraft(user.userId, input);
  }

  @Mutation(() => UploadSession)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.CREATOR)
  async createUploadSession(
    @Args('input') input: CreateUploadSessionInput,
    @CurrentUser() user: JwtPayload,
  ): Promise<UploadSession> {
    return this.videoService.createUploadSession(user.userId, input);
  }

  @Mutation(() => Video)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.CREATOR)
  async finalizeUpload(
    @Args('input') input: FinalizeUploadInput,
    @CurrentUser() user: JwtPayload,
  ): Promise<Video> {
    return this.videoService.finalizeUpload(user.userId, input);
  }

  @Mutation(() => Video)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.CREATOR, UserRole.ADMIN)
  async requestTranscode(
    @Args('videoId', { type: () => ID }) videoId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<Video> {
    return this.videoService.requestTranscode(user.userId, videoId);
  }
}
