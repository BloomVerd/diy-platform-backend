import { VideoResolution } from '../video/video-variant.entity';

export interface TranscodingResult {
  masterManifestKey: string;
  thumbnailKey: string;
  durationSec: number;
  variants: Array<{
    resolution: VideoResolution;
    bitrate: number;
    codec: string;
    manifestPath: string;
  }>;
}

/**
 * Swap this interface implementation to switch between local FFmpeg and Lambda.
 * LocalFfmpegStrategy → for development / self-hosted
 * LambdaTranscodingStrategy → for production AWS Lambda invocation
 */
export abstract class TranscodingStrategy {
  abstract transcode(
    videoId: string,
    objectKey: string,
    variants: string[],
  ): Promise<TranscodingResult>;
}
