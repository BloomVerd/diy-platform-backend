# Cloudflare Worker Transcoding — Setup Guide

This document explains how to deploy the Cloudflare Worker that handles video transcoding and how to wire the NestJS backend to use it instead of the local FFmpeg strategy.

---

## Table of Contents

1. [How It Works](#1-how-it-works)
2. [Prerequisites](#2-prerequisites)
3. [Worker Setup](#3-worker-setup)
4. [NestJS Configuration](#4-nestjs-configuration)
5. [Switching the Active Strategy](#5-switching-the-active-strategy)
6. [Request / Response Contract](#6-request--response-contract)
7. [Limitations & Production Notes](#7-limitations--production-notes)
8. [Environment Variables Reference](#8-environment-variables-reference)

---

## 1. How It Works

```
BullMQ: video-transcoding queue
        │
        ▼
TranscodingProcessor.process(job)
        │
        └─► CloudflareWorkerStrategy.transcode(videoId, objectKey, variants)
                    │
                    │  POST https://<worker>.workers.dev
                    │  Authorization: Bearer <secret>
                    │  Body: { videoId, objectKey, variants }
                    │
                    ▼
           Cloudflare Worker (transcoding-worker.js)
                    │
                    ├─ Download raw video from R2 via BUCKET binding
                    ├─ ffmpeg.wasm: probe duration
                    ├─ ffmpeg.wasm: extract thumbnail at 5% of duration
                    ├─ ffmpeg.wasm: transcode each variant to HLS
                    ├─ Upload all artefacts back to R2 via BUCKET binding
                    │
                    └─► Return TranscodingResult JSON
                    │
        ▼
TranscodingProcessor updates DB (video_assets, video_variants, videos)
```

The Worker accesses R2 directly via a **binding** (not the S3 API), which is faster and avoids credentials inside the Worker.

---

## 2. Prerequisites

| Requirement | Notes |
|---|---|
| Cloudflare account | Paid Workers plan recommended — free plan's 10ms CPU limit is too low |
| Wrangler CLI | `npm install -g wrangler` — **must deploy via Wrangler, not the dashboard paste UI** |
| R2 bucket | The same `diy-aws-bucket` used by the NestJS app |
| `@ffmpeg/ffmpeg@0.11.6` | v0.11.x runs the WASM in the main thread; v0.12+ spawns a Worker thread which CF Workers do not support |

> **Why v0.11.6?** `@ffmpeg/ffmpeg` v0.12+ internally calls `new Worker()` to run FFmpeg in a background thread. Cloudflare Workers do not support spawning sub-workers, so v0.12+ fails at runtime with a `Worker is not defined` error. v0.11.6 runs the Emscripten WASM module directly in the main isolate thread — no Worker required.

---

## 3. Worker Setup

### 3.1 Install Wrangler

```bash
npm install -g wrangler
wrangler login
```

### 3.2 Navigate to the worker directory

The Worker lives at `cloudflare-worker/` in the project root.

```bash
cd cloudflare-worker
```

### 3.3 Install Worker dependencies

The `package.json` is already in `cloudflare-worker/`. Run:

```bash
npm install
```

This installs `@ffmpeg/ffmpeg@0.11.6` and `@ffmpeg/core@0.11.0`. Wrangler will bundle these into the Worker on deploy — do not paste the worker code directly into the Cloudflare dashboard, as the dashboard editor does not resolve npm packages.

### 3.4 Review `wrangler.toml`

```toml
name = "diy-transcoding-worker"
main = "transcoding-worker.js"
compatibility_date = "2024-09-01"
compatibility_flags = ["nodejs_compat"]

[usage_model]
  cpu_ms = 300_000   # 5-minute CPU budget

[[r2_buckets]]
  binding = "BUCKET"
  bucket_name = "diy-aws-bucket"
```

Change `bucket_name` if your R2 bucket has a different name.

### 3.5 Set the shared secret

The Worker validates every request against `WORKER_SECRET`. Set it via Wrangler (never put secrets in `wrangler.toml`):

```bash
wrangler secret put WORKER_SECRET
# paste your secret at the prompt
```

Use the **same value** you will set as `CLOUDFLARE_WORKER_SECRET` in your NestJS `.env`.

### 3.6 Deploy

```bash
wrangler deploy
```

Wrangler prints the Worker URL, e.g.:

```
https://diy-transcoding-worker.<your-subdomain>.workers.dev
```

Copy this URL — you will need it in the next step.

### 3.7 (Optional) Host ffmpeg WASM in R2

By default the Worker loads `ffmpeg-core.js` and `ffmpeg-core.wasm` from `unpkg.com` at runtime. For production reliability, upload them to R2 and change the `coreURL` / `wasmURL` in `transcoding-worker.js`:

```bash
# Download the files
curl -o ffmpeg-core.js  https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js
curl -o ffmpeg-core.wasm https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm

# Upload to R2
wrangler r2 object put diy-aws-bucket/ffmpeg/ffmpeg-core.js  --file ffmpeg-core.js
wrangler r2 object put diy-aws-bucket/ffmpeg/ffmpeg-core.wasm --file ffmpeg-core.wasm
```

Then in `transcoding-worker.js` update `loadFfmpeg()`:

```javascript
await ffmpeg.load({
  coreURL: `${env.CDN_BASE_URL}/ffmpeg/ffmpeg-core.js`,
  wasmURL: `${env.CDN_BASE_URL}/ffmpeg/ffmpeg-core.wasm`,
});
```

---

## 4. NestJS Configuration

Add these two variables to your `.env` (or `.env.development.local`):

```env
CLOUDFLARE_WORKER_URL=https://diy-transcoding-worker.<your-subdomain>.workers.dev
CLOUDFLARE_WORKER_SECRET=<same-value-you-used-in-wrangler-secret-put>
```

---

## 5. Switching the Active Strategy

Open `src/video/video.module.ts` and change the provider binding:

```typescript
// Local FFmpeg (current default — for development / self-hosted)
{ provide: TranscodingStrategy, useClass: LocalFfmpegStrategy }

// ↓ replace with ↓

// Cloudflare Worker (for production / serverless)
{ provide: TranscodingStrategy, useClass: CloudflareWorkerStrategy }
```

Import the new strategy at the top of the file:

```typescript
import { CloudflareWorkerStrategy } from './processing/cloudflare-worker.strategy';
```

`TranscodingProcessor` needs no changes — it only depends on the `TranscodingStrategy` abstract class.

---

## 6. Request / Response Contract

### Request (NestJS → Worker)

```
POST <CLOUDFLARE_WORKER_URL>
Authorization: Bearer <CLOUDFLARE_WORKER_SECRET>
Content-Type: application/json

{
  "videoId":   "6c863245-1646-42ca-9776-3a9dbefe62c4",
  "objectKey": "raw/<creatorId>/<videoId>/filename.mp4",
  "variants":  ["360p", "720p", "1080p"]
}
```

### Response (Worker → NestJS)

```json
{
  "masterManifestKey": "manifests/<videoId>/master.m3u8",
  "thumbnailKey":      "thumbnails/<videoId>/thumb_0.jpg",
  "durationSec":       183,
  "variants": [
    { "resolution": "360P", "bitrate": 800000,  "codec": "h264", "manifestPath": "manifests/<videoId>/360p/index.m3u8" },
    { "resolution": "720P", "bitrate": 2500000, "codec": "h264", "manifestPath": "manifests/<videoId>/720p/index.m3u8" },
    { "resolution": "1080P","bitrate": 5000000, "codec": "h264", "manifestPath": "manifests/<videoId>/1080p/index.m3u8" }
  ]
}
```

Error responses return a non-2xx status with `{ "error": "..." }` body. The NestJS strategy throws `InternalServerErrorException` on any non-2xx, causing BullMQ to retry the job.

---

## 7. Limitations & Production Notes

### CPU time

| Plan | CPU limit | Suitable for |
|---|---|---|
| Free | 10 ms | Not suitable |
| Workers Standard (paid) | 30 s | Short clips only (< ~2 min) |
| Workers Unbound / `cpu_ms` override | up to 300,000 ms | Most videos |

The `wrangler.toml` included sets `cpu_ms = 300_000` (5 minutes). Adjust based on the longest video you expect to process.

### Memory

Workers are capped at 128 MB. For large videos (> ~500 MB) the `arrayBuffer()` download may fail. Mitigation: increase memory via `[limits] memory_mb = 512` if your plan supports it, or stream the input using R2's `.body` stream instead of `.arrayBuffer()`.

### ffmpeg.wasm vs native FFmpeg

`ffmpeg.wasm` is slower than native FFmpeg (roughly 3–5× for H.264 encoding). For high-volume workloads, consider:
- Running a dedicated transcoding server with the `LocalFfmpegStrategy`
- Using Cloudflare Media (their managed video product) for transcoding + delivery

### WASM loading latency

The first invocation loads `ffmpeg-core.wasm` (~30 MB) from the CDN. Host the WASM in R2 (see §3.7) to eliminate this cold-start overhead and avoid the external network dependency.

---

## 8. Environment Variables Reference

### NestJS (`.env`)

| Variable | Required | Description |
|---|---|---|
| `CLOUDFLARE_WORKER_URL` | When using `CloudflareWorkerStrategy` | Full URL of the deployed Worker |
| `CLOUDFLARE_WORKER_SECRET` | When using `CloudflareWorkerStrategy` | Shared secret — must match `WORKER_SECRET` in the Worker |

### Cloudflare Worker (set via `wrangler secret put`)

| Secret / Binding | Type | Description |
|---|---|---|
| `WORKER_SECRET` | Secret env var | Shared secret for request authentication |
| `BUCKET` | R2 binding | Direct access to the R2 bucket — no S3 credentials needed |
