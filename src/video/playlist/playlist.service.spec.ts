import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, ObjectLiteral } from 'typeorm';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PlaylistService } from './playlist.service';
import { Playlist, PlaylistVisibility } from './playlist.entity';
import { PlaylistSection } from './playlist-section.entity';
import { PlaylistItem } from './playlist-item.entity';
import { PlaylistStatistics } from './playlist-statistics.entity';
import { PlaylistProductLink } from './playlist-product-link.entity';
import { ChannelService } from '../channel/channel.service';
import { UserService } from '../../user/user.service';
import { Video } from '../video/video.entity';
import { Channel, ChannelStatus } from '../channel/channel.entity';

type MockRepo<T extends ObjectLiteral> = Partial<Record<keyof import('typeorm').Repository<T>, jest.Mock>>;

const mockRepo = <T extends ObjectLiteral>(): MockRepo<T> => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  count: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
  createQueryBuilder: jest.fn(),
});

// Returns a query builder where every method is a jest.Mock so TypeScript
// won't complain about missing mockResolvedValue / mockReturnThis calls.
const mockQb = (): Record<string, jest.Mock> => ({
  andWhere: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  innerJoin: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  clone: jest.fn().mockReturnThis(),
  getMany: jest.fn(),
  getCount: jest.fn(),
  getRawOne: jest.fn(),
});

describe('PlaylistService', () => {
  let service: PlaylistService;
  let playlistRepo: MockRepo<Playlist>;
  let sectionRepo: MockRepo<PlaylistSection>;
  let itemRepo: MockRepo<PlaylistItem>;
  let statsRepo: MockRepo<PlaylistStatistics>;
  let productLinkRepo: MockRepo<PlaylistProductLink>;
  let videoRepo: MockRepo<Video>;
  let channelService: jest.Mocked<ChannelService>;
  let userService: jest.Mocked<UserService>;
  let dataSource: { transaction: jest.Mock };

  const creatorId = 'creator-1';
  const playlistId = 'pl-1';
  const channelId = 'ch-1';

  const makePlaylist = (overrides: Partial<Playlist> = {}): Playlist =>
    ({
      id: playlistId,
      creatorId,
      channelId,
      title: 'Test Playlist',
      visibility: PlaylistVisibility.DRAFT,
      videoCount: 0,
      totalDurationSec: 0,
      updatedAt: new Date('2024-01-01T00:00:00Z'),
      ...overrides,
    }) as Playlist;

  beforeEach(async () => {
    dataSource = { transaction: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlaylistService,
        { provide: getRepositoryToken(Playlist), useValue: mockRepo<Playlist>() },
        { provide: getRepositoryToken(PlaylistSection), useValue: mockRepo<PlaylistSection>() },
        { provide: getRepositoryToken(PlaylistItem), useValue: mockRepo<PlaylistItem>() },
        { provide: getRepositoryToken(PlaylistStatistics), useValue: mockRepo<PlaylistStatistics>() },
        { provide: getRepositoryToken(PlaylistProductLink), useValue: mockRepo<PlaylistProductLink>() },
        { provide: getRepositoryToken(Video), useValue: mockRepo<Video>() },
        {
          provide: ChannelService,
          useValue: { assertOwnership: jest.fn(), findById: jest.fn() },
        },
        {
          provide: UserService,
          useValue: { isCreatorEligible: jest.fn() },
        },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<PlaylistService>(PlaylistService);
    playlistRepo = module.get(getRepositoryToken(Playlist));
    sectionRepo = module.get(getRepositoryToken(PlaylistSection));
    itemRepo = module.get(getRepositoryToken(PlaylistItem));
    statsRepo = module.get(getRepositoryToken(PlaylistStatistics));
    productLinkRepo = module.get(getRepositoryToken(PlaylistProductLink));
    videoRepo = module.get(getRepositoryToken(Video));
    channelService = module.get(ChannelService);
    userService = module.get(UserService);
  });

  afterEach(() => jest.clearAllMocks());

  // ---------------------------------------------------------------------------
  // createPlaylist
  // ---------------------------------------------------------------------------

  describe('createPlaylist', () => {
    it('creates a playlist in DRAFT visibility', async () => {
      channelService.assertOwnership.mockResolvedValue({ id: channelId } as Channel);
      const playlist = makePlaylist();
      playlistRepo.create!.mockReturnValue(playlist);
      playlistRepo.save!.mockResolvedValue(playlist);

      const result = await service.createPlaylist(creatorId, {
        channelId,
        title: 'Test Playlist',
      });

      expect(channelService.assertOwnership).toHaveBeenCalledWith(channelId, creatorId);
      expect(result.visibility).toBe(PlaylistVisibility.DRAFT);
    });

    it('throws when the creator does not own the channel', async () => {
      channelService.assertOwnership.mockRejectedValue(new ForbiddenException());

      await expect(
        service.createPlaylist(creatorId, { channelId, title: 'X' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ---------------------------------------------------------------------------
  // updatePlaylist
  // ---------------------------------------------------------------------------

  describe('updatePlaylist', () => {
    it('updates allowed fields and saves', async () => {
      const playlist = makePlaylist();
      playlistRepo.findOne!.mockResolvedValue(playlist);
      playlistRepo.save!.mockResolvedValue({ ...playlist, title: 'Updated' });

      const result = await service.updatePlaylist(creatorId, {
        playlistId,
        title: 'Updated',
      });

      expect(result.title).toBe('Updated');
    });

    it('delegates to publishPlaylist when visibility is set to PUBLISHED', async () => {
      const playlist = makePlaylist();
      playlistRepo.findOne!.mockResolvedValue(playlist);

      // Mock the pieces publishPlaylist needs
      const qb = mockQb();
      qb.getCount!.mockResolvedValue(1);
      itemRepo.createQueryBuilder!.mockReturnValue(qb as any);
      channelService.findById.mockResolvedValue({
        status: ChannelStatus.ACTIVE,
      } as Channel);
      userService.isCreatorEligible.mockResolvedValue(true);
      playlistRepo.save!.mockResolvedValue({
        ...playlist,
        visibility: PlaylistVisibility.PUBLISHED,
      });

      const result = await service.updatePlaylist(creatorId, {
        playlistId,
        visibility: PlaylistVisibility.PUBLISHED,
      });

      expect(result.visibility).toBe(PlaylistVisibility.PUBLISHED);
    });

    it('throws ForbiddenException when the requester is not the owner', async () => {
      playlistRepo.findOne!.mockResolvedValue(makePlaylist({ creatorId: 'other' }));

      await expect(
        service.updatePlaylist(creatorId, { playlistId, title: 'X' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ---------------------------------------------------------------------------
  // publishPlaylist
  // ---------------------------------------------------------------------------

  describe('publishPlaylist', () => {
    const setupPublish = () => {
      const playlist = makePlaylist({ title: 'My Playlist' });
      playlistRepo.findOne!.mockResolvedValue(playlist);

      const qb = mockQb();
      itemRepo.createQueryBuilder!.mockReturnValue(qb as any);
      channelService.findById.mockResolvedValue({
        status: ChannelStatus.ACTIVE,
      } as Channel);
      userService.isCreatorEligible.mockResolvedValue(true);
      playlistRepo.save!.mockResolvedValue({
        ...playlist,
        visibility: PlaylistVisibility.PUBLISHED,
        publishedAt: new Date(),
      });

      return { playlist, qb };
    };

    it('publishes a playlist that passes all pre-flight checks', async () => {
      const { qb } = setupPublish();
      qb.getCount!.mockResolvedValue(1);

      const result = await service.publishPlaylist(creatorId, playlistId);
      expect(result.visibility).toBe(PlaylistVisibility.PUBLISHED);
    });

    it('throws BadRequestException when there are no published videos', async () => {
      const { qb } = setupPublish();
      qb.getCount!.mockResolvedValue(0);

      await expect(service.publishPlaylist(creatorId, playlistId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when the playlist title is empty', async () => {
      playlistRepo.findOne!.mockResolvedValue(makePlaylist({ title: '   ' }));
      const qb = mockQb();
      qb.getCount!.mockResolvedValue(1);
      itemRepo.createQueryBuilder!.mockReturnValue(qb as any);

      await expect(service.publishPlaylist(creatorId, playlistId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when the channel is not ACTIVE', async () => {
      const { qb } = setupPublish();
      qb.getCount!.mockResolvedValue(1);
      channelService.findById.mockResolvedValue({
        status: ChannelStatus.SUSPENDED,
      } as Channel);

      await expect(service.publishPlaylist(creatorId, playlistId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws ForbiddenException when the creator is not eligible', async () => {
      const { qb } = setupPublish();
      qb.getCount!.mockResolvedValue(1);
      userService.isCreatorEligible.mockResolvedValue(false);

      await expect(service.publishPlaylist(creatorId, playlistId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws ForbiddenException when the creator does not own the playlist', async () => {
      playlistRepo.findOne!.mockResolvedValue(makePlaylist({ creatorId: 'other' }));

      await expect(service.publishPlaylist(creatorId, playlistId)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // addSection / updateSection / removeSection
  // ---------------------------------------------------------------------------

  describe('addSection', () => {
    it('creates a section with an auto-assigned position', async () => {
      playlistRepo.findOne!.mockResolvedValue(makePlaylist());
      sectionRepo.count!.mockResolvedValue(2);
      const section = { id: 's-1', playlistId, position: 2, title: 'Soil Prep' } as PlaylistSection;
      sectionRepo.create!.mockReturnValue(section);
      sectionRepo.save!.mockResolvedValue(section);

      const result = await service.addSection(creatorId, {
        playlistId,
        title: 'Soil Prep',
      });

      expect(result.position).toBe(2);
    });

    it('uses a provided position when given', async () => {
      playlistRepo.findOne!.mockResolvedValue(makePlaylist());
      const section = { id: 's-1', playlistId, position: 0, title: 'Intro' } as PlaylistSection;
      sectionRepo.create!.mockReturnValue(section);
      sectionRepo.save!.mockResolvedValue(section);

      const result = await service.addSection(creatorId, {
        playlistId,
        title: 'Intro',
        position: 0,
      });

      expect(sectionRepo.count).not.toHaveBeenCalled();
      expect(result.position).toBe(0);
    });
  });

  describe('updateSection', () => {
    it('updates a section and saves', async () => {
      const section = { id: 's-1', playlistId, title: 'Old Title' } as PlaylistSection;
      sectionRepo.findOne!.mockResolvedValue(section);
      playlistRepo.findOne!.mockResolvedValue(makePlaylist());
      sectionRepo.save!.mockResolvedValue({ ...section, title: 'New Title' });

      const result = await service.updateSection(creatorId, {
        sectionId: 's-1',
        title: 'New Title',
      });

      expect(result.title).toBe('New Title');
    });

    it('throws NotFoundException when section is missing', async () => {
      sectionRepo.findOne!.mockResolvedValue(null);

      await expect(
        service.updateSection(creatorId, { sectionId: 'missing', title: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('removeSection', () => {
    it('detaches items and deletes the section', async () => {
      const section = { id: 's-1', playlistId } as PlaylistSection;
      sectionRepo.findOne!.mockResolvedValue(section);
      playlistRepo.findOne!.mockResolvedValue(makePlaylist());
      itemRepo.update!.mockResolvedValue(undefined);
      sectionRepo.remove!.mockResolvedValue(section);

      const result = await service.removeSection(creatorId, 's-1');

      expect(itemRepo.update).toHaveBeenCalledWith(
        { sectionId: 's-1' },
        { sectionId: undefined },
      );
      expect(sectionRepo.remove).toHaveBeenCalledWith(section);
      expect(result).toBe(true);
    });

    it('throws NotFoundException when section is missing', async () => {
      sectionRepo.findOne!.mockResolvedValue(null);

      await expect(service.removeSection(creatorId, 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // addVideoToPlaylist / removeVideoFromPlaylist / reorderItems
  // ---------------------------------------------------------------------------

  describe('addVideoToPlaylist', () => {
    it('adds a video and recomputes aggregates', async () => {
      playlistRepo.findOne!.mockResolvedValue(makePlaylist());
      videoRepo.findOne!.mockResolvedValue({ id: 'v-1', durationSec: 120 } as Video);
      itemRepo.count!.mockResolvedValue(0);
      const item = { id: 'i-1', playlistId, videoId: 'v-1', position: 0 } as PlaylistItem;
      itemRepo.create!.mockReturnValue(item);
      itemRepo.save!.mockResolvedValue(item);

      // recomputePlaylistAggregates
      const qb = mockQb();
      qb.getRawOne!.mockResolvedValue({ videoCount: '1', totalDurationSec: '120' });
      itemRepo.createQueryBuilder!.mockReturnValue(qb as any);
      playlistRepo.update!.mockResolvedValue(undefined);

      const result = await service.addVideoToPlaylist(creatorId, {
        playlistId,
        videoId: 'v-1',
      });

      expect(result).toEqual(item);
      expect(playlistRepo.update).toHaveBeenCalledWith(playlistId, {
        videoCount: 1,
        totalDurationSec: 120,
      });
    });

    it('throws NotFoundException when the video does not exist', async () => {
      playlistRepo.findOne!.mockResolvedValue(makePlaylist());
      videoRepo.findOne!.mockResolvedValue(null);

      await expect(
        service.addVideoToPlaylist(creatorId, { playlistId, videoId: 'missing' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('removeVideoFromPlaylist', () => {
    it('removes the item and recomputes aggregates', async () => {
      playlistRepo.findOne!.mockResolvedValue(makePlaylist());
      const item = { id: 'i-1', playlistId, videoId: 'v-1' } as PlaylistItem;
      itemRepo.findOne!.mockResolvedValue(item);
      itemRepo.remove!.mockResolvedValue(item);

      const qb = mockQb();
      qb.getRawOne!.mockResolvedValue({ videoCount: '0', totalDurationSec: '0' });
      itemRepo.createQueryBuilder!.mockReturnValue(qb as any);
      playlistRepo.update!.mockResolvedValue(undefined);

      const result = await service.removeVideoFromPlaylist(creatorId, playlistId, 'v-1');
      expect(result).toBe(true);
      expect(itemRepo.remove).toHaveBeenCalledWith(item);
    });

    it('throws NotFoundException when the item is not in the playlist', async () => {
      playlistRepo.findOne!.mockResolvedValue(makePlaylist());
      itemRepo.findOne!.mockResolvedValue(null);

      await expect(
        service.removeVideoFromPlaylist(creatorId, playlistId, 'v-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('reorderItems', () => {
    it('updates position for each item id in order', async () => {
      playlistRepo.findOne!.mockResolvedValue(makePlaylist());
      dataSource.transaction.mockImplementation(async (cb: (em: any) => Promise<void>) => {
        await cb({ update: jest.fn() });
      });

      const result = await service.reorderItems(creatorId, playlistId, ['i-1', 'i-2']);
      expect(result.id).toBe(playlistId);
    });
  });

  // ---------------------------------------------------------------------------
  // linkProducts / unlinkProduct / reorderProducts
  // ---------------------------------------------------------------------------

  describe('linkProducts', () => {
    it('inserts new product links', async () => {
      playlistRepo.findOne!.mockResolvedValue(makePlaylist());
      productLinkRepo.count!.mockResolvedValue(0);
      productLinkRepo.findOne!.mockResolvedValue(null);
      productLinkRepo.create!.mockReturnValue({ playlistId, productId: 'p-1' });
      productLinkRepo.save!.mockResolvedValue(undefined);

      const result = await service.linkProducts(creatorId, {
        playlistId,
        links: [{ productId: 'p-1', displayOrder: 0 }],
      });

      expect(result.id).toBe(playlistId);
      expect(productLinkRepo.save).toHaveBeenCalled();
    });

    it('updates an existing link instead of inserting a duplicate', async () => {
      playlistRepo.findOne!.mockResolvedValue(makePlaylist());
      productLinkRepo.count!.mockResolvedValue(1);
      const existing = { playlistId, productId: 'p-1', displayOrder: 0 } as PlaylistProductLink;
      productLinkRepo.findOne!.mockResolvedValue(existing);
      productLinkRepo.save!.mockResolvedValue({ ...existing, displayOrder: 1 });

      await service.linkProducts(creatorId, {
        playlistId,
        links: [{ productId: 'p-1', displayOrder: 1 }],
      });

      expect(productLinkRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ displayOrder: 1 }),
      );
    });

    it('throws BadRequestException when product link limit (50) would be exceeded', async () => {
      playlistRepo.findOne!.mockResolvedValue(makePlaylist());
      productLinkRepo.count!.mockResolvedValue(48);

      await expect(
        service.linkProducts(creatorId, {
          playlistId,
          links: [{ productId: 'p-1' }, { productId: 'p-2' }, { productId: 'p-3' }],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('unlinkProduct', () => {
    it('removes an existing product link', async () => {
      playlistRepo.findOne!.mockResolvedValue(makePlaylist());
      const link = { playlistId, productId: 'p-1' } as PlaylistProductLink;
      productLinkRepo.findOne!.mockResolvedValue(link);
      productLinkRepo.remove!.mockResolvedValue(link);

      const result = await service.unlinkProduct(creatorId, playlistId, 'p-1');
      expect(result).toBe(true);
    });

    it('throws NotFoundException when the link does not exist', async () => {
      playlistRepo.findOne!.mockResolvedValue(makePlaylist());
      productLinkRepo.findOne!.mockResolvedValue(null);

      await expect(
        service.unlinkProduct(creatorId, playlistId, 'missing'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // listUserPlaylists
  // ---------------------------------------------------------------------------

  describe('listUserPlaylists', () => {
    it('returns only PUBLISHED playlists for non-owner requesters', async () => {
      const items = [makePlaylist({ visibility: PlaylistVisibility.PUBLISHED })];
      const qb = mockQb();
      qb.getMany!.mockResolvedValue(items);
      qb.getCount!.mockResolvedValue(1);
      playlistRepo.createQueryBuilder!.mockReturnValue(qb as any);

      const result = await service.listUserPlaylists(
        'other-user',
        creatorId,
        undefined,
        undefined,
        undefined,
        undefined,
        10,
      );

      expect(result.items).toHaveLength(1);
      expect(qb.andWhere).toHaveBeenCalledWith(
        'p.visibility = :visibility',
        { visibility: PlaylistVisibility.PUBLISHED },
      );
    });

    it('returns all playlists for the owning creator', async () => {
      const items = [
        makePlaylist({ visibility: PlaylistVisibility.DRAFT }),
        makePlaylist({ id: 'pl-2', visibility: PlaylistVisibility.PUBLISHED }),
      ];
      const qb = mockQb();
      qb.getMany!.mockResolvedValue(items);
      qb.getCount!.mockResolvedValue(2);
      playlistRepo.createQueryBuilder!.mockReturnValue(qb as any);

      const result = await service.listUserPlaylists(
        creatorId,
        creatorId,
        undefined,
        undefined,
        undefined,
        undefined,
        10,
      );

      expect(result.items).toHaveLength(2);
    });

    it('paginates correctly and returns nextCursor when hasMore is true', async () => {
      const items = Array.from({ length: 11 }, (_, i) =>
        makePlaylist({ id: `pl-${i}`, updatedAt: new Date(`2024-01-${String(11 - i).padStart(2, '0')}`) }),
      );
      const qb = mockQb();
      qb.getMany!.mockResolvedValue(items);
      qb.getCount!.mockResolvedValue(20);
      playlistRepo.createQueryBuilder!.mockReturnValue(qb as any);

      const result = await service.listUserPlaylists(
        creatorId,
        creatorId,
        undefined,
        undefined,
        undefined,
        undefined,
        10,
      );

      expect(result.items).toHaveLength(10);
      expect(result.nextCursor).toBeDefined();
      expect(result.nextCursor).toBeDefined();
    });
  });
});
