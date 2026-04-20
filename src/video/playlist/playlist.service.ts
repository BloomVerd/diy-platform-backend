import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Playlist, PlaylistVisibility } from './playlist.entity';
import { PlaylistSection } from './playlist-section.entity';
import { PlaylistItem } from './playlist-item.entity';
import { PlaylistStatistics } from './playlist-statistics.entity';
import { PlaylistProductLink } from './playlist-product-link.entity';
import { CreatePlaylistInput } from './dto/create-playlist.input';
import {
  UpdatePlaylistInput,
  AddPlaylistSectionInput,
  UpdatePlaylistSectionInput,
} from './dto/update-playlist.input';
import { AddVideoToPlaylistInput } from './dto/add-video-to-playlist.input';
import {
  LinkProductsToPlaylistInput,
} from './dto/link-products.input';
import { PlaylistConnection } from './dto/playlist-connection.type';
import { ChannelService } from '../channel/channel.service';
import { ChannelStatus } from '../channel/channel.entity';
import { UserService } from '../../user/user.service';
import { Video, ProcessingStatus, VideoVisibility } from '../video/video.entity';

@Injectable()
export class PlaylistService {
  constructor(
    @InjectRepository(Playlist)
    private readonly playlistRepo: Repository<Playlist>,
    @InjectRepository(PlaylistSection)
    private readonly sectionRepo: Repository<PlaylistSection>,
    @InjectRepository(PlaylistItem)
    private readonly itemRepo: Repository<PlaylistItem>,
    @InjectRepository(PlaylistStatistics)
    private readonly statsRepo: Repository<PlaylistStatistics>,
    @InjectRepository(PlaylistProductLink)
    private readonly productLinkRepo: Repository<PlaylistProductLink>,
    @InjectRepository(Video)
    private readonly videoRepo: Repository<Video>,
    private readonly channelService: ChannelService,
    private readonly userService: UserService,
    private readonly dataSource: DataSource,
  ) {}

  // ---------------------------------------------------------------------------
  // Playlist CRUD
  // ---------------------------------------------------------------------------

  async createPlaylist(
    creatorId: string,
    input: CreatePlaylistInput,
  ): Promise<Playlist> {
    await this.channelService.assertOwnership(input.channelId, creatorId);

    const playlist = this.playlistRepo.create({
      channelId: input.channelId,
      creatorId,
      title: input.title,
      description: input.description,
      category: input.category,
      coverImageUrl: input.coverImageUrl,
      visibility: PlaylistVisibility.DRAFT,
    });

    return this.playlistRepo.save(playlist);
  }

  async updatePlaylist(
    creatorId: string,
    input: UpdatePlaylistInput,
  ): Promise<Playlist> {
    const playlist = await this.assertOwnership(input.playlistId, creatorId);

    if (input.visibility === PlaylistVisibility.PUBLISHED) {
      return this.publishPlaylist(creatorId, input.playlistId);
    }

    Object.assign(playlist, {
      ...(input.title !== undefined && { title: input.title }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.category !== undefined && { category: input.category }),
      ...(input.coverImageUrl !== undefined && { coverImageUrl: input.coverImageUrl }),
      ...(input.visibility !== undefined && { visibility: input.visibility }),
    });

    return this.playlistRepo.save(playlist);
  }

  async listUserPlaylists(
    requesterId: string | null,
    creatorId: string | undefined,
    channelId: string | undefined,
    visibility: PlaylistVisibility | undefined,
    category: string | undefined,
    cursor: string | undefined,
    limit: number,
  ): Promise<PlaylistConnection> {
    const isOwner = requesterId !== null && requesterId === creatorId;

    const qb = this.playlistRepo.createQueryBuilder('p');

    if (creatorId) qb.andWhere('p.creatorId = :creatorId', { creatorId });
    if (channelId) qb.andWhere('p.channelId = :channelId', { channelId });
    if (category) qb.andWhere('p.category = :category', { category });

    if (isOwner) {
      if (visibility) qb.andWhere('p.visibility = :visibility', { visibility });
    } else {
      qb.andWhere('p.visibility = :visibility', {
        visibility: PlaylistVisibility.PUBLISHED,
      });
    }

    if (cursor) {
      qb.andWhere('p.updatedAt < :cursor', { cursor: new Date(Buffer.from(cursor, 'base64').toString()) });
    }

    qb.orderBy('p.updatedAt', 'DESC').take(limit + 1);

    const items = await qb.getMany();
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;

    const nextCursor = hasMore
      ? Buffer.from(page[page.length - 1].updatedAt.toISOString()).toString('base64')
      : undefined;

    const totalCount = await qb.clone().skip(0).take(undefined).getCount();

    return { items: page, nextCursor, totalCount };
  }

  async findById(id: string): Promise<Playlist> {
    const playlist = await this.playlistRepo.findOne({ where: { id } });
    if (!playlist) {
      throw new NotFoundException(`Playlist ${id} not found`);
    }
    return playlist;
  }

  // ---------------------------------------------------------------------------
  // Sections
  // ---------------------------------------------------------------------------

  async addSection(
    creatorId: string,
    input: AddPlaylistSectionInput,
  ): Promise<PlaylistSection> {
    await this.assertOwnership(input.playlistId, creatorId);

    const position =
      input.position ??
      (await this.sectionRepo.count({ where: { playlistId: input.playlistId } }));

    const section = this.sectionRepo.create({
      playlistId: input.playlistId,
      title: input.title,
      description: input.description,
      position,
    });

    return this.sectionRepo.save(section);
  }

  async updateSection(
    creatorId: string,
    input: UpdatePlaylistSectionInput,
  ): Promise<PlaylistSection> {
    const section = await this.sectionRepo.findOne({
      where: { id: input.sectionId },
    });
    if (!section) throw new NotFoundException(`Section ${input.sectionId} not found`);

    await this.assertOwnership(section.playlistId, creatorId);

    Object.assign(section, {
      ...(input.title !== undefined && { title: input.title }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.position !== undefined && { position: input.position }),
    });

    return this.sectionRepo.save(section);
  }

  async removeSection(creatorId: string, sectionId: string): Promise<boolean> {
    const section = await this.sectionRepo.findOne({ where: { id: sectionId } });
    if (!section) throw new NotFoundException(`Section ${sectionId} not found`);

    await this.assertOwnership(section.playlistId, creatorId);

    // Detach items — set their sectionId to null
    await this.itemRepo.update({ sectionId }, { sectionId: undefined });
    await this.sectionRepo.remove(section);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Items
  // ---------------------------------------------------------------------------

  async addVideoToPlaylist(
    creatorId: string,
    input: AddVideoToPlaylistInput,
  ): Promise<PlaylistItem> {
    await this.assertOwnership(input.playlistId, creatorId);

    const video = await this.videoRepo.findOne({ where: { id: input.videoId } });
    if (!video) throw new NotFoundException(`Video ${input.videoId} not found`);

    const position =
      input.position ??
      (await this.itemRepo.count({ where: { playlistId: input.playlistId } }));

    const item = this.itemRepo.create({
      playlistId: input.playlistId,
      videoId: input.videoId,
      sectionId: input.sectionId,
      position,
      note: input.note,
    });

    const saved = await this.itemRepo.save(item);
    await this.recomputePlaylistAggregates(input.playlistId);
    return saved;
  }

  async reorderItems(
    creatorId: string,
    playlistId: string,
    itemIds: string[],
  ): Promise<Playlist> {
    await this.assertOwnership(playlistId, creatorId);

    await this.dataSource.transaction(async (em) => {
      for (let i = 0; i < itemIds.length; i++) {
        await em.update(PlaylistItem, { id: itemIds[i], playlistId }, { position: i });
      }
    });

    return this.findById(playlistId);
  }

  async removeVideoFromPlaylist(
    creatorId: string,
    playlistId: string,
    videoId: string,
  ): Promise<boolean> {
    await this.assertOwnership(playlistId, creatorId);

    const item = await this.itemRepo.findOne({ where: { playlistId, videoId } });
    if (!item) throw new NotFoundException('Video is not in this playlist');

    await this.itemRepo.remove(item);
    await this.recomputePlaylistAggregates(playlistId);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Publish
  // ---------------------------------------------------------------------------

  async publishPlaylist(creatorId: string, playlistId: string): Promise<Playlist> {
    const playlist = await this.assertOwnership(playlistId, creatorId);

    // Pre-flight: at least one PUBLISHED video
    const publishedVideoCount = await this.itemRepo
      .createQueryBuilder('i')
      .innerJoin('i.video', 'v')
      .where('i.playlistId = :playlistId', { playlistId })
      .andWhere('v.visibility = :vis', { vis: VideoVisibility.PUBLISHED })
      .getCount();

    if (publishedVideoCount === 0) {
      throw new BadRequestException(
        'Playlist must contain at least one published video before it can be published',
      );
    }

    // Pre-flight: title must not be empty
    if (!playlist.title.trim()) {
      throw new BadRequestException('Playlist title must not be empty');
    }

    // Pre-flight: channel must be ACTIVE
    const channel = await this.channelService.findById(playlist.channelId);
    if (channel.status !== ChannelStatus.ACTIVE) {
      throw new BadRequestException('Your channel must be active to publish playlists');
    }

    // Pre-flight: creator account must be in good standing
    const eligible = await this.userService.isCreatorEligible(creatorId);
    if (!eligible) {
      throw new ForbiddenException(
        'Your account is not eligible to publish content',
      );
    }

    playlist.visibility = PlaylistVisibility.PUBLISHED;
    playlist.publishedAt = new Date();
    const saved = await this.playlistRepo.save(playlist);

    // TODO: invalidate Redis cache playlist:hot:{playlistId}
    // TODO: emit playlist.published event { playlistId, creatorId, channelId, category }

    return saved;
  }

  // ---------------------------------------------------------------------------
  // Product links
  // ---------------------------------------------------------------------------

  async linkProducts(
    creatorId: string,
    input: LinkProductsToPlaylistInput,
  ): Promise<Playlist> {
    await this.assertOwnership(input.playlistId, creatorId);

    const existingCount = await this.productLinkRepo.count({
      where: { playlistId: input.playlistId },
    });
    if (existingCount + input.links.length > 50) {
      throw new BadRequestException('A playlist can have at most 50 product links');
    }

    // TODO: call ShopService.getProductsByIds to validate ownership
    // For now we upsert directly

    for (const link of input.links) {
      const existing = await this.productLinkRepo.findOne({
        where: { playlistId: input.playlistId, productId: link.productId },
      });

      if (existing) {
        existing.displayOrder = link.displayOrder ?? existing.displayOrder;
        existing.note = link.note ?? existing.note;
        await this.productLinkRepo.save(existing);
      } else {
        await this.productLinkRepo.save(
          this.productLinkRepo.create({
            playlistId: input.playlistId,
            productId: link.productId,
            displayOrder: link.displayOrder ?? 0,
            note: link.note,
          }),
        );
      }
    }

    // TODO: emit playlist.products.updated event
    return this.findById(input.playlistId);
  }

  async unlinkProduct(
    creatorId: string,
    playlistId: string,
    productId: string,
  ): Promise<boolean> {
    await this.assertOwnership(playlistId, creatorId);

    const link = await this.productLinkRepo.findOne({
      where: { playlistId, productId },
    });
    if (!link) throw new NotFoundException('Product link not found');

    await this.productLinkRepo.remove(link);
    return true;
  }

  async reorderProducts(
    creatorId: string,
    playlistId: string,
    productIds: string[],
  ): Promise<Playlist> {
    await this.assertOwnership(playlistId, creatorId);

    await this.dataSource.transaction(async (em) => {
      for (let i = 0; i < productIds.length; i++) {
        await em.update(
          PlaylistProductLink,
          { playlistId, productId: productIds[i] },
          { displayOrder: i },
        );
      }
    });

    return this.findById(playlistId);
  }

  async listLinkedProducts(playlistId: string): Promise<PlaylistProductLink[]> {
    return this.productLinkRepo.find({
      where: { playlistId },
      order: { displayOrder: 'ASC' },
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async assertOwnership(playlistId: string, creatorId: string): Promise<Playlist> {
    const playlist = await this.findById(playlistId);
    if (playlist.creatorId !== creatorId) {
      throw new ForbiddenException('You do not own this playlist');
    }
    return playlist;
  }

  private async recomputePlaylistAggregates(playlistId: string): Promise<void> {
    const result = await this.itemRepo
      .createQueryBuilder('i')
      .innerJoin('i.video', 'v')
      .select('COUNT(i.id)', 'videoCount')
      .addSelect('COALESCE(SUM(v.durationSec), 0)', 'totalDurationSec')
      .where('i.playlistId = :playlistId', { playlistId })
      .getRawOne<{ videoCount: string; totalDurationSec: string }>();

    await this.playlistRepo.update(playlistId, {
      videoCount: parseInt(result?.videoCount ?? '0', 10),
      totalDurationSec: parseInt(result?.totalDurationSec ?? '0', 10),
    });
  }
}
