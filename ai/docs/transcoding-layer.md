# Transcoding Layer

The transcoding layer converts a raw uploaded video (stored in Cloudflare R2) into an HLS adaptive bitrate stream and a thumbnail. It is designed around a **strategy pattern** so the local FFmpeg worker can be swapped for an AWS Lambda invocation without touching `TranscodingProcessor`.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Strategy Interface](#2-strategy-interface)
3. [Local FFmpeg Strategy](#3-local-ffmpeg-strategy)
4. [Output Layout in R2](#4-output-layout-in-r2)
5. [HLS Master Manifest](#5-hls-master-manifest)
6. [TranscodingProcessor Integration](#6-transcodingprocessor-integration)
7. [Switching to Lambda](#7-switching-to-lambda)
8. [Environment Variables](#8-environment-variables)
9. [Dependencies](#9-dependencies)

---

## 1. Architecture Overview

```
BullMQ: video-transcoding queue
        │
        ▼
TranscodingProcessor.process(job)
        │
        └─► TranscodingStrategy.transcode(videoId, objectKey, variants)
                    │
             ┌──────┴──────┐
             │             │
    LocalFfmpegStrategy   LambdaTranscodingStrategy  ← (future)
             │
             ├─ Download raw file from R2
             ├─ ffprobe  → durationSec
             ├─ ffmpeg   → thumbnail (JPEG)
             ├─ ffmpeg   → HLS segments per variant
             ├─ Upload all artefacts to R2
             └─ Return TranscodingResult
```

`TranscodingProcessor` only knows about `TranscodingStrategy`. The concrete implementation is injected by the NestJS module, making the swap a one-line change in `video.module.ts`.

---

## 2. Strategy Interface

**File:** `src/video/processing/transcoding.strategy.ts`

```typescript
abstract class TranscodingStrategy {
  abstract transcode(
    videoId: string,
    objectKey: string,   // R2 key of the raw upload, e.g. raw/<creatorId>/<videoId>/filename
    variants: string[],  // e.g. ['360p', '720p', '1080p']
  ): Promise<TranscodingResult>;
}
```

`TranscodingResult` shape:

| Field | Type | Description |
|---|---|---|
| `masterManifestKey` | `string` | R2 key of the HLS master playlist |
| `thumbnailKey` | `string` | R2 key of the generated thumbnail |
| `durationSec` | `number` | Video duration in seconds (from ffprobe) |
| `variants` | `Array` | One entry per transcoded resolution |

Each `variants` entry:

| Field | Type | Example |
|---|---|---|
| `resolution` | `VideoResolution` | `P720` |
| `bitrate` | `number` | `2500000` (bps) |
| `codec` | `string` | `'h264'` |
| `manifestPath` | `string` | `manifests/<videoId>/720p/index.m3u8` |

---

## 3. Local FFmpeg Strategy

**File:** `src/video/processing/local-ffmpeg.strategy.ts`

### Variant settings

| Key | Resolution | Target bitrate | FFmpeg scale |
|---|---|---|---|
| `360p` | `640×360` | 800 kbps | `640:360` |
| `720p` | `1280×720` | 2,500 kbps | `1280:720` |
| `1080p` | `1920×1080` | 5,000 kbps | `1920:1080` |

FFmpeg codec settings applied to every variant:

```
-c:v libx264   -preset fast   -crf 22
-c:a aac
-hls_time 6                    # 6-second segments
-hls_playlist_type vod
-f hls
```

### Step-by-step execution

```
transcode(videoId, objectKey, variantKeys)
  │
  ├─ 1. mkdtemp  →  /tmp/transcode-<videoId>-<random>/
  │
  ├─ 2. download(objectKey)
  │       GetObjectCommand → stream to /tmp/.../input
  │
  ├─ 3. ffprobe(input)  →  durationSec
  │
  ├─ 4. ffmpeg screenshots at 5% of duration
  │       → /tmp/.../thumb_0.jpg
  │       → Upload  thumbnails/<videoId>/thumb_0.jpg  (image/jpeg)
  │
  ├─ 5. For each requested variant (360p / 720p / 1080p):
  │       a. mkdir /tmp/.../<variant>/
  │       b. ffmpeg transcode
  │            → /tmp/.../<variant>/index.m3u8
  │            → /tmp/.../<variant>/segment_000.ts, segment_001.ts, …
  │       c. uploadDir → R2 prefix  manifests/<videoId>/<variant>/
  │       d. Append #EXT-X-STREAM-INF line to master manifest buffer
  │
  ├─ 6. uploadText(masterLines)
  │       → R2 key  manifests/<videoId>/master.m3u8
  │
  ├─ 7. Return TranscodingResult
  │
  └─ finally: rm -rf /tmp/transcode-<videoId>-<random>/
```

### Temporary directory lifecycle

A unique directory under `os.tmpdir()` is created at the start and deleted in a `finally` block regardless of success or failure. No temp files persist between jobs.

### R2 upload method by artefact type

| Artefact | Upload method | Reason |
|---|---|---|
| Thumbnail JPEG | `@aws-sdk/lib-storage` `Upload` | Streaming multipart — avoids buffering the whole file |
| HLS `.ts` segments | `@aws-sdk/lib-storage` `Upload` | Same — segments can be large |
| HLS `.m3u8` playlists | `PutObjectCommand` | Plain text, small — single-part is fine |
| Master manifest | `PutObjectCommand` | Same |

---

## 4. Output Layout in R2

After a successful transcode for `videoId = abc123` with variants `['360p', '720p']`:

```
thumbnails/
  abc123/
    thumb_0.jpg

manifests/
  abc123/
    master.m3u8
    360p/
      index.m3u8
      segment_000.ts
      segment_001.ts
      …
    720p/
      index.m3u8
      segment_000.ts
      segment_001.ts
      …
```

The `playbackManifestUrl` stored on the `videos` row is:

```
{CDN_BASE_URL}/manifests/abc123/master.m3u8
```

---

## 5. HLS Master Manifest

The master playlist is assembled in memory and uploaded as plain text. Example for two variants:

```m3u8
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
360p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720
720p/index.m3u8
```

HLS players (hls.js, AVPlayer, ExoPlayer) select the appropriate variant based on available bandwidth.

---

## 6. TranscodingProcessor Integration

**File:** `src/video/processing/transcoding.processor.ts`

After `TranscodingStrategy.transcode()` returns, the processor:

1. Inserts a `video_assets` row for the master manifest (`AssetType.MANIFEST`)
2. Inserts a `video_assets` row for the thumbnail (`AssetType.THUMBNAIL`)
3. Inserts one `video_variants` row per transcoded variant
4. Updates `videos` with:
   - `processingStatus = READY`
   - `playbackManifestUrl = CDN_BASE_URL + '/' + masterManifestKey`
   - `thumbnailUrl = CDN_BASE_URL + '/' + thumbnailKey`
   - `durationSec`

On any error the processor sets `processingStatus = FAILED` and re-throws so BullMQ can retry the job (configured upstream by the caller with `attempts` and `backoff`).

---

## 7. Switching to Lambda

To replace the local FFmpeg worker with an AWS Lambda function:

1. Create `src/video/processing/lambda-transcoding.strategy.ts`:

```typescript
@Injectable()
export class LambdaTranscodingStrategy extends TranscodingStrategy {
  async transcode(videoId, objectKey, variants): Promise<TranscodingResult> {
    // Invoke Lambda synchronously (RequestResponse) or
    // poll SQS / EventBridge for the async result.
    // Return the same TranscodingResult shape.
  }
}
```

2. Change the provider binding in `video.module.ts`:

```typescript
// Before
{ provide: TranscodingStrategy, useClass: LocalFfmpegStrategy }

// After
{ provide: TranscodingStrategy, useClass: LambdaTranscodingStrategy }
```

`TranscodingProcessor` requires no changes.

---

## 8. Environment Variables

| Variable | Required | Description |
|---|---|---|
| `R2_ENDPOINT` | Yes | Cloudflare R2 S3-compatible endpoint (no trailing slash) |
| `AWS_ACCESS_KEY_ID` | Yes | R2 API Access Key ID |
| `AWS_SECRET_ACCESS_KEY` | Yes | R2 API Secret Access Key |
| `AWS_S3_BUCKET` | Yes | R2 bucket name |
| `CDN_BASE_URL` | Yes | Public base URL for playback links (no trailing slash) |

---

## 9. Dependencies

| Package | Purpose |
|---|---|
| `fluent-ffmpeg` | Node.js wrapper around the FFmpeg CLI |
| `ffmpeg-static` | Bundles a pre-built FFmpeg binary — no system install needed |
| `@aws-sdk/client-s3` | S3-compatible R2 download (`GetObjectCommand`) and small uploads |
| `@aws-sdk/lib-storage` | Multipart streaming upload for segments and thumbnail |
