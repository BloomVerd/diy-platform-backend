import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import * as ffmpeg from 'fluent-ffmpeg';
import * as ffmpegStatic from 'ffmpeg-static';
import * as ffprobeInstaller from '@ffprobe-installer/ffprobe';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { TranscodingResult, TranscodingStrategy } from './transcoding.strategy';
import { VideoResolution } from '../video/video-variant.entity';

const RESOLUTION_MAP: Record<
  string,
  { resolution: VideoResolution; bitrate: number; scale: string }
> = {
  '360p': { resolution: VideoResolution.P360, bitrate: 800_000, scale: '640:360' },
  '720p': { resolution: VideoResolution.P720, bitrate: 2_500_000, scale: '1280:720' },
  '1080p': { resolution: VideoResolution.P1080, bitrate: 5_000_000, scale: '1920:1080' },
};

const HLS_SEGMENT_DURATION = 6; // seconds

@Injectable()
export class LocalFfmpegStrategy extends TranscodingStrategy {
  private readonly logger = new Logger(LocalFfmpegStrategy.name);
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(private readonly configService: ConfigService) {
    super();
    ffmpeg.setFfmpegPath(ffmpegStatic as unknown as string);
    ffmpeg.setFfprobePath(ffprobeInstaller.path);

    const endpoint = this.configService.get<string>('R2_ENDPOINT');
    this.s3 = new S3Client({
      region: 'auto',
      endpoint,
      credentials: {
        accessKeyId: this.configService.getOrThrow('AWS_ACCESS_KEY_ID'),
        secretAccessKey: this.configService.getOrThrow('AWS_SECRET_ACCESS_KEY'),
      },
    });
    this.bucket = this.configService.getOrThrow('AWS_S3_BUCKET');
  }

  async transcode(
    videoId: string,
    objectKey: string,
    variantKeys: string[],
  ): Promise<TranscodingResult> {
    const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `transcode-${videoId}-`));

    try {
      const inputPath = path.join(workDir, 'input');
      await this.download(objectKey, inputPath);

      const durationSec = await this.probeDuration(inputPath);
      const thumbnailKey = `thumbnails/${videoId}/thumb_0.jpg`;
      await this.extractThumbnail(inputPath, workDir, videoId, thumbnailKey);

      const variants: TranscodingResult['variants'] = [];
      const masterLines: string[] = ['#EXTM3U', '#EXT-X-VERSION:3'];

      const requestedVariants = variantKeys.filter((v) => RESOLUTION_MAP[v]);

      for (const key of requestedVariants) {
        const { resolution, bitrate, scale } = RESOLUTION_MAP[key];
        const variantDir = path.join(workDir, key);
        await fs.promises.mkdir(variantDir);

        const manifestPath = `manifests/${videoId}/${key}/index.m3u8`;
        await this.transcodeVariant(inputPath, variantDir, scale, bitrate);
        await this.uploadDir(variantDir, `manifests/${videoId}/${key}`);

        masterLines.push(
          `#EXT-X-STREAM-INF:BANDWIDTH=${bitrate},RESOLUTION=${scale.replace(':', 'x')}`,
          `${key}/index.m3u8`,
        );

        variants.push({ resolution, bitrate, codec: 'h264', manifestPath });
      }

      const masterManifestKey = `manifests/${videoId}/master.m3u8`;
      await this.uploadText(masterLines.join('\n'), masterManifestKey, 'application/vnd.apple.mpegurl');

      this.logger.log(`FFmpeg transcoding done for ${videoId} (${durationSec}s)`);
      return { masterManifestKey, thumbnailKey, durationSec, variants };
    } finally {
      await fs.promises.rm(workDir, { recursive: true, force: true });
    }
  }

  // ── S3 helpers ──────────────────────────────────────────────────────────────

  private async download(objectKey: string, destPath: string): Promise<void> {
    this.logger.debug(`Downloading s3://${this.bucket}/${objectKey}`);
    const { Body } = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
    );
    const dest = fs.createWriteStream(destPath);
    await pipeline(Body as Readable, dest);
  }

  private async uploadDir(localDir: string, s3Prefix: string): Promise<void> {
    const files = await fs.promises.readdir(localDir);
    for (const file of files) {
      const mimeType = file.endsWith('.m3u8')
        ? 'application/vnd.apple.mpegurl'
        : 'video/mp2t';
      const body = fs.createReadStream(path.join(localDir, file));
      await new Upload({
        client: this.s3,
        params: { Bucket: this.bucket, Key: `${s3Prefix}/${file}`, Body: body, ContentType: mimeType },
      }).done();
    }
  }

  private async uploadText(content: string, key: string, contentType: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: content,
        ContentType: contentType,
      }),
    );
  }

  private async uploadFile(localPath: string, key: string, contentType: string): Promise<void> {
    const body = fs.createReadStream(localPath);
    await new Upload({
      client: this.s3,
      params: { Bucket: this.bucket, Key: key, Body: body, ContentType: contentType },
    }).done();
  }

  // ── FFmpeg helpers ──────────────────────────────────────────────────────────

  private probeDuration(inputPath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(inputPath, (err, metadata) => {
        if (err) return reject(err);
        resolve(Math.round(metadata.format.duration ?? 0));
      });
    });
  }

  private extractThumbnail(
    inputPath: string,
    workDir: string,
    videoId: string,
    thumbnailKey: string,
  ): Promise<void> {
    const thumbPath = path.join(workDir, 'thumb_0.jpg');
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .screenshots({ timestamps: ['5%'], filename: 'thumb_0.jpg', folder: workDir, size: '1280x720' })
        .on('end', (_stdout: string | null, _stderr: string | null) => {
          this.uploadFile(thumbPath, thumbnailKey, 'image/jpeg').then(resolve).catch(reject);
        })
        .on('error', reject);
    });
  }

  private transcodeVariant(
    inputPath: string,
    outputDir: string,
    scale: string,
    bitrate: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .videoCodec('libx264')
        .audioCodec('aac')
        .videoBitrate(`${Math.round(bitrate / 1000)}k`)
        .outputOptions([
          `-vf scale=${scale}`,
          '-preset fast',
          '-crf 22',
          '-hls_time ' + HLS_SEGMENT_DURATION,
          '-hls_playlist_type vod',
          '-hls_segment_filename ' + path.join(outputDir, 'segment_%03d.ts'),
          '-f hls',
        ])
        .output(path.join(outputDir, 'index.m3u8'))
        .on('end', () => resolve())
        .on('error', reject)
        .run();
    });
  }
}
