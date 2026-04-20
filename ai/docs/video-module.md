# Video Module

The video module handles all content publishing — channels, playlists, videos, uploads, transcoding, and product linkage. Everything lives under `src/video/`.

## Folder Structure

```
src/video/
├── channel/
│   ├── channel.entity.ts
│   ├── channel.resolver.ts
│   ├── channel.service.ts
│   └── dto/
│       └── create-channel.input.ts
├── playlist/
│   ├── playlist.entity.ts
│   ├── playlist-item.entity.ts
│   ├── playlist-section.entity.ts
│   ├── playlist-statistics.entity.ts
│   ├── playlist.resolver.ts
│   ├── playlist.service.ts
│   └── dto/
│       ├── add-video-to-playlist.input.ts
│       ├── create-playlist.input.ts
│       ├── link-products.input.ts
│       └── update-playlist.input.ts
├── video/
│   ├── video.entity.ts
│   ├── video-asset.entity.ts
│   ├── video-variant.entity.ts
│   ├── video.resolver.ts
│   ├── video.service.ts
│   └── dto/
│       ├── create-upload-session.input.ts
│       ├── create-video-draft.input.ts
│       └── finalize-upload.input.ts
├── upload/
│   └── upload.service.ts           — S3 presigned URL logic
├── processing/
│   ├── transcoding.processor.ts    — BullMQ job processor (FFmpeg/Lambda)
│   └── transcoding.queue.ts        — Queue registration
├── loaders/
│   └── playlist-products.loader.ts — DataLoader → ShopService
├── events/
│   └── video.events.ts
├── interfaces/
│   └── shop-service.interface.ts   — Interface for Shop module dependency
└── video.module.ts
```

## Database Tables

| Table | Owned By |
|---|---|
| `channels` | Video module |
| `playlists` | Video module |
| `playlist_sections` | Video module |
| `playlist_items` | Video module |
| `videos` | Video module |
| `video_assets` | Video module |
| `video_variants` | Video module |
| `playlist_product_links` | Video module |
| `playlist_statistics` | Video module |

**Do NOT** add hard FK constraints to tables in other modules (Shop, User). Use soft references and validate via service calls.

## Entities

### Channel

Top-level publishing identity for a creator within a DIY category.

- `slug` is auto-generated from `name`; a short UUID suffix is appended on collision.
- One active channel per creator per category (MVP constraint).
- `status`: `ACTIVE | SUSPENDED | ARCHIVED` — stored as VARCHAR, validated at app layer.
- `category`: `FARMING | IT | CONSTRUCTION | COOKING | AUTOMOTIVE | CRAFTS | PLUMBING | ELECTRICAL | GARDENING | TEXTILE | OTHER`

### Playlist

Primary content unit viewers discover. Belongs to a channel.

- `visibility`: `DRAFT | PRIVATE | PUBLISHED`
- `videoCount` and `totalDurationSec` are recomputed on every video add/remove (application-level, not DB trigger).
- Products are linked via `PlaylistProductLink`, not stored directly.

### PlaylistSection

Optional grouping within a playlist (e.g. "Soil Preparation", "Planting"). Removing a section does not delete its videos — items become unsectioned.

### PlaylistItem

Join table linking a `Video` to a `Playlist` with an ordered `position` and optional section assignment. A single video may appear in more than one playlist.

### Video

Core content unit. `processingStatus` drives the upload lifecycle:

```
DRAFT → UPLOADING → UPLOADED → PROCESSING → READY → PUBLISHED
                                                    ↘ FAILED
```

- `playbackManifestUrl` points to the CloudFront HLS master manifest once transcoding is complete.
- `thumbnailUrl` is set by the transcoding worker.

### VideoAsset

Tracks every S3 object for a video: `RAW | THUMBNAIL | MANIFEST | SEGMENT`.

### VideoVariant

One row per transcoded rendition (`360P | 720P | 1080P`). Each has its own HLS variant manifest path.

### PlaylistProductLink

Soft reference to a product in the Shop module. Maximum 50 links per playlist. Validate product existence via `ShopService.getProductsByIds()` before inserting.

### PlaylistStatistics

Aggregated metrics updated **asynchronously** by a BullMQ job — never written in the hot request path.

## Infrastructure

| Layer | Technology |
|---|---|
| API | GraphQL code-first via `@nestjs/graphql` + Apollo |
| ORM | TypeORM (PostgreSQL) |
| Object Storage | AWS S3 (presigned PUT URLs — direct client-to-S3) |
| Background Jobs | BullMQ + Redis (`video-transcoding`, `update-playlist-stats` queues) |
| Cache | Redis — processing status, hot playlist cache, upload session temp state |
| CDN | CloudFront (HLS manifest + segment delivery) |
| Video Processing | AWS Lambda or worker (FFmpeg) |
| Streaming | HLS — `.m3u8` master manifest + `.ts` segments per variant |

### S3 Prefixes

| Prefix | Content |
|---|---|
| `raw/{creatorId}/{videoId}/` | Original uploaded file |
| `thumbnails/{videoId}/` | Generated thumbnails |
| `manifests/{videoId}/` | HLS master + variant manifests |
| `segments/{videoId}/{variant}/` | HLS `.ts` segment files |

### Redis Keys

| Key | TTL | Purpose |
|---|---|---|
| `video:processing:{videoId}` | Until state change | Processing status cache |
| `playlist:hot:{playlistId}` | Configurable | Hot playlist response cache |
| `upload:session:{sessionId}` | 90 min | Upload session temp state |

## GraphQL Operations

All mutations require `JwtAuthGuard`. All list queries use cursor-based pagination (`cursor`, `limit`).

### Channel

| Operation | Type | Auth |
|---|---|---|
| `CreateChannel` | Mutation | `CREATOR` |

`CreateChannel` emits `channel.created`.

### Playlist

| Operation | Type | Auth |
|---|---|---|
| `CreatePlaylist` | Mutation | `CREATOR` |
| `UpdatePlaylist` | Mutation | `CREATOR` (owner) |
| `AddPlaylistSection` | Mutation | `CREATOR` (owner) |
| `UpdatePlaylistSection` | Mutation | `CREATOR` (owner) |
| `RemovePlaylistSection` | Mutation | `CREATOR` (owner) |
| `AddVideoToPlaylist` | Mutation | `CREATOR` (owner) |
| `ReorderPlaylistItems` | Mutation | `CREATOR` (owner) |
| `RemoveVideoFromPlaylist` | Mutation | `CREATOR` (owner) |
| `PublishPlaylist` | Mutation | `CREATOR` (owner) |
| `LinkProductsToPlaylist` | Mutation | `CREATOR` (owner) |
| `UnlinkProductFromPlaylist` | Mutation | `CREATOR` (owner) |
| `ReorderPlaylistProducts` | Mutation | `CREATOR` (owner) |
| `ListUserPlaylists` | Query | Public (`PUBLISHED` only) / `CREATOR` (all) |
| `ListPlaylistProducts` | Query | Public |

`PublishPlaylist` pre-flight checks:
1. At least 1 video in `PUBLISHED` status.
2. Playlist `title` is non-empty.
3. Creator's channel is `ACTIVE`.
4. `UserService.isCreatorEligible(creatorId)` returns true.

`PublishPlaylist` emits `playlist.published` and invalidates the Redis playlist cache.

### Video Upload (3-step flow)

| Step | Operation | Sets `processingStatus` |
|---|---|---|
| 1 | `CreateVideoDraft` | `DRAFT` |
| 2 | `CreateUploadSession` | `UPLOADING` |
| 3 | `FinalizeUpload` | `UPLOADED` → enqueues transcoding job |

`CreateUploadSession` constraints:
- Presigned URL TTL: 60 minutes.
- Object key: `raw/{creatorId}/{videoId}/{sanitizedFileName}`.
- Allowed MIME types: `video/mp4`, `video/mov`, `video/webm`, etc.
- Max size: 5 GB.
- Rate limit: max 20 active upload sessions per creator.

`FinalizeUpload` security checks:
- `HeadObject` to confirm S3 object exists.
- Verify `objectKey` matches the expected `{creatorId}/{videoId}` prefix.

Transcoding worker (BullMQ processor) on success: writes `VideoVariant` + `VideoAsset` records, sets `processingStatus = READY`, updates `thumbnailUrl`, `playbackManifestUrl`, `durationSec`, emits `video.processing.complete`.

On failure: sets `processingStatus = FAILED`, emits `video.processing.failed`.

## Internal Events

### Emitted

| Event | Payload | Consumed By |
|---|---|---|
| `channel.created` | `{ channelId, creatorId, category }` | Analytics |
| `playlist.published` | `{ playlistId, creatorId, channelId, category }` | Recommendation/Feed |
| `playlist.products.updated` | `{ playlistId, productIds }` | Shop module |
| `video.processing.complete` | `{ videoId, manifestUrl, durationSec }` | Notification service |
| `video.processing.failed` | `{ videoId, reason }` | Notification service, Admin |

### Listened

| Event | Action |
|---|---|
| `order.fulfilled` (Shop) | Increment `PlaylistStatistics.totalOrders` and `totalRevenue` |
| `watch.progress` (Recommendation) | Increment `Video.viewCount` and `PlaylistStatistics.totalViews` |

## Security Checklist

- All mutations verify resource ownership (creator owns the channel / playlist / video).
- Presigned URLs are path-scoped to `creatorId` — a creator cannot upload to another creator's prefix.
- `FinalizeUpload` validates `objectKey` against the expected prefix.
- Product links validate that products belong to the same creator as the playlist.
- `PublishPlaylist` calls `UserService.isCreatorEligible` before changing visibility.
- `CreateUploadSession` is rate-limited to 20 active sessions per creator.
- Admin role can call `requestTranscode` and `moderateVideo` on any video.

## Environment Variables

All variables are validated at startup by `src/config/config.validation.ts` via Joi. The application will refuse to start if any required variable is missing or invalid.

| Variable | Required | Default | Description |
|---|---|---|---|
| `STAGE` | No | `development` | App stage; selects env file (`.env.${STAGE}.local` in dev, `.env` in prod) |
| `NODE_ENV` | No | `development` | Node environment; controls TypeORM `synchronize` flag |
| `DATABASE_URL` | **Yes** | — | PostgreSQL connection URL |
| `REDIS_URL` | **Yes** | — | Redis connection URL (used by BullMQ queues) |
| `JWT_ACCESS_SECRET` | **Yes** | — | Secret for signing access tokens (min 32 chars) |
| `JWT_ACCESS_EXPIRY` | No | `15m` | Access token lifetime |
| `JWT_REFRESH_SECRET` | **Yes** | — | Secret for signing refresh tokens (min 32 chars) |
| `JWT_REFRESH_EXPIRY` | No | `7d` | Refresh token lifetime |
| `AWS_REGION` | **Yes** | — | AWS region where S3 bucket resides |
| `AWS_ACCESS_KEY_ID` | **Yes** | — | AWS credentials |
| `AWS_SECRET_ACCESS_KEY` | **Yes** | — | AWS credentials |
| `AWS_S3_BUCKET` | **Yes** | — | S3 bucket for raw uploads, thumbnails, and manifests |
| `CDN_BASE_URL` | **Yes** | — | CloudFront base URL (no trailing slash) used to build `playbackManifestUrl` and `thumbnailUrl` |

Copy `.env.example` to `.env.development.local` for local development:

```bash
cp .env.example .env.development.local
# Fill in real values before starting the app
```

## Open Questions

1. **Multi-playlist videos** — confirm with product team (entity supports it already).
2. **Thumbnail selection** — custom frame picker vs. auto-select frame 1?
3. **Section requirement** — always optional, or mandatory above a video count threshold?
4. **Creator commission** — confirm percentage and settlement schedule with business team.
5. **Playback URL signing** — public CDN URL or time-limited signed URL per viewer?
6. **Video-level product links** — MVP: playlist level only, or both playlist and video?
