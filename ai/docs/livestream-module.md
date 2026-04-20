# Livestream Module

The livestream sub-domain extends the Video Module with live-streaming capabilities. It lives entirely within `src/video/livestream/` and shares the video module's infrastructure (PostgreSQL, BullMQ, Redis, CloudFront).

For the VOD (pre-recorded video) domain see [video-module.md](./video-module.md).

---

## Folder Structure

```
src/video/
  livestream/
    livestream.entity.ts
    livestream-product.entity.ts
    livestream-statistics.entity.ts
    livestream.service.ts
    livestream.resolver.ts
    livestream.service.spec.ts
    dto/
      schedule-livestream.input.ts
      update-livestream.input.ts
      link-products-to-livestream.input.ts
      livestream-connection.type.ts
  processing/
    recording.queue.ts       — RECORDING_QUEUE + RecordingJobPayload type
    recording.processor.ts   — BullMQ processor: raw recording → Video → transcoding queue
```

---

## Database Tables

| Table | Description |
|---|---|
| `livestreams` | One row per stream session |
| `livestream_products` | Products linked to a stream for live promotion |
| `livestream_statistics` | Aggregated view / order / revenue metrics |

---

## Domain Model

### Livestream

```
livestreams
  id                UUID PK
  creatorId         UUID  (soft ref → users.id)
  channelId         UUID  (→ channels.id)
  title             VARCHAR(200) NOT NULL
  description       TEXT
  category          VARCHAR(80)
  thumbnailUrl      TEXT
  status            VARCHAR(20)   — SCHEDULED | LIVE | ENDED | CANCELLED
  streamKey         VARCHAR UNIQUE  — random 32-char hex; used in RTMP path
  ingestUrl         TEXT           — full RTMP URL given to streaming software
  playbackUrl       TEXT NULL      — HLS manifest URL; set on transition to LIVE
  scheduledStartAt  TIMESTAMPTZ NULL
  startedAt         TIMESTAMPTZ NULL
  endedAt           TIMESTAMPTZ NULL
  viewerCount       INT DEFAULT 0
  peakViewerCount   INT DEFAULT 0
  recordingEnabled  BOOLEAN DEFAULT true
  recordingVideoId  UUID NULL      — linked Video created by RecordingProcessor
  createdAt         TIMESTAMPTZ
  updatedAt         TIMESTAMPTZ
```

**Status transitions:**

```
SCHEDULED ──► LIVE ──► ENDED
    │
    └────────────────► CANCELLED
```

- `SCHEDULED → LIVE` via `startLivestream`
- `LIVE → ENDED` via `endLivestream`
- `SCHEDULED → CANCELLED` via `cancelLivestream`
- No path out of `ENDED` or `CANCELLED`

---

### LivestreamProduct

Soft-reference links to Shop module products. Maximum **30 per stream**.

```
livestream_products
  id            UUID PK
  livestreamId  UUID (→ livestreams.id, CASCADE DELETE)
  productId     UUID  (soft ref — no FK to Shop module)
  displayOrder  INT DEFAULT 0
  note          TEXT NULL
  isPinned      BOOLEAN DEFAULT false  — at most 1 pinned product per stream at a time
  createdAt     TIMESTAMPTZ
```

---

### LivestreamStatistics

Aggregated metrics written **asynchronously only** — never in the hot request path.

```
livestream_statistics
  livestreamId          UUID PK (→ livestreams.id, CASCADE DELETE)
  totalViews            BIGINT DEFAULT 0
  peakConcurrentViewers INT DEFAULT 0
  totalWatchTimeSec     BIGINT DEFAULT 0
  totalOrders           INT DEFAULT 0
  totalRevenue          DECIMAL(12,2) DEFAULT 0
  chatMessageCount      INT DEFAULT 0
  lastComputedAt        TIMESTAMPTZ
```

---

## Infrastructure

| Concern | Technology |
|---|---|
| RTMP ingest | External RTMP server (nginx-rtmp / AWS MediaLive) — configured via `STREAM_INGEST_BASE_URL` |
| Live HLS delivery | CloudFront — `/live/{streamKey}/index.m3u8` served from the same CDN as VOD |
| Recording → VOD | `recording-processing` BullMQ queue → feeds into existing `video-transcoding` queue |
| Stream key | `crypto.randomBytes(16).toString('hex')` — 32-char hex, unique per stream |

---

## GraphQL API

### Lifecycle Mutations

| Operation | Auth | Allowed `status` |
|---|---|---|
| `scheduleLivestream(input)` | `CREATOR` | — |
| `startLivestream(livestreamId)` | `CREATOR` (owner) | `SCHEDULED` |
| `endLivestream(livestreamId)` | `CREATOR` (owner) | `LIVE` |
| `cancelLivestream(livestreamId)` | `CREATOR` (owner) | `SCHEDULED` |
| `updateLivestream(input)` | `CREATOR` (owner) | `SCHEDULED` |

**`scheduleLivestream` input:**
```graphql
input ScheduleLivestreamInput {
  channelId:        ID!
  title:            String!
  description:      String
  category:         String
  thumbnailUrl:     String
  scheduledStartAt: String    # ISO 8601 datetime
  recordingEnabled: Boolean   # default true
}
```

**`updateLivestream` input** — updatable fields (`title`, `description`, `category`, `thumbnailUrl`, `scheduledStartAt`, `recordingEnabled`). Throws if stream is not `SCHEDULED`.

---

### Product Promotion Mutations

| Operation | Auth | Constraint |
|---|---|---|
| `linkProductsToLivestream(input)` | `CREATOR` (owner) | Max 30 total; upsert on duplicate; blocked for ENDED/CANCELLED |
| `unlinkProductFromLivestream(livestreamId, productId)` | `CREATOR` (owner) | — |
| `pinProductInLivestream(livestreamId, productId)` | `CREATOR` (owner) | Only while `LIVE`; auto-unpins previous |
| `unpinProductInLivestream(livestreamId, productId)` | `CREATOR` (owner) | — |

---

### Queries

| Operation | Auth | Description |
|---|---|---|
| `livestream(id)` | Public | Get a stream by ID |
| `channelLivestreams(channelId, status?, cursor, limit)` | Public | Paginated, cursor on `createdAt DESC` |
| `livestreamProducts(livestreamId)` | Public | Products ordered by `displayOrder ASC` |

---

## Recording Pipeline

When `endLivestream` is called with `recordingEnabled = true`:

```
endLivestream
    │
    └─ recordingQueue.add('process-recording', {
          livestreamId, channelId, creatorId,
          recordingKey: 'recordings/{creatorId}/{livestreamId}/recording.mp4',
          title
       })
              │
              ▼
    RecordingProcessor (RECORDING_QUEUE worker)
         │
         ├─ INSERT INTO videos  (processingStatus = UPLOADED, title = "[Recording] {title}")
         ├─ INSERT INTO video_assets  (assetType = RAW, storageKey = recordingKey)
         ├─ UPDATE livestreams SET recordingVideoId = video.id
         │
         └─ transcodingQueue.add('transcode', { videoId, objectKey, ... })
                    │
                    ▼
            TranscodingProcessor  (existing VOD pipeline)
                    └─ video becomes playable HLS VOD
```

---

## Internal Events

### Emitted

| Event | Payload | Consumed By |
|---|---|---|
| `livestream.scheduled` | `{ livestreamId, creatorId, channelId, scheduledStartAt }` | Notification / feed |
| `livestream.started` | `{ livestreamId, creatorId, channelId, playbackUrl }` | Notification / feed |
| `livestream.ended` | `{ livestreamId, creatorId, channelId }` | Notification / stats |
| `livestream.cancelled` | `{ livestreamId, creatorId }` | Notification |

### Listened

| Event | Source | Action |
|---|---|---|
| `order.fulfilled` | Shop module | Increment `LivestreamStatistics.totalOrders` + `totalRevenue` |
| `watch.progress` | Recommendation module | Increment `totalViews`, `totalWatchTimeSec`, `peakConcurrentViewers` |

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `STREAM_INGEST_BASE_URL` | **Yes** | RTMP ingest base URL (no trailing slash). E.g. `rtmp://ingest.example.com/live` |
| `CDN_BASE_URL` | **Yes** | Shared with VOD. Live HLS: `{CDN_BASE_URL}/live/{streamKey}/index.m3u8` |

---

## Security Checklist

- [ ] `scheduleLivestream` asserts channel ownership before issuing a stream key.
- [ ] All owner mutations call `assertOwnership(livestreamId, creatorId)`.
- [ ] `streamKey` is `crypto.randomBytes(16)` — not guessable or enumerable.
- [ ] `pinProduct` is rejected unless the stream is `LIVE`.
- [ ] `linkProducts` is rejected for `ENDED` and `CANCELLED` streams.
- [ ] `updateLivestream` is rejected unless the stream is `SCHEDULED`.
- [ ] Product ownership validated via `ShopService.getProductsByIds()` before insert (TODO).
- [ ] 30-product-per-stream limit enforced at the service layer.

---

## Acceptance Criteria

1. Creator schedules a stream → receives `streamKey` and `ingestUrl`.
2. Creator starts the stream → `status = LIVE`, `playbackUrl` set.
3. Viewer queries `livestream(id)` and gets a working HLS `playbackUrl`.
4. Creator links 3 products; `livestreamProducts(id)` returns them in order.
5. Creator pins product A → `isPinned = true`; pins product B → A is auto-unpinned.
6. Creator ends the stream → `status = ENDED`; recording job enqueued.
7. `RecordingProcessor` creates a `Video` and enqueues it to `video-transcoding`.
8. After transcoding, `livestream.recordingVideoId` is populated and the video is playable.
9. `channelLivestreams(channelId, ENDED)` returns the completed stream.
