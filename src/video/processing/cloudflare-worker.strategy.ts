import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TranscodingResult, TranscodingStrategy } from './transcoding.strategy';

const TRANSCODE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

@Injectable()
export class CloudflareWorkerStrategy extends TranscodingStrategy {
  private readonly logger = new Logger(CloudflareWorkerStrategy.name);
  private readonly workerUrl: string;
  private readonly workerSecret: string;

  constructor(private readonly configService: ConfigService) {
    super();
    this.workerUrl = this.configService.getOrThrow<string>('CLOUDFLARE_WORKER_URL');
    this.workerSecret = this.configService.getOrThrow<string>('CLOUDFLARE_WORKER_SECRET');
  }

  async transcode(
    videoId: string,
    objectKey: string,
    variants: string[],
  ): Promise<TranscodingResult> {
    this.logger.log(`Dispatching transcode job to Cloudflare Worker for video ${videoId}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TRANSCODE_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(this.workerUrl, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.workerSecret}`,
        },
        body: JSON.stringify({ videoId, objectKey, variants }),
      });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new InternalServerErrorException(
          `Cloudflare Worker timed out after ${TRANSCODE_TIMEOUT_MS / 60_000} minutes for video ${videoId}`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new InternalServerErrorException(
        `Cloudflare Worker returned ${response.status} for video ${videoId}: ${body}`,
      );
    }

    const result: TranscodingResult = await response.json();
    this.logger.log(`Cloudflare Worker completed transcode for video ${videoId}`);
    return result;
  }
}
