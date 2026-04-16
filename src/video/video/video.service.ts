import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Repository } from 'typeorm';
import { Queue } from 'bullmq';
import { Video, ProcessingStatus, VideoVisibility } from './video.entity';
import { CreateVideoDraftInput } from './dto/create-video-draft.input';
import { CreateUploadSessionInput } from './dto/create-upload-session.input';
import { FinalizeUploadInput } from './dto/finalize-upload.input';
import { UploadSession } from './dto/upload-session.type';
import { UploadService } from '../upload/upload.service';
import { ChannelService } from '../channel/channel.service';
import { PlaylistService } from '../playlist/playlist.service';
import {
  TRANSCODING_QUEUE,
  TranscodingJobPayload,
} from '../processing/transcoding.queue';

const MAX_ACTIVE_UPLOAD_SESSIONS = 20;

@Injectable()
export class VideoService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepo: Repository<Video>,
    @InjectQueue(TRANSCODING_QUEUE)
    private readonly transcodingQueue: Queue<TranscodingJobPayload>,
    private readonly uploadService: UploadService,
    private readonly channelService: ChannelService,
    private readonly playlistService: PlaylistService,
  ) {}

  // ---------------------------------------------------------------------------
  // Step 1 — CreateVideoDraft
  // ---------------------------------------------------------------------------

  async createVideoDraft(
    creatorId: string,
    input: CreateVideoDraftInput,
  ): Promise<Video> {
    await this.channelService.assertOwnership(input.channelId, creatorId);

    const video = this.videoRepo.create({
      creatorId,
      channelId: input.channelId,
      title: input.title,
      description: input.description,
      tags: input.tags ?? [],
      category: input.category,
      processingStatus: ProcessingStatus.DRAFT,
      visibility: VideoVisibility.DRAFT,
    });

    const saved = await this.videoRepo.save(video);

    if (input.playlistId) {
      await this.playlistService.addVideoToPlaylist(creatorId, {
        playlistId: input.playlistId,
        videoId: saved.id,
      });
    }

    return saved;
  }

  // ---------------------------------------------------------------------------
  // Step 2 — CreateUploadSession
  // ---------------------------------------------------------------------------

  async createUploadSession(
    creatorId: string,
    input: CreateUploadSessionInput,
  ): Promise<UploadSession> {
    const video = await this.assertOwnership(input.videoId, creatorId);

    if (
      video.processingStatus !== ProcessingStatus.DRAFT &&
      video.processingStatus !== ProcessingStatus.FAILED
    ) {
      throw new BadRequestException(
        'An upload session can only be created for a video in DRAFT or FAILED status',
      );
    }

    // Rate-limit: count active upload sessions for this creator
    const activeCount = await this.videoRepo.count({
      where: { creatorId, processingStatus: ProcessingStatus.UPLOADING },
    });
    if (activeCount >= MAX_ACTIVE_UPLOAD_SESSIONS) {
      throw new BadRequestException(
        `You can have at most ${MAX_ACTIVE_UPLOAD_SESSIONS} active upload sessions at once`,
      );
    }

    this.uploadService.validateMimeType(input.mimeType);

    const objectKey = this.uploadService.buildRawObjectKey(
      creatorId,
      input.videoId,
      input.fileName,
    );

    const { uploadUrl, expiresAt } =
      await this.uploadService.createPresignedUploadUrl(objectKey, input.mimeType);

    await this.videoRepo.update(input.videoId, {
      processingStatus: ProcessingStatus.UPLOADING,
    });

    // TODO: cache upload session in Redis: upload:session:{videoId} with 90-min TTL

    return this.uploadService.buildUploadSession(
      input.videoId,
      objectKey,
      uploadUrl,
      expiresAt,
    );
  }

  // ---------------------------------------------------------------------------
  // Step 3 — FinalizeUpload
  // ---------------------------------------------------------------------------

  async finalizeUpload(
    creatorId: string,
    input: FinalizeUploadInput,
  ): Promise<Video> {
    const video = await this.assertOwnership(input.videoId, creatorId);

    // Security: verify objectKey matches expected prefix
    const expectedPrefix = `raw/${creatorId}/${input.videoId}/`;
    if (!input.objectKey.startsWith(expectedPrefix)) {
      throw new ForbiddenException('Object key does not match the expected upload path');
    }

    // Verify the file actually exists in S3
    const exists = await this.uploadService.objectExists(input.objectKey);
    if (!exists) {
      throw new BadRequestException(
        `Object ${input.objectKey} was not found in storage. Please upload the file before finalizing.`,
      );
    }

    await this.videoRepo.update(input.videoId, {
      processingStatus: ProcessingStatus.UPLOADED,
    });

    // Enqueue transcoding job
    await this.transcodingQueue.add(
      'transcode',
      {
        videoId: input.videoId,
        objectKey: input.objectKey,
        creatorId,
        variants: ['360p', '720p', '1080p'],
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    // TODO: set Redis cache: video:processing:{videoId} = PROCESSING

    return this.videoRepo.findOne({ where: { id: input.videoId } }) as Promise<Video>;
  }

  // ---------------------------------------------------------------------------
  // Retranscode (admin / creator can trigger reprocessing)
  // ---------------------------------------------------------------------------

  async requestTranscode(requesterId: string, videoId: string): Promise<Video> {
    const video = await this.videoRepo.findOne({ where: { id: videoId } });
    if (!video) throw new NotFoundException(`Video ${videoId} not found`);

    if (
      video.processingStatus !== ProcessingStatus.READY &&
      video.processingStatus !== ProcessingStatus.FAILED
    ) {
      throw new BadRequestException(
        'Only READY or FAILED videos can be re-transcoded',
      );
    }

    const rawAsset = await this.videoRepo.manager.query(
      `SELECT storage_key FROM video_assets WHERE video_id = $1 AND asset_type = 'RAW' LIMIT 1`,
      [videoId],
    ) as Array<{ storage_key: string }>;

    if (!rawAsset.length) {
      throw new BadRequestException('No raw asset found for this video');
    }

    await this.transcodingQueue.add(
      'transcode',
      {
        videoId,
        objectKey: rawAsset[0].storage_key,
        creatorId: video.creatorId,
        variants: ['360p', '720p', '1080p'],
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    await this.videoRepo.update(videoId, {
      processingStatus: ProcessingStatus.UPLOADED,
    });

    return this.videoRepo.findOne({ where: { id: videoId } }) as Promise<Video>;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  async findById(id: string): Promise<Video> {
    const video = await this.videoRepo.findOne({ where: { id } });
    if (!video) throw new NotFoundException(`Video ${id} not found`);
    return video;
  }

  private async assertOwnership(videoId: string, creatorId: string): Promise<Video> {
    const video = await this.findById(videoId);
    if (video.creatorId !== creatorId) {
      throw new ForbiddenException('You do not own this video');
    }
    return video;
  }
}
