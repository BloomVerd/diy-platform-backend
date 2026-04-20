import {
  Args,
  ID,
  Int,
  Mutation,
  Query,
  Resolver,
} from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { Playlist, PlaylistVisibility } from './playlist.entity';
import { PlaylistSection } from './playlist-section.entity';
import { PlaylistItem } from './playlist-item.entity';
import { PlaylistProductLink } from './playlist-product-link.entity';
import { PlaylistService } from './playlist.service';
import { PlaylistConnection } from './dto/playlist-connection.type';
import { CreatePlaylistInput } from './dto/create-playlist.input';
import {
  UpdatePlaylistInput,
  AddPlaylistSectionInput,
  UpdatePlaylistSectionInput,
} from './dto/update-playlist.input';
import { AddVideoToPlaylistInput } from './dto/add-video-to-playlist.input';
import { LinkProductsToPlaylistInput } from './dto/link-products.input';
import { GqlAuthGuard } from '../../user/guards/gql-auth.guard';
import { RolesGuard } from '../../user/guards/roles.guard';
import { Roles } from '../../user/decorators/roles.decorator';
import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { UserRole } from '../../user/entities/user.entity';
import { JwtPayload } from '../../user/types/jwt-payload.type';

@Resolver(() => Playlist)
export class PlaylistResolver {
  constructor(private readonly playlistService: PlaylistService) {}

  // ---------------------------------------------------------------------------
  // Mutations — Playlist
  // ---------------------------------------------------------------------------

  @Mutation(() => Playlist)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.CREATOR)
  async createPlaylist(
    @Args('input') input: CreatePlaylistInput,
    @CurrentUser() user: JwtPayload,
  ): Promise<Playlist> {
    return this.playlistService.createPlaylist(user.userId, input);
  }

  @Mutation(() => Playlist)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.CREATOR)
  async updatePlaylist(
    @Args('input') input: UpdatePlaylistInput,
    @CurrentUser() user: JwtPayload,
  ): Promise<Playlist> {
    return this.playlistService.updatePlaylist(user.userId, input);
  }

  @Mutation(() => Playlist)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.CREATOR)
  async publishPlaylist(
    @Args('playlistId', { type: () => ID }) playlistId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<Playlist> {
    return this.playlistService.publishPlaylist(user.userId, playlistId);
  }

  // ---------------------------------------------------------------------------
  // Mutations — Sections
  // ---------------------------------------------------------------------------

  @Mutation(() => PlaylistSection)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.CREATOR)
  async addPlaylistSection(
    @Args('input') input: AddPlaylistSectionInput,
    @CurrentUser() user: JwtPayload,
  ): Promise<PlaylistSection> {
    return this.playlistService.addSection(user.userId, input);
  }

  @Mutation(() => PlaylistSection)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.CREATOR)
  async updatePlaylistSection(
    @Args('input') input: UpdatePlaylistSectionInput,
    @CurrentUser() user: JwtPayload,
  ): Promise<PlaylistSection> {
    return this.playlistService.updateSection(user.userId, input);
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.CREATOR)
  async removePlaylistSection(
    @Args('sectionId', { type: () => ID }) sectionId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<boolean> {
    return this.playlistService.removeSection(user.userId, sectionId);
  }

  // ---------------------------------------------------------------------------
  // Mutations — Items
  // ---------------------------------------------------------------------------

  @Mutation(() => PlaylistItem)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.CREATOR)
  async addVideoToPlaylist(
    @Args('input') input: AddVideoToPlaylistInput,
    @CurrentUser() user: JwtPayload,
  ): Promise<PlaylistItem> {
    return this.playlistService.addVideoToPlaylist(user.userId, input);
  }

  @Mutation(() => Playlist)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.CREATOR)
  async reorderPlaylistItems(
    @Args('playlistId', { type: () => ID }) playlistId: string,
    @Args('itemIds', { type: () => [ID] }) itemIds: string[],
    @CurrentUser() user: JwtPayload,
  ): Promise<Playlist> {
    return this.playlistService.reorderItems(user.userId, playlistId, itemIds);
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.CREATOR)
  async removeVideoFromPlaylist(
    @Args('playlistId', { type: () => ID }) playlistId: string,
    @Args('videoId', { type: () => ID }) videoId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<boolean> {
    return this.playlistService.removeVideoFromPlaylist(
      user.userId,
      playlistId,
      videoId,
    );
  }

  // ---------------------------------------------------------------------------
  // Mutations — Product Links
  // ---------------------------------------------------------------------------

  @Mutation(() => Playlist)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.CREATOR)
  async linkProductsToPlaylist(
    @Args('input') input: LinkProductsToPlaylistInput,
    @CurrentUser() user: JwtPayload,
  ): Promise<Playlist> {
    return this.playlistService.linkProducts(user.userId, input);
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.CREATOR)
  async unlinkProductFromPlaylist(
    @Args('playlistId', { type: () => ID }) playlistId: string,
    @Args('productId', { type: () => ID }) productId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<boolean> {
    return this.playlistService.unlinkProduct(user.userId, playlistId, productId);
  }

  @Mutation(() => Playlist)
  @UseGuards(GqlAuthGuard, RolesGuard)
  @Roles(UserRole.CREATOR)
  async reorderPlaylistProducts(
    @Args('playlistId', { type: () => ID }) playlistId: string,
    @Args('productIds', { type: () => [ID] }) productIds: string[],
    @CurrentUser() user: JwtPayload,
  ): Promise<Playlist> {
    return this.playlistService.reorderProducts(user.userId, playlistId, productIds);
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  @Query(() => PlaylistConnection)
  @UseGuards(GqlAuthGuard)
  async listUserPlaylists(
    @CurrentUser() user: JwtPayload,
    @Args('creatorId', { type: () => ID, nullable: true }) creatorId?: string,
    @Args('channelId', { type: () => ID, nullable: true }) channelId?: string,
    @Args('visibility', { type: () => PlaylistVisibility, nullable: true })
    visibility?: PlaylistVisibility,
    @Args('category', { nullable: true }) category?: string,
    @Args('cursor', { nullable: true }) cursor?: string,
    @Args('limit', { type: () => Int, defaultValue: 20 }) limit: number = 20,
  ): Promise<PlaylistConnection> {
    return this.playlistService.listUserPlaylists(
      user.userId,
      creatorId,
      channelId,
      visibility,
      category,
      cursor,
      limit,
    );
  }

  @Query(() => [PlaylistProductLink])
  async listPlaylistProducts(
    @Args('playlistId', { type: () => ID }) playlistId: string,
  ): Promise<PlaylistProductLink[]> {
    return this.playlistService.listLinkedProducts(playlistId);
  }
}
