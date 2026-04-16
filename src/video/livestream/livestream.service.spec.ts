import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ObjectLiteral } from 'typeorm';
import { LivestreamService } from './livestream.service';
import { Livestream, LivestreamStatus } from './livestream.entity';
import { LivestreamProduct } from './livestream-product.entity';
import { LivestreamStatistics } from './livestream-statistics.entity';
import { ChannelService } from '../channel/channel.service';
import { RECORDING_QUEUE } from '../processing/recording.queue';
import { Channel } from '../channel/channel.entity';

type MockRepo<T extends ObjectLiteral> = Partial<
  Record<keyof import('typeorm').Repository<T>, jest.Mock>
>;

const mockRepo = <T extends ObjectLiteral>(): MockRepo<T> => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
  count: jest.fn(),
  createQueryBuilder: jest.fn(),
});

describe('LivestreamService', () => {
  let service: LivestreamService;
  let livestreamRepo: MockRepo<Livestream>;
  let productRepo: MockRepo<LivestreamProduct>;
  let statsRepo: MockRepo<LivestreamStatistics>;
  let recordingQueue: { add: jest.Mock };
  let channelService: jest.Mocked<ChannelService>;

  const creatorId = 'creator-1';
  const channelId = 'ch-1';
  const livestreamId = 'ls-1';

  const makeLivestream = (overrides: Partial<Livestream> = {}): Livestream =>
    ({
      id: livestreamId,
      creatorId,
      channelId,
      title: 'Live Farm Tour',
      status: LivestreamStatus.SCHEDULED,
      streamKey: 'abc123',
      ingestUrl: 'rtmp://localhost:1935/live/abc123',
      recordingEnabled: true,
      viewerCount: 0,
      peakViewerCount: 0,
      createdAt: new Date('2024-01-01T10:00:00Z'),
      updatedAt: new Date('2024-01-01T10:00:00Z'),
      ...overrides,
    }) as Livestream;

  beforeEach(async () => {
    recordingQueue = { add: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LivestreamService,
        { provide: getRepositoryToken(Livestream), useValue: mockRepo<Livestream>() },
        { provide: getRepositoryToken(LivestreamProduct), useValue: mockRepo<LivestreamProduct>() },
        { provide: getRepositoryToken(LivestreamStatistics), useValue: mockRepo<LivestreamStatistics>() },
        { provide: getQueueToken(RECORDING_QUEUE), useValue: recordingQueue },
        {
          provide: ChannelService,
          useValue: { assertOwnership: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn((key: string) =>
              key === 'STREAM_INGEST_BASE_URL'
                ? 'rtmp://localhost:1935/live'
                : 'https://cdn.example.com',
            ),
          },
        },
      ],
    }).compile();

    service = module.get<LivestreamService>(LivestreamService);
    livestreamRepo = module.get(getRepositoryToken(Livestream));
    productRepo = module.get(getRepositoryToken(LivestreamProduct));
    statsRepo = module.get(getRepositoryToken(LivestreamStatistics));
    channelService = module.get(ChannelService);
  });

  afterEach(() => jest.clearAllMocks());

  // ---------------------------------------------------------------------------
  // scheduleLivestream
  // ---------------------------------------------------------------------------

  describe('scheduleLivestream', () => {
    const input = { channelId, title: 'Live Farm Tour', recordingEnabled: true };

    it('creates a scheduled livestream with a unique streamKey and ingestUrl', async () => {
      channelService.assertOwnership.mockResolvedValue({ id: channelId } as Channel);
      const ls = makeLivestream();
      livestreamRepo.create!.mockReturnValue(ls);
      livestreamRepo.save!.mockResolvedValue(ls);
      statsRepo.create!.mockReturnValue({});
      statsRepo.save!.mockResolvedValue({});

      const result = await service.scheduleLivestream(creatorId, input);

      expect(channelService.assertOwnership).toHaveBeenCalledWith(channelId, creatorId);
      expect(result.status).toBe(LivestreamStatus.SCHEDULED);
      expect(livestreamRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ creatorId, channelId, status: LivestreamStatus.SCHEDULED }),
      );
      expect(statsRepo.save).toHaveBeenCalled();
    });

    it('throws ForbiddenException when the creator does not own the channel', async () => {
      channelService.assertOwnership.mockRejectedValue(new ForbiddenException());

      await expect(service.scheduleLivestream(creatorId, input)).rejects.toThrow(ForbiddenException);
    });
  });

  // ---------------------------------------------------------------------------
  // startLivestream
  // ---------------------------------------------------------------------------

  describe('startLivestream', () => {
    it('transitions a SCHEDULED stream to LIVE and sets playbackUrl', async () => {
      const ls = makeLivestream();
      livestreamRepo.findOne!
        .mockResolvedValueOnce(ls)
        .mockResolvedValueOnce({ ...ls, status: LivestreamStatus.LIVE, playbackUrl: 'https://cdn.example.com/live/abc123/index.m3u8' });
      livestreamRepo.update!.mockResolvedValue(undefined);

      const result = await service.startLivestream(creatorId, livestreamId);

      expect(livestreamRepo.update).toHaveBeenCalledWith(
        livestreamId,
        expect.objectContaining({ status: LivestreamStatus.LIVE }),
      );
      expect(result.status).toBe(LivestreamStatus.LIVE);
      expect(result.playbackUrl).toContain('index.m3u8');
    });

    it('throws BadRequestException when the stream is already LIVE', async () => {
      livestreamRepo.findOne!.mockResolvedValue(makeLivestream({ status: LivestreamStatus.LIVE }));

      await expect(service.startLivestream(creatorId, livestreamId)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when the stream is ENDED', async () => {
      livestreamRepo.findOne!.mockResolvedValue(makeLivestream({ status: LivestreamStatus.ENDED }));

      await expect(service.startLivestream(creatorId, livestreamId)).rejects.toThrow(BadRequestException);
    });

    it('throws ForbiddenException when the creator does not own the stream', async () => {
      livestreamRepo.findOne!.mockResolvedValue(makeLivestream({ creatorId: 'other' }));

      await expect(service.startLivestream(creatorId, livestreamId)).rejects.toThrow(ForbiddenException);
    });
  });

  // ---------------------------------------------------------------------------
  // endLivestream
  // ---------------------------------------------------------------------------

  describe('endLivestream', () => {
    it('transitions a LIVE stream to ENDED and enqueues a recording job when enabled', async () => {
      const ls = makeLivestream({ status: LivestreamStatus.LIVE });
      livestreamRepo.findOne!
        .mockResolvedValueOnce(ls)
        .mockResolvedValueOnce({ ...ls, status: LivestreamStatus.ENDED });
      livestreamRepo.update!.mockResolvedValue(undefined);

      const result = await service.endLivestream(creatorId, livestreamId);

      expect(livestreamRepo.update).toHaveBeenCalledWith(
        livestreamId,
        expect.objectContaining({ status: LivestreamStatus.ENDED }),
      );
      expect(recordingQueue.add).toHaveBeenCalledWith(
        'process-recording',
        expect.objectContaining({ livestreamId, creatorId }),
        expect.any(Object),
      );
      expect(result.status).toBe(LivestreamStatus.ENDED);
    });

    it('does NOT enqueue a recording job when recordingEnabled is false', async () => {
      const ls = makeLivestream({ status: LivestreamStatus.LIVE, recordingEnabled: false });
      livestreamRepo.findOne!
        .mockResolvedValueOnce(ls)
        .mockResolvedValueOnce({ ...ls, status: LivestreamStatus.ENDED });
      livestreamRepo.update!.mockResolvedValue(undefined);

      await service.endLivestream(creatorId, livestreamId);

      expect(recordingQueue.add).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the stream is not LIVE', async () => {
      livestreamRepo.findOne!.mockResolvedValue(makeLivestream({ status: LivestreamStatus.SCHEDULED }));

      await expect(service.endLivestream(creatorId, livestreamId)).rejects.toThrow(BadRequestException);
    });
  });

  // ---------------------------------------------------------------------------
  // cancelLivestream
  // ---------------------------------------------------------------------------

  describe('cancelLivestream', () => {
    it('transitions a SCHEDULED stream to CANCELLED', async () => {
      livestreamRepo.findOne!
        .mockResolvedValueOnce(makeLivestream())
        .mockResolvedValueOnce(makeLivestream({ status: LivestreamStatus.CANCELLED }));
      livestreamRepo.update!.mockResolvedValue(undefined);

      const result = await service.cancelLivestream(creatorId, livestreamId);

      expect(livestreamRepo.update).toHaveBeenCalledWith(
        livestreamId,
        { status: LivestreamStatus.CANCELLED },
      );
      expect(result.status).toBe(LivestreamStatus.CANCELLED);
    });

    it('throws BadRequestException when the stream is LIVE', async () => {
      livestreamRepo.findOne!.mockResolvedValue(makeLivestream({ status: LivestreamStatus.LIVE }));

      await expect(service.cancelLivestream(creatorId, livestreamId)).rejects.toThrow(BadRequestException);
    });
  });

  // ---------------------------------------------------------------------------
  // updateLivestream
  // ---------------------------------------------------------------------------

  describe('updateLivestream', () => {
    it('updates metadata for a SCHEDULED stream', async () => {
      const ls = makeLivestream();
      livestreamRepo.findOne!.mockResolvedValue(ls);
      livestreamRepo.save!.mockResolvedValue({ ...ls, title: 'Updated Title' });

      const result = await service.updateLivestream(creatorId, {
        livestreamId,
        title: 'Updated Title',
      });

      expect(result.title).toBe('Updated Title');
    });

    it('throws BadRequestException when updating a LIVE stream', async () => {
      livestreamRepo.findOne!.mockResolvedValue(makeLivestream({ status: LivestreamStatus.LIVE }));

      await expect(
        service.updateLivestream(creatorId, { livestreamId, title: 'X' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ---------------------------------------------------------------------------
  // linkProducts / unlinkProduct / pinProduct / unpinProduct
  // ---------------------------------------------------------------------------

  describe('linkProducts', () => {
    it('inserts new product links', async () => {
      livestreamRepo.findOne!.mockResolvedValue(makeLivestream());
      productRepo.count!.mockResolvedValue(0);
      productRepo.findOne!.mockResolvedValue(null);
      productRepo.create!.mockReturnValue({ livestreamId, productId: 'p-1' });
      productRepo.save!.mockResolvedValue(undefined);
      livestreamRepo.findOne!.mockResolvedValue(makeLivestream());

      await service.linkProducts(creatorId, {
        livestreamId,
        links: [{ productId: 'p-1', displayOrder: 0 }],
      });

      expect(productRepo.save).toHaveBeenCalled();
    });

    it('throws BadRequestException when product limit (30) would be exceeded', async () => {
      livestreamRepo.findOne!.mockResolvedValue(makeLivestream());
      productRepo.count!.mockResolvedValue(28);

      await expect(
        service.linkProducts(creatorId, {
          livestreamId,
          links: [{ productId: 'p-1' }, { productId: 'p-2' }, { productId: 'p-3' }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when linking to an ENDED stream', async () => {
      livestreamRepo.findOne!.mockResolvedValue(makeLivestream({ status: LivestreamStatus.ENDED }));

      await expect(
        service.linkProducts(creatorId, {
          livestreamId,
          links: [{ productId: 'p-1' }],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('pinProduct', () => {
    it('pins a product during a LIVE stream and unpins any previously pinned product', async () => {
      livestreamRepo.findOne!.mockResolvedValue(makeLivestream({ status: LivestreamStatus.LIVE }));
      const link = { livestreamId, productId: 'p-1', isPinned: false } as LivestreamProduct;
      productRepo.findOne!.mockResolvedValue(link);
      productRepo.update!.mockResolvedValue(undefined);
      productRepo.save!.mockResolvedValue({ ...link, isPinned: true });

      const result = await service.pinProduct(creatorId, livestreamId, 'p-1');

      expect(productRepo.update).toHaveBeenCalledWith(
        { livestreamId, isPinned: true },
        { isPinned: false },
      );
      expect(result.isPinned).toBe(true);
    });

    it('throws BadRequestException when the stream is not LIVE', async () => {
      livestreamRepo.findOne!.mockResolvedValue(makeLivestream({ status: LivestreamStatus.SCHEDULED }));

      await expect(
        service.pinProduct(creatorId, livestreamId, 'p-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when the product is not linked', async () => {
      livestreamRepo.findOne!.mockResolvedValue(makeLivestream({ status: LivestreamStatus.LIVE }));
      productRepo.findOne!.mockResolvedValue(null);

      await expect(
        service.pinProduct(creatorId, livestreamId, 'missing'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('unlinkProduct', () => {
    it('removes an existing product link', async () => {
      livestreamRepo.findOne!.mockResolvedValue(makeLivestream());
      const link = { livestreamId, productId: 'p-1' } as LivestreamProduct;
      productRepo.findOne!.mockResolvedValue(link);
      productRepo.remove!.mockResolvedValue(link);

      const result = await service.unlinkProduct(creatorId, livestreamId, 'p-1');
      expect(result).toBe(true);
    });

    it('throws NotFoundException when the link does not exist', async () => {
      livestreamRepo.findOne!.mockResolvedValue(makeLivestream());
      productRepo.findOne!.mockResolvedValue(null);

      await expect(
        service.unlinkProduct(creatorId, livestreamId, 'missing'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // findById / assertOwnership
  // ---------------------------------------------------------------------------

  describe('findById', () => {
    it('returns the livestream when found', async () => {
      const ls = makeLivestream();
      livestreamRepo.findOne!.mockResolvedValue(ls);
      await expect(service.findById(livestreamId)).resolves.toEqual(ls);
    });

    it('throws NotFoundException when not found', async () => {
      livestreamRepo.findOne!.mockResolvedValue(null);
      await expect(service.findById('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('assertOwnership', () => {
    it('returns the stream when the requester is the owner', async () => {
      const ls = makeLivestream();
      livestreamRepo.findOne!.mockResolvedValue(ls);
      await expect(service.assertOwnership(livestreamId, creatorId)).resolves.toEqual(ls);
    });

    it('throws ForbiddenException when the requester is not the owner', async () => {
      livestreamRepo.findOne!.mockResolvedValue(makeLivestream({ creatorId: 'other' }));
      await expect(service.assertOwnership(livestreamId, creatorId)).rejects.toThrow(ForbiddenException);
    });
  });
});
