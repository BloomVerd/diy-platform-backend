import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job, Queue } from 'bullmq';
import { Video, ProcessingStatus, VideoVisibility } from '../video/video.entity';
import { VideoAsset, AssetType } from '../video/video-asset.entity';
import { Livestream } from '../livestream/livestream.entity';
import { RECORDING_QUEUE, RecordingJobPayload } from './recording.queue';
import {
  TRANSCODING_QUEUE,
  TranscodingJobPayload,
} from './transcoding.queue';

@Processor(RECORDING_QUEUE)
export class RecordingProcessor extends WorkerHost {
  private readonly logger = new Logger(RecordingProcessor.name);

  constructor(
    @InjectRepository(Video)
    private readonly videoRepo: Repository<Video>,
    @InjectRepository(VideoAsset)
    private readonly assetRepo: Repository<VideoAsset>,
    @InjectRepository(Livestream)
    private readonly livestreamRepo: Repository<Livestream>,
    @InjectQueue(TRANSCODING_QUEUE)
    private readonly transcodingQueue: Queue<TranscodingJobPayload>,
  ) {
    super();
  }

  async process(job: Job<RecordingJobPayload>): Promise<void> {
    const { livestreamId, channelId, creatorId, recordingKey, title } = job.data;
    this.logger.log(`Processing recording for livestream ${livestreamId}`);

    // 1. Create a Video entity for the recording
    const video = await this.videoRepo.save(
      this.videoRepo.create({
        creatorId,
        channelId,
        title: `[Recording] ${title}`,
        processingStatus: ProcessingStatus.UPLOADED,
        visibility: VideoVisibility.DRAFT,
        tags: ['recording', 'livestream'],
      }),
    );

    // 2. Track the raw recording as a VideoAsset
    await this.assetRepo.save(
      this.assetRepo.create({
        videoId: video.id,
        assetType: AssetType.RAW,
        storageKey: recordingKey,
        mimeType: 'video/mp4',
      }),
    );

    // 3. Link the recording video back to the Livestream
    await this.livestreamRepo.update(livestreamId, {
      recordingVideoId: video.id,
    });

    // 4. Enqueue transcoding so the recording becomes a playable VOD
    await this.transcodingQueue.add(
      'transcode',
      {
        videoId: video.id,
        objectKey: recordingKey,
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

    this.logger.log(
      `Recording for livestream ${livestreamId} queued for transcoding as video ${video.id}`,
    );
  }
}
