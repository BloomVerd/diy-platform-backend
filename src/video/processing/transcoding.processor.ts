import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import { Video, ProcessingStatus } from '../video/video.entity';
import { VideoAsset, AssetType } from '../video/video-asset.entity';
import { VideoVariant, VideoResolution } from '../video/video-variant.entity';
import { TRANSCODING_QUEUE, TranscodingJobPayload } from './transcoding.queue';
import { ConfigService } from '@nestjs/config';

@Processor(TRANSCODING_QUEUE)
export class TranscodingProcessor extends WorkerHost {
  private readonly logger = new Logger(TranscodingProcessor.name);
  private readonly cdnBaseUrl: string;

  constructor(
    @InjectRepository(Video)
    private readonly videoRepo: Repository<Video>,
    @InjectRepository(VideoAsset)
    private readonly assetRepo: Repository<VideoAsset>,
    @InjectRepository(VideoVariant)
    private readonly variantRepo: Repository<VideoVariant>,
    private readonly configService: ConfigService,
  ) {
    super();
    this.cdnBaseUrl = this.configService.get<string>('CDN_BASE_URL', '');
  }

  async process(job: Job<TranscodingJobPayload>): Promise<void> {
    const { videoId, objectKey, variants } = job.data;
    this.logger.log(`Starting transcoding for video ${videoId}`);

    await this.videoRepo.update(videoId, {
      processingStatus: ProcessingStatus.PROCESSING,
    });

    try {
      // In production this would invoke an AWS Lambda or a local FFmpeg worker.
      // The output below represents what the Lambda/worker would return after completion.
      const transcodingResult = await this.runTranscoding(videoId, objectKey, variants);

      await this.assetRepo.save([
        this.assetRepo.create({
          videoId,
          assetType: AssetType.MANIFEST,
          storageKey: transcodingResult.masterManifestKey,
          mimeType: 'application/vnd.apple.mpegurl',
        }),
        this.assetRepo.create({
          videoId,
          assetType: AssetType.THUMBNAIL,
          storageKey: transcodingResult.thumbnailKey,
          mimeType: 'image/jpeg',
        }),
      ]);

      for (const v of transcodingResult.variants) {
        await this.variantRepo.save(
          this.variantRepo.create({
            videoId,
            resolution: v.resolution,
            bitrate: v.bitrate,
            codec: v.codec,
            manifestPath: v.manifestPath,
          }),
        );
      }

      await this.videoRepo.update(videoId, {
        processingStatus: ProcessingStatus.READY,
        playbackManifestUrl: `${this.cdnBaseUrl}/${transcodingResult.masterManifestKey}`,
        thumbnailUrl: `${this.cdnBaseUrl}/${transcodingResult.thumbnailKey}`,
        durationSec: transcodingResult.durationSec,
      });

      this.logger.log(`Transcoding complete for video ${videoId}`);
      // TODO: emit video.processing.complete event
    } catch (err) {
      this.logger.error(`Transcoding failed for video ${videoId}`, err);
      await this.videoRepo.update(videoId, {
        processingStatus: ProcessingStatus.FAILED,
      });
      // TODO: emit video.processing.failed event
      throw err;
    }
  }

  /**
   * Stub for the actual transcoding invocation.
   * Replace with a real Lambda invoke or FFmpeg subprocess call.
   */
  private async runTranscoding(
    videoId: string,
    _objectKey: string,
    variants: string[],
  ): Promise<{
    masterManifestKey: string;
    thumbnailKey: string;
    durationSec: number;
    variants: Array<{
      resolution: VideoResolution;
      bitrate: number;
      codec: string;
      manifestPath: string;
    }>;
  }> {
    const resolutionMap: Record<
      string,
      { resolution: VideoResolution; bitrate: number }
    > = {
      '360p': { resolution: VideoResolution.P360, bitrate: 800 },
      '720p': { resolution: VideoResolution.P720, bitrate: 2500 },
      '1080p': { resolution: VideoResolution.P1080, bitrate: 5000 },
    };

    return {
      masterManifestKey: `manifests/${videoId}/master.m3u8`,
      thumbnailKey: `thumbnails/${videoId}/thumb_0.jpg`,
      durationSec: 0, // populated by the real worker
      variants: variants
        .filter((v) => resolutionMap[v])
        .map((v) => ({
          resolution: resolutionMap[v].resolution,
          bitrate: resolutionMap[v].bitrate,
          codec: 'h264',
          manifestPath: `manifests/${videoId}/${v}/index.m3u8`,
        })),
    };
  }
}
