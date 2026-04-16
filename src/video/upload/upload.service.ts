import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { UploadSession } from '../video/dto/upload-session.type';

const ALLOWED_MIME_TYPES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-msvideo',
  'video/x-matroska',
]);

const PRESIGNED_URL_TTL_SECONDS = 60 * 60; // 60 minutes

@Injectable()
export class UploadService {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(private readonly configService: ConfigService) {
    this.s3 = new S3Client({
      region: this.configService.getOrThrow<string>('AWS_REGION'),
      credentials: {
        accessKeyId: this.configService.getOrThrow<string>('AWS_ACCESS_KEY_ID'),
        secretAccessKey: this.configService.getOrThrow<string>(
          'AWS_SECRET_ACCESS_KEY',
        ),
      },
    });
    this.bucket = this.configService.getOrThrow<string>('AWS_S3_BUCKET');
  }

  validateMimeType(mimeType: string): void {
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new BadRequestException(
        `Unsupported mime type "${mimeType}". Allowed: ${[...ALLOWED_MIME_TYPES].join(', ')}`,
      );
    }
  }

  buildRawObjectKey(creatorId: string, videoId: string, fileName: string): string {
    const sanitized = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `raw/${creatorId}/${videoId}/${sanitized}`;
  }

  async createPresignedUploadUrl(
    objectKey: string,
    mimeType: string,
  ): Promise<{ uploadUrl: string; expiresAt: string }> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      ContentType: mimeType,
    });

    const uploadUrl = await getSignedUrl(this.s3, command, {
      expiresIn: PRESIGNED_URL_TTL_SECONDS,
    });

    const expiresAt = new Date(
      Date.now() + PRESIGNED_URL_TTL_SECONDS * 1000,
    ).toISOString();

    return { uploadUrl, expiresAt };
  }

  async objectExists(objectKey: string): Promise<boolean> {
    try {
      await this.s3.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      );
      return true;
    } catch {
      return false;
    }
  }

  buildUploadSession(
    videoId: string,
    objectKey: string,
    uploadUrl: string,
    expiresAt: string,
  ): UploadSession {
    return {
      videoId,
      uploadUrl,
      objectKey,
      expiresAt,
      fields: [],
    };
  }
}
