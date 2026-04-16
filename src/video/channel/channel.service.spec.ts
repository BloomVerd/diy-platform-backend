import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ObjectLiteral, Repository } from 'typeorm';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ChannelService } from './channel.service';
import { Channel, ChannelStatus, DIYCategory } from './channel.entity';

type MockRepo<T extends ObjectLiteral> = Partial<Record<keyof Repository<T>, jest.Mock>>;

const mockRepo = <T extends ObjectLiteral>(): MockRepo<T> => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  count: jest.fn(),
});

describe('ChannelService', () => {
  let service: ChannelService;
  let repo: MockRepo<Channel>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChannelService,
        { provide: getRepositoryToken(Channel), useValue: mockRepo<Channel>() },
      ],
    }).compile();

    service = module.get<ChannelService>(ChannelService);
    repo = module.get<MockRepo<Channel>>(getRepositoryToken(Channel));
  });

  afterEach(() => jest.clearAllMocks());

  // ---------------------------------------------------------------------------
  // createChannel
  // ---------------------------------------------------------------------------

  describe('createChannel', () => {
    const creatorId = 'creator-1';
    const input = { name: 'My Farm Channel', category: DIYCategory.FARMING };

    it('creates and returns a new channel with a unique slug', async () => {
      repo.findOne!.mockResolvedValue(null); // no existing active channel, no slug collision
      const channel = { id: 'ch-1', ...input, creatorId, slug: 'my-farm-channel', status: ChannelStatus.ACTIVE };
      repo.create!.mockReturnValue(channel);
      repo.save!.mockResolvedValue(channel);

      const result = await service.createChannel(creatorId, input);

      expect(result).toEqual(channel);
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ creatorId, name: input.name, status: ChannelStatus.ACTIVE }),
      );
    });

    it('throws BadRequestException when creator already has an active channel in the same category', async () => {
      repo.findOne!.mockResolvedValueOnce({ id: 'existing' }); // active channel exists

      await expect(service.createChannel(creatorId, input)).rejects.toThrow(BadRequestException);
    });

    it('appends a random suffix when the base slug already exists', async () => {
      // First findOne: no active channel; second findOne: slug collision
      repo.findOne!
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ slug: 'my-farm-channel' });

      const channel = { id: 'ch-2', slug: 'my-farm-channel-abc123' } as Channel;
      repo.create!.mockReturnValue(channel);
      repo.save!.mockResolvedValue(channel);

      const result = await service.createChannel(creatorId, input);
      expect(result.slug).toMatch(/^my-farm-channel-.+$/);
    });
  });

  // ---------------------------------------------------------------------------
  // findById
  // ---------------------------------------------------------------------------

  describe('findById', () => {
    it('returns the channel when found', async () => {
      const channel = { id: 'ch-1' } as Channel;
      repo.findOne!.mockResolvedValue(channel);

      await expect(service.findById('ch-1')).resolves.toEqual(channel);
    });

    it('throws NotFoundException when not found', async () => {
      repo.findOne!.mockResolvedValue(null);

      await expect(service.findById('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // findByCreator
  // ---------------------------------------------------------------------------

  describe('findByCreator', () => {
    it('returns all channels for a creator', async () => {
      const channels = [{ id: 'ch-1' }, { id: 'ch-2' }] as Channel[];
      repo.find!.mockResolvedValue(channels);

      await expect(service.findByCreator('creator-1')).resolves.toEqual(channels);
      expect(repo.find).toHaveBeenCalledWith({ where: { creatorId: 'creator-1' } });
    });
  });

  // ---------------------------------------------------------------------------
  // assertOwnership
  // ---------------------------------------------------------------------------

  describe('assertOwnership', () => {
    it('returns the channel when the requester is the owner', async () => {
      const channel = { id: 'ch-1', creatorId: 'creator-1' } as Channel;
      repo.findOne!.mockResolvedValue(channel);

      await expect(service.assertOwnership('ch-1', 'creator-1')).resolves.toEqual(channel);
    });

    it('throws ForbiddenException when the requester is not the owner', async () => {
      const channel = { id: 'ch-1', creatorId: 'creator-1' } as Channel;
      repo.findOne!.mockResolvedValue(channel);

      await expect(service.assertOwnership('ch-1', 'other-creator')).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when the channel does not exist', async () => {
      repo.findOne!.mockResolvedValue(null);

      await expect(service.assertOwnership('missing', 'creator-1')).rejects.toThrow(NotFoundException);
    });
  });
});
