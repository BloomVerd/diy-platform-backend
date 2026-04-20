import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { UploadService } from './upload.service';

// ---------------------------------------------------------------------------
// AWS SDK mocks — must be declared before imports are resolved
// ---------------------------------------------------------------------------

const mockGetSignedUrl = jest.fn();
const mockS3Send = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockS3Send })),
  PutObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
  HeadObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => mockGetSignedUrl(...args),
}));

// ---------------------------------------------------------------------------

describe('UploadService', () => {
  let service: UploadService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UploadService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn((key: string) => {
              const config: Record<string, string> = {
                AWS_REGION: 'us-east-1',
                AWS_ACCESS_KEY_ID: 'AKID',
                AWS_SECRET_ACCESS_KEY: 'SECRET',
                AWS_S3_BUCKET: 'test-bucket',
              };
              if (!(key in config)) throw new Error(`Missing config: ${key}`);
              return config[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get<UploadService>(UploadService);
  });

  afterEach(() => jest.clearAllMocks());

  // ---------------------------------------------------------------------------
  // validateMimeType
  // ---------------------------------------------------------------------------

  describe('validateMimeType', () => {
    it.each([
      'video/mp4',
      'video/quicktime',
      'video/webm',
      'video/x-msvideo',
      'video/x-matroska',
    ])('accepts allowed mime type %s', (mimeType) => {
      expect(() => service.validateMimeType(mimeType)).not.toThrow();
    });

    it('throws BadRequestException for an unsupported mime type', () => {
      expect(() => service.validateMimeType('image/png')).toThrow(BadRequestException);
    });

    it('throws BadRequestException for an empty string', () => {
      expect(() => service.validateMimeType('')).toThrow(BadRequestException);
    });
  });

  // ---------------------------------------------------------------------------
  // buildRawObjectKey
  // ---------------------------------------------------------------------------

  describe('buildRawObjectKey', () => {
    it('builds the correct S3 key path', () => {
      const key = service.buildRawObjectKey('creator-1', 'video-1', 'my clip.mp4');
      expect(key).toBe('raw/creator-1/video-1/my_clip.mp4');
    });

    it('sanitizes special characters in the file name', () => {
      const key = service.buildRawObjectKey('c1', 'v1', 'file name (1) #final!.mp4');
      expect(key).toMatch(/^raw\/c1\/v1\//);
      // Colons, spaces, parens, hashes and exclamation marks are replaced with _
      expect(key).not.toMatch(/[ ()#!]/);
    });

    it('preserves dots and hyphens in the file name', () => {
      const key = service.buildRawObjectKey('c1', 'v1', 'my-file.v2.mp4');
      expect(key).toBe('raw/c1/v1/my-file.v2.mp4');
    });
  });

  // ---------------------------------------------------------------------------
  // createPresignedUploadUrl
  // ---------------------------------------------------------------------------

  describe('createPresignedUploadUrl', () => {
    it('returns a presigned URL and an expiresAt timestamp', async () => {
      mockGetSignedUrl.mockResolvedValue('https://s3.example.com/presigned?X-Amz-Signature=abc');

      const result = await service.createPresignedUploadUrl(
        'raw/c1/v1/clip.mp4',
        'video/mp4',
      );

      expect(result.uploadUrl).toContain('presigned');
      expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('propagates errors from the AWS SDK', async () => {
      mockGetSignedUrl.mockRejectedValue(new Error('AWS error'));

      await expect(
        service.createPresignedUploadUrl('raw/c1/v1/clip.mp4', 'video/mp4'),
      ).rejects.toThrow('AWS error');
    });
  });

  // ---------------------------------------------------------------------------
  // objectExists
  // ---------------------------------------------------------------------------

  describe('objectExists', () => {
    it('returns true when HeadObject succeeds', async () => {
      mockS3Send.mockResolvedValue({});

      await expect(service.objectExists('raw/c1/v1/clip.mp4')).resolves.toBe(true);
    });

    it('returns false when HeadObject throws (object not found)', async () => {
      mockS3Send.mockRejectedValue({ name: 'NotFound' });

      await expect(service.objectExists('raw/c1/v1/clip.mp4')).resolves.toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // buildUploadSession
  // ---------------------------------------------------------------------------

  describe('buildUploadSession', () => {
    it('returns a correctly shaped UploadSession object', () => {
      const session = service.buildUploadSession(
        'v-1',
        'raw/c1/v1/clip.mp4',
        'https://s3.example.com/presigned',
        '2099-01-01T00:00:00.000Z',
      );

      expect(session).toEqual({
        videoId: 'v-1',
        objectKey: 'raw/c1/v1/clip.mp4',
        uploadUrl: 'https://s3.example.com/presigned',
        expiresAt: '2099-01-01T00:00:00.000Z',
        fields: [],
      });
    });
  });
});
