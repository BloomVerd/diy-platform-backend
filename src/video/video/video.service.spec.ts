import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { VideoService } from './video.service';
import { Video, ProcessingStatus, VideoVisibility } from './video.entity';
import { UploadService } from '../upload/upload.service';
import { ChannelService } from '../channel/channel.service';
import { PlaylistService } from '../playlist/playlist.service';
import { TRANSCODING_QUEUE } from '../processing/transcoding.queue';
import { Channel } from '../channel/channel.entity';

type MockRepo<T extends import('typeorm').ObjectLiteral> = Partial<Record<keyof import('typeorm').Repository<T>, jest.Mock>>;

const mockRepo = <T extends import('typeorm').ObjectLiteral>(): MockRepo<T> => ({
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
  count: jest.fn(),
  manager: { query: jest.fn() } as any,
});

describe('VideoService', () => {
  let service: VideoService;
  let videoRepo: MockRepo<Video>;
  let transcodingQueue: { add: jest.Mock };
  let uploadService: jest.Mocked<UploadService>;
  let channelService: jest.Mocked<ChannelService>;
  let playlistService: jest.Mocked<PlaylistService>;

  const creatorId = 'creator-1';
  const videoId = 'v-1';
  const channelId = 'ch-1';

  const makeVideo = (overrides: Partial<Video> = {}): Video =>
    ({
      id: videoId,
      creatorId,
      channelId,
      title: 'Test Video',
      processingStatus: ProcessingStatus.DRAFT,
      visibility: VideoVisibility.DRAFT,
      tags: [],
      ...overrides,
    }) as Video;

  beforeEach(async () => {
    transcodingQueue = { add: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VideoService,
        { provide: getRepositoryToken(Video), useValue: mockRepo<Video>() },
        { provide: getQueueToken(TRANSCODING_QUEUE), useValue: transcodingQueue },
        {
          provide: UploadService,
          useValue: {
            validateMimeType: jest.fn(),
            buildRawObjectKey: jest.fn(),
            createPresignedUploadUrl: jest.fn(),
            objectExists: jest.fn(),
            buildUploadSession: jest.fn(),
          },
        },
        {
          provide: ChannelService,
          useValue: { assertOwnership: jest.fn() },
        },
        {
          provide: PlaylistService,
          useValue: { addVideoToPlaylist: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<VideoService>(VideoService);
    videoRepo = module.get(getRepositoryToken(Video));
    uploadService = module.get(UploadService);
    channelService = module.get(ChannelService);
    playlistService = module.get(PlaylistService);
  });

  afterEach(() => jest.clearAllMocks());

  // ---------------------------------------------------------------------------
  // createVideoDraft
  // ---------------------------------------------------------------------------

  describe('createVideoDraft', () => {
    const input = { channelId, title: 'My Video', tags: [] };

    it('creates a video draft with DRAFT processing status', async () => {
      channelService.assertOwnership.mockResolvedValue({ id: channelId } as Channel);
      const video = makeVideo();
      videoRepo.create!.mockReturnValue(video);
      videoRepo.save!.mockResolvedValue(video);

      const result = await service.createVideoDraft(creatorId, input);

      expect(channelService.assertOwnership).toHaveBeenCalledWith(channelId, creatorId);
      expect(result.processingStatus).toBe(ProcessingStatus.DRAFT);
    });

    it('adds the video to the playlist when playlistId is supplied', async () => {
      channelService.assertOwnership.mockResolvedValue({ id: channelId } as Channel);
      const video = makeVideo();
      videoRepo.create!.mockReturnValue(video);
      videoRepo.save!.mockResolvedValue(video);
      playlistService.addVideoToPlaylist.mockResolvedValue({} as any);

      await service.createVideoDraft(creatorId, { ...input, playlistId: 'pl-1' });

      expect(playlistService.addVideoToPlaylist).toHaveBeenCalledWith(
        creatorId,
        { playlistId: 'pl-1', videoId },
      );
    });

    it('does not call addVideoToPlaylist when no playlistId is given', async () => {
      channelService.assertOwnership.mockResolvedValue({ id: channelId } as Channel);
      const video = makeVideo();
      videoRepo.create!.mockReturnValue(video);
      videoRepo.save!.mockResolvedValue(video);

      await service.createVideoDraft(creatorId, input);

      expect(playlistService.addVideoToPlaylist).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the creator does not own the channel', async () => {
      channelService.assertOwnership.mockRejectedValue(new ForbiddenException());

      await expect(service.createVideoDraft(creatorId, input)).rejects.toThrow(ForbiddenException);
    });
  });

  // ---------------------------------------------------------------------------
  // createUploadSession
  // ---------------------------------------------------------------------------

  describe('createUploadSession', () => {
    const sessionInput = { videoId, fileName: 'clip.mp4', mimeType: 'video/mp4', sizeBytes: 1024 * 1024 };

    it('creates a presigned upload session for a DRAFT video', async () => {
      videoRepo.findOne!.mockResolvedValue(makeVideo());
      videoRepo.count!.mockResolvedValue(0);
      uploadService.validateMimeType.mockReturnValue(undefined);
      uploadService.buildRawObjectKey.mockReturnValue(`raw/${creatorId}/${videoId}/clip.mp4`);
      uploadService.createPresignedUploadUrl.mockResolvedValue({
        uploadUrl: 'https://s3.example.com/presigned',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      });
      uploadService.buildUploadSession.mockReturnValue({
        videoId,
        uploadUrl: 'https://s3.example.com/presigned',
        objectKey: `raw/${creatorId}/${videoId}/clip.mp4`,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        fields: [],
      });
      videoRepo.update!.mockResolvedValue(undefined);

      const result = await service.createUploadSession(creatorId, sessionInput);

      expect(result.videoId).toBe(videoId);
      expect(videoRepo.update).toHaveBeenCalledWith(videoId, {
        processingStatus: ProcessingStatus.UPLOADING,
      });
    });

    it('creates a presigned upload session for a FAILED video (retry)', async () => {
      videoRepo.findOne!.mockResolvedValue(makeVideo({ processingStatus: ProcessingStatus.FAILED }));
      videoRepo.count!.mockResolvedValue(0);
      uploadService.validateMimeType.mockReturnValue(undefined);
      uploadService.buildRawObjectKey.mockReturnValue(`raw/${creatorId}/${videoId}/clip.mp4`);
      uploadService.createPresignedUploadUrl.mockResolvedValue({
        uploadUrl: 'https://s3.example.com/presigned',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      });
      uploadService.buildUploadSession.mockReturnValue({
        videoId,
        uploadUrl: 'https://s3.example.com/presigned',
        objectKey: `raw/${creatorId}/${videoId}/clip.mp4`,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        fields: [],
      });
      videoRepo.update!.mockResolvedValue(undefined);

      await expect(service.createUploadSession(creatorId, sessionInput)).resolves.toBeDefined();
    });

    it('throws BadRequestException when the video is not in DRAFT or FAILED status', async () => {
      videoRepo.findOne!.mockResolvedValue(
        makeVideo({ processingStatus: ProcessingStatus.PROCESSING }),
      );

      await expect(service.createUploadSession(creatorId, sessionInput)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when the creator has 20 active upload sessions', async () => {
      videoRepo.findOne!.mockResolvedValue(makeVideo());
      videoRepo.count!.mockResolvedValue(20);

      await expect(service.createUploadSession(creatorId, sessionInput)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws ForbiddenException when the creator does not own the video', async () => {
      videoRepo.findOne!.mockResolvedValue(makeVideo({ creatorId: 'other' }));

      await expect(service.createUploadSession(creatorId, sessionInput)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // finalizeUpload
  // ---------------------------------------------------------------------------

  describe('finalizeUpload', () => {
    const objectKey = `raw/${creatorId}/${videoId}/clip.mp4`;
    const finalizeInput = { videoId, objectKey };

    it('marks the video as UPLOADED and enqueues a transcoding job', async () => {
      videoRepo.findOne!
        .mockResolvedValueOnce(makeVideo({ processingStatus: ProcessingStatus.UPLOADING })) // assertOwnership
        .mockResolvedValueOnce(makeVideo({ processingStatus: ProcessingStatus.UPLOADED })); // final return
      uploadService.objectExists.mockResolvedValue(true);
      videoRepo.update!.mockResolvedValue(undefined);

      const result = await service.finalizeUpload(creatorId, finalizeInput);

      expect(videoRepo.update).toHaveBeenCalledWith(videoId, {
        processingStatus: ProcessingStatus.UPLOADED,
      });
      expect(transcodingQueue.add).toHaveBeenCalledWith(
        'transcode',
        expect.objectContaining({ videoId, objectKey, creatorId }),
        expect.any(Object),
      );
      expect(result.processingStatus).toBe(ProcessingStatus.UPLOADED);
    });

    it('throws ForbiddenException when the objectKey does not match the expected prefix', async () => {
      videoRepo.findOne!.mockResolvedValue(makeVideo({ processingStatus: ProcessingStatus.UPLOADING }));

      await expect(
        service.finalizeUpload(creatorId, {
          videoId,
          objectKey: `raw/other-creator/${videoId}/clip.mp4`,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when the S3 object does not exist', async () => {
      videoRepo.findOne!.mockResolvedValue(makeVideo({ processingStatus: ProcessingStatus.UPLOADING }));
      uploadService.objectExists.mockResolvedValue(false);

      await expect(service.finalizeUpload(creatorId, finalizeInput)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws ForbiddenException when the creator does not own the video', async () => {
      videoRepo.findOne!.mockResolvedValue(makeVideo({ creatorId: 'other' }));

      await expect(service.finalizeUpload(creatorId, finalizeInput)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // requestTranscode
  // ---------------------------------------------------------------------------

  describe('requestTranscode', () => {
    it('re-enqueues a transcoding job for a READY video', async () => {
      videoRepo.findOne!
        .mockResolvedValueOnce(makeVideo({ processingStatus: ProcessingStatus.READY }))
        .mockResolvedValueOnce(makeVideo({ processingStatus: ProcessingStatus.UPLOADED }));
      (videoRepo as any).manager = {
        query: jest.fn().mockResolvedValue([{ storage_key: `raw/${creatorId}/${videoId}/clip.mp4` }]),
      };
      videoRepo.update!.mockResolvedValue(undefined);

      await service.requestTranscode(creatorId, videoId);

      expect(transcodingQueue.add).toHaveBeenCalledWith(
        'transcode',
        expect.objectContaining({ videoId }),
        expect.any(Object),
      );
      expect(videoRepo.update).toHaveBeenCalledWith(videoId, {
        processingStatus: ProcessingStatus.UPLOADED,
      });
    });

    it('throws BadRequestException for a video not in READY or FAILED status', async () => {
      videoRepo.findOne!.mockResolvedValue(makeVideo({ processingStatus: ProcessingStatus.PROCESSING }));

      await expect(service.requestTranscode(creatorId, videoId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when no raw asset is found', async () => {
      videoRepo.findOne!.mockResolvedValue(makeVideo({ processingStatus: ProcessingStatus.READY }));
      (videoRepo as any).manager = {
        query: jest.fn().mockResolvedValue([]),
      };

      await expect(service.requestTranscode(creatorId, videoId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException when the video does not exist', async () => {
      videoRepo.findOne!.mockResolvedValue(null);

      await expect(service.requestTranscode(creatorId, 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // findById
  // ---------------------------------------------------------------------------

  describe('findById', () => {
    it('returns the video when found', async () => {
      const video = makeVideo();
      videoRepo.findOne!.mockResolvedValue(video);

      await expect(service.findById(videoId)).resolves.toEqual(video);
    });

    it('throws NotFoundException when not found', async () => {
      videoRepo.findOne!.mockResolvedValue(null);

      await expect(service.findById('missing')).rejects.toThrow(NotFoundException);
    });
  });
});
