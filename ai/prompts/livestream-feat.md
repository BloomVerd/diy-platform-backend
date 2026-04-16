# Livestream Feature — NestJS Backend Implementation Prompt

## Context

This feature extends the **Video Module** (`src/video/`) with live-streaming capabilities. The VOD (pre-recorded video) pipeline already exists. This prompt covers only the **livestream sub-domain**: scheduling, going live, ending a stream, recording processing, and live product promotion.

The livestream entities live alongside the existing video entities inside the video module boundary. **Do not create a separate module.**

---

## Technology Stack (additions to the base Video Module)

| Layer | Technology |
|---|---|
| Ingest | RTMP server (e.g. nginx-rtmp, AWS MediaLive, or equivalent) |
| Live delivery | HLS from CDN — same CloudFront distribution, `/live/{streamKey}/` path prefix |
| Background jobs | BullMQ `recording-processing` queue → feeds into existing `video-transcoding` queue |
| Stream key | `crypto.randomBytes(16).toString('hex')` — one unique key per scheduled stream |

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
  status            VARCHAR(20)  — SCHEDULED | LIVE | ENDED | CANCELLED
  streamKey         VARCHAR UNIQUE NOT NULL  — used in RTMP path
  ingestUrl         TEXT NOT NULL  — full RTMP URL given to OBS / streaming software
  playbackUrl       TEXT  — HLS master manifest URL; set when status → LIVE
  scheduledStartAt  TIMESTAMPTZ
  startedAt         TIMESTAMPTZ
  endedAt           TIMESTAMPTZ
  viewerCount       INT DEFAULT 0
  peakViewerCount   INT DEFAULT 0
  recordingEnabled  BOOLEAN DEFAULT true
  recordingVideoId  UUID  — populated by RecordingProcessor after transcoding
  createdAt         TIMESTAMPTZ
  updatedAt         TIMESTAMPTZ
```

---

### LivestreamProduct

Soft-reference product links for live product promotion. Maximum **30 links** per stream.

```
livestream_products
  id            UUID PK
  livestreamId  UUID (→ livestreams.id, CASCADE DELETE)
  productId     UUID  (soft ref — no FK to Shop module)
  displayOrder  INT DEFAULT 0
  note          TEXT
  isPinned      BOOLEAN DEFAULT false  — at most 1 pinned product per stream at any time
  createdAt     TIMESTAMPTZ
```

---

### LivestreamStatistics

Aggregated metrics updated asynchronously — never in the hot request path.

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

## File Structure

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
    recording.queue.ts          — RECORDING_QUEUE constant + RecordingJobPayload
    recording.processor.ts      — BullMQ processor: creates Video + enqueues transcoding
```

---

## GraphQL Endpoints

All mutations require `JwtAuthGuard`. Creator mutations also require `@Roles(UserRole.CREATOR)`.

### Lifecycle Mutations

| Operation | Auth | Allowed when status is |
|---|---|---|
| `scheduleLivestream(input)` | CREATOR | — (creates new) |
| `startLivestream(livestreamId)` | CREATOR (owner) | SCHEDULED |
| `endLivestream(livestreamId)` | CREATOR (owner) | LIVE |
| `cancelLivestream(livestreamId)` | CREATOR (owner) | SCHEDULED |
| `updateLivestream(input)` | CREATOR (owner) | SCHEDULED |

#### `scheduleLivestream`

```graphql
mutation ScheduleLivestream(input: ScheduleLivestreamInput!): Livestream

input ScheduleLivestreamInput {
  channelId:        ID!
  title:            String!
  description:      String
  category:         String
  thumbnailUrl:     String
  scheduledStartAt: String   # ISO 8601
  recordingEnabled: Boolean  # default true
}
```

**Business rules:**
- Assert channel ownership.
- Generate `streamKey = crypto.randomBytes(16).toString('hex')`.
- Set `ingestUrl = STREAM_INGEST_BASE_URL + '/' + streamKey`.
- Set `status = SCHEDULED`.
- Initialise a `LivestreamStatistics` row for this stream.
- TODO: emit `livestream.scheduled { livestreamId, creatorId, channelId, scheduledStartAt }`.

#### `startLivestream`

- Set `status = LIVE`, `startedAt = NOW()`.
- Set `playbackUrl = CDN_BASE_URL + '/live/' + streamKey + '/index.m3u8'`.
- TODO: emit `livestream.started { livestreamId, playbackUrl }`.

#### `endLivestream`

- Set `status = ENDED`, `endedAt = NOW()`.
- If `recordingEnabled`: enqueue BullMQ job to `recording-processing` queue with payload `{ livestreamId, channelId, creatorId, recordingKey: recordings/{creatorId}/{livestreamId}/recording.mp4, title }`.
- TODO: emit `livestream.ended { livestreamId, creatorId, channelId }`.

#### `cancelLivestream`

- Set `status = CANCELLED`.
- TODO: emit `livestream.cancelled { livestreamId, creatorId }`.

#### `updateLivestream`

Only `title`, `description`, `category`, `thumbnailUrl`, `scheduledStartAt`, `recordingEnabled` may be updated. Throws `BadRequestException` if the stream is not `SCHEDULED`.

---

### Product Promotion Mutations

| Operation | Auth | Description |
|---|---|---|
| `linkProductsToLivestream(input)` | CREATOR (owner) | Add/upsert up to 30 product links |
| `unlinkProductFromLivestream(livestreamId, productId)` | CREATOR (owner) | Remove a link |
| `pinProductInLivestream(livestreamId, productId)` | CREATOR (owner) | Highlight one product (LIVE only) |
| `unpinProductInLivestream(livestreamId, productId)` | CREATOR (owner) | Remove highlight |

**Pin rules:**
- Only one product can be pinned at a time — pinning a new one auto-unpins the previous.
- `pinProduct` is only allowed when `status = LIVE`.

---

### Queries

| Operation | Auth | Description |
|---|---|---|
| `livestream(id)` | Public | Get a stream by ID |
| `channelLivestreams(channelId, status?, cursor, limit)` | Public | Paginated list for a channel |
| `livestreamProducts(livestreamId)` | Public | Products linked to a stream |

---

## GraphQL Types (SDL Reference)

```graphql
enum LivestreamStatus { SCHEDULED LIVE ENDED CANCELLED }

type Livestream {
  id:               ID!
  creatorId:        ID!
  channelId:        ID!
  title:            String!
  description:      String
  category:         String
  thumbnailUrl:     String
  status:           LivestreamStatus!
  streamKey:        String!
  ingestUrl:        String!
  playbackUrl:      String
  scheduledStartAt: String
  startedAt:        String
  endedAt:          String
  viewerCount:      Int!
  peakViewerCount:  Int!
  recordingEnabled: Boolean!
  recordingVideoId: ID
  createdAt:        String!
  updatedAt:        String!
}

type LivestreamProduct {
  id:           ID!
  livestreamId: ID!
  productId:    ID!
  displayOrder: Int!
  note:         String
  isPinned:     Boolean!
  createdAt:    String!
}

type LivestreamStatistics {
  livestreamId:          ID!
  totalViews:            Int!
  peakConcurrentViewers: Int!
  totalWatchTimeSec:     Int!
  totalOrders:           Int!
  totalRevenue:          Float!
  chatMessageCount:      Int!
  lastComputedAt:        String
}

type LivestreamConnection {
  items:      [Livestream!]!
  nextCursor: String
  totalCount: Int!
}
```

---

## Recording Pipeline

When a stream ends with `recordingEnabled = true`, the `RecordingProcessor` (BullMQ worker on `recording-processing` queue) does:

1. Creates a `Video` entity with `processingStatus = UPLOADED`, `title = "[Recording] {streamTitle}"`.
2. Creates a `VideoAsset` row (`assetType = RAW`, `storageKey = recordings/{creatorId}/{livestreamId}/recording.mp4`).
3. Updates `livestream.recordingVideoId` with the new video ID.
4. Enqueues the video to the existing `video-transcoding` queue — the VOD pipeline takes over from here.

The recording file at `recordingKey` is assumed to have been written by the RTMP server during the live session.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `STREAM_INGEST_BASE_URL` | **Yes** | RTMP ingest base URL (no trailing slash). E.g. `rtmp://ingest.example.com/live` |
| `CDN_BASE_URL` | **Yes** | Also used for live HLS playback: `{CDN_BASE_URL}/live/{streamKey}/index.m3u8` |

---

## Internal Events

### Emitted

| Event | Payload | Consumed By |
|---|---|---|
| `livestream.scheduled` | `{ livestreamId, creatorId, channelId, scheduledStartAt }` | Notification / feed indexing |
| `livestream.started` | `{ livestreamId, creatorId, channelId, playbackUrl }` | Notification / feed |
| `livestream.ended` | `{ livestreamId, creatorId, channelId }` | Notification / stats |
| `livestream.cancelled` | `{ livestreamId, creatorId }` | Notification |

### Listened

| Event | Source | Action |
|---|---|---|
| `order.fulfilled` | Shop module | Increment `LivestreamStatistics.totalOrders` + `totalRevenue` |
| `watch.progress` | Recommendation module | Increment `totalViews`, `totalWatchTimeSec`, `peakConcurrentViewers` |

---

## Security Checklist

- [ ] `scheduleLivestream` asserts channel ownership before issuing a stream key.
- [ ] All owner mutations call `assertOwnership(livestreamId, creatorId)`.
- [ ] `streamKey` is generated with `crypto.randomBytes(16)` — not guessable.
- [ ] `pinProduct` is rejected unless the stream is `LIVE`.
- [ ] `linkProducts` is rejected for `ENDED` and `CANCELLED` streams.
- [ ] `updateLivestream` is rejected unless the stream is `SCHEDULED`.
- [ ] Product links validate product existence via `ShopService.getProductsByIds()` (TODO).
- [ ] Maximum 30 product links per stream enforced at the service layer.

---

## Acceptance Criteria

1. Creator schedules a stream for channel `FARMING` → receives `streamKey` and `ingestUrl`.
2. Creator points OBS at `ingestUrl` and calls `startLivestream` → `status = LIVE`, `playbackUrl` set.
3. Viewer fetches `livestream(id)` and gets a working HLS `playbackUrl`.
4. Creator calls `linkProductsToLivestream` with 3 products → `livestreamProducts(id)` returns them in `displayOrder`.
5. Creator calls `pinProductInLivestream(p-1)` → `isPinned = true`; calling it again with `p-2` → `p-1` is unpinned.
6. Creator calls `endLivestream` → `status = ENDED`; a `recording-processing` job is enqueued.
7. `RecordingProcessor` creates a `Video` entity and enqueues it to `video-transcoding`.
8. After transcoding, the video is playable and `livestream.recordingVideoId` is populated.
9. `channelLivestreams(channelId, status: ENDED)` returns the completed stream with correct metadata.
