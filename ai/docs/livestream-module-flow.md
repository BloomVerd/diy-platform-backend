# Livestream Module — End-to-End Flow

This document traces every request through the livestream sub-domain in the order a creator would experience them.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Schedule a Livestream](#2-schedule-a-livestream)
3. [Go Live](#3-go-live)
4. [Live Product Promotion](#4-live-product-promotion)
5. [End the Stream](#5-end-the-stream)
6. [Background: Recording Pipeline](#6-background-recording-pipeline)
7. [Cancel a Scheduled Stream](#7-cancel-a-scheduled-stream)
8. [Update Stream Metadata](#8-update-stream-metadata)
9. [Viewing Streams (Public)](#9-viewing-streams-public)
10. [Async Statistics Updates](#10-async-statistics-updates)
11. [Data Flow Diagram](#11-data-flow-diagram)
12. [State Machine](#12-state-machine)

---

## 1. Prerequisites

| Condition | Where enforced |
|---|---|
| `user.role = CREATOR` | `@Roles(UserRole.CREATOR)` on every creator mutation |
| Creator owns the channel | `ChannelService.assertOwnership(channelId, creatorId)` inside `scheduleLivestream` |
| Creator owns the stream | `LivestreamService.assertOwnership(livestreamId, creatorId)` on every owner mutation |

---

## 2. Schedule a Livestream

**Mutation:** `scheduleLivestream(input: ScheduleLivestreamInput): Livestream`

```
Client ──► LivestreamResolver.scheduleLivestream()
              │
              ├─ Guard: GqlAuthGuard  → validates JWT
              ├─ Guard: RolesGuard    → asserts role = CREATOR
              │
              └─► LivestreamService.scheduleLivestream(creatorId, input)
                    │
                    ├─ ChannelService.assertOwnership(channelId, creatorId)
                    │   └─ Throws ForbiddenException if channel belongs to someone else
                    │
                    ├─ streamKey = crypto.randomBytes(16).toString('hex')
                    │   └─ 32-char cryptographically random hex — not guessable
                    │
                    ├─ ingestUrl = STREAM_INGEST_BASE_URL + '/' + streamKey
                    │   └─ e.g. rtmp://ingest.example.com/live/a4f8...
                    │
                    ├─ DB: INSERT INTO livestreams
                    │   └─ status = SCHEDULED
                    │
                    ├─ DB: INSERT INTO livestream_statistics
                    │   └─ All counters = 0
                    │
                    └─ TODO: emit livestream.scheduled { livestreamId, creatorId, channelId, scheduledStartAt }
```

**What the creator gets back:**
- `streamKey` — configure this in OBS / streaming software as the stream key
- `ingestUrl` — the full RTMP URL to paste into OBS

---

## 3. Go Live

**Mutation:** `startLivestream(livestreamId: ID!): Livestream`

```
Client ──► LivestreamResolver.startLivestream()
              │
              └─► LivestreamService.startLivestream(creatorId, livestreamId)
                    │
                    ├─ assertOwnership(livestreamId, creatorId)
                    │
                    ├─ Validate status = SCHEDULED
                    │   └─ Throws BadRequestException if LIVE, ENDED, or CANCELLED
                    │
                    ├─ playbackUrl = CDN_BASE_URL + '/live/' + streamKey + '/index.m3u8'
                    │
                    ├─ DB: UPDATE livestreams SET
                    │       status     = LIVE
                    │       startedAt  = NOW()
                    │       playbackUrl = ...
                    │
                    └─ TODO: emit livestream.started { livestreamId, creatorId, channelId, playbackUrl }
```

After this call, viewers can fetch `playbackUrl` from `livestream(id)` and start watching via any HLS player.

---

## 4. Live Product Promotion

### Linking products

**Mutation:** `linkProductsToLivestream(input: LinkProductsToLivestreamInput): Livestream`

```
LivestreamService.linkProducts(creatorId, input)
  │
  ├─ assertOwnership(livestreamId, creatorId)
  │
  ├─ Reject if status = ENDED or CANCELLED
  │   └─ Throws BadRequestException
  │
  ├─ COUNT existing + new links ≤ 30
  │   └─ Throws BadRequestException if limit exceeded
  │
  ├─ TODO: ShopService.getProductsByIds() — validate product ownership
  │
  ├─ For each ProductLinkInput:
  │   ├─ If already linked → UPDATE displayOrder + note   (upsert)
  │   └─ If new           → INSERT INTO livestream_products
  │
  └─ Returns updated Livestream
```

### Pinning a product (live highlight)

**Mutation:** `pinProductInLivestream(livestreamId, productId): LivestreamProduct`

```
LivestreamService.pinProduct(creatorId, livestreamId, productId)
  │
  ├─ assertOwnership(livestreamId, creatorId)
  │
  ├─ Validate status = LIVE
  │   └─ Throws BadRequestException otherwise
  │
  ├─ Validate product is linked
  │   └─ Throws NotFoundException if not found in livestream_products
  │
  ├─ DB: UPDATE livestream_products SET isPinned = false
  │       WHERE livestreamId = ? AND isPinned = true
  │   └─ Clears any previously pinned product
  │
  ├─ DB: UPDATE link SET isPinned = true
  │
  └─ Returns the updated LivestreamProduct
```

Only one product can be pinned at a time. The live UI uses `isPinned = true` to display a prominent call-to-action.

### Unpinning

**Mutation:** `unpinProductInLivestream(livestreamId, productId): LivestreamProduct`

Sets `isPinned = false` on the specified link. No status restriction.

---

## 5. End the Stream

**Mutation:** `endLivestream(livestreamId: ID!): Livestream`

```
Client ──► LivestreamResolver.endLivestream()
              │
              └─► LivestreamService.endLivestream(creatorId, livestreamId)
                    │
                    ├─ assertOwnership(livestreamId, creatorId)
                    │
                    ├─ Validate status = LIVE
                    │   └─ Throws BadRequestException otherwise
                    │
                    ├─ DB: UPDATE livestreams SET
                    │       status  = ENDED
                    │       endedAt = NOW()
                    │
                    ├─ If recordingEnabled:
                    │   └─ recordingQueue.add('process-recording', {
                    │         livestreamId, channelId, creatorId,
                    │         recordingKey: 'recordings/{creatorId}/{livestreamId}/recording.mp4',
                    │         title
                    │       }, { attempts: 3, backoff: exponential 5s })
                    │
                    └─ TODO: emit livestream.ended { livestreamId, creatorId, channelId }
```

---

## 6. Background: Recording Pipeline

`RecordingProcessor` is a BullMQ worker on the `recording-processing` queue. It bridges the livestream domain and the existing VOD pipeline.

```
BullMQ: recording-processing queue
      │
      ▼
RecordingProcessor.process(job)
      │
      ├─ DB: INSERT INTO videos
      │   └─ title             = "[Recording] {livestream.title}"
      │      processingStatus  = UPLOADED
      │      visibility        = DRAFT
      │      creatorId, channelId
      │
      ├─ DB: INSERT INTO video_assets
      │   └─ assetType  = RAW
      │      storageKey = recordings/{creatorId}/{livestreamId}/recording.mp4
      │      mimeType   = video/mp4
      │
      ├─ DB: UPDATE livestreams SET recordingVideoId = video.id
      │
      └─ transcodingQueue.add('transcode', {
              videoId, objectKey: recordingKey, creatorId,
              variants: ['360p', '720p', '1080p']
            })
              │
              ▼
        TranscodingProcessor  ← existing VOD pipeline
              └─ video becomes a playable HLS VOD
                 processingStatus: UPLOADED → PROCESSING → READY
```

The recording file at `recordingKey` is assumed to have been written to S3 by the RTMP server during the live session. No file copy happens here — the processor just registers the existing object and starts transcoding.

---

## 7. Cancel a Scheduled Stream

**Mutation:** `cancelLivestream(livestreamId: ID!): Livestream`

```
LivestreamService.cancelLivestream(creatorId, livestreamId)
  │
  ├─ assertOwnership(livestreamId, creatorId)
  │
  ├─ Validate status = SCHEDULED
  │   └─ Throws BadRequestException if LIVE, ENDED, or CANCELLED
  │
  ├─ DB: UPDATE livestreams SET status = CANCELLED
  │
  └─ TODO: emit livestream.cancelled { livestreamId, creatorId }
```

`CANCELLED` is terminal — no path to `LIVE` from there.

---

## 8. Update Stream Metadata

**Mutation:** `updateLivestream(input: UpdateLivestreamInput): Livestream`

Only allowed when `status = SCHEDULED`. Updatable fields: `title`, `description`, `category`, `thumbnailUrl`, `scheduledStartAt`, `recordingEnabled`.

```
LivestreamService.updateLivestream(creatorId, input)
  │
  ├─ assertOwnership(input.livestreamId, creatorId)
  │
  ├─ Validate status = SCHEDULED
  │   └─ Throws BadRequestException otherwise
  │
  ├─ Object.assign(livestream, { ...non-null input fields })
  │
  └─ DB: UPDATE livestreams (all changed fields)
```

---

## 9. Viewing Streams (Public)

### Get a specific stream

**Query:** `livestream(id: ID!): Livestream`

```
LivestreamService.findById(id)
  └─ SELECT * FROM livestreams WHERE id = ?
      └─ Throws NotFoundException if not found
```

### List streams for a channel

**Query:** `channelLivestreams(channelId, status?, cursor, limit): LivestreamConnection`

```
LivestreamService.listChannelLivestreams(channelId, status, cursor, limit)
  │
  ├─ Build QueryBuilder:
  │   ├─ WHERE channelId = ?
  │   ├─ AND status = ?  (if provided)
  │   └─ AND createdAt < decoded(cursor)  (if provided)
  │
  ├─ ORDER BY createdAt DESC  TAKE limit + 1
  │
  ├─ hasMore = results.length > limit
  │   └─ nextCursor = base64(page[last].createdAt.toISOString())  if hasMore
  │
  └─ Returns: { items, nextCursor, totalCount }
```

Pagination is cursor-based using `createdAt DESC` — newest streams first.

---

## 10. Async Statistics Updates

`LivestreamStatistics` is **never written in the hot request path**:

| Event | Source | Action |
|---|---|---|
| `order.fulfilled` | Shop module | Increment `totalOrders` + `totalRevenue` for streams linked to the ordered products |
| `watch.progress` | Recommendation module | Increment `totalViews`, `totalWatchTimeSec`, `peakConcurrentViewers` |

These handlers enqueue an `update-livestream-stats` job that aggregates data via service calls to the originating modules — never via direct cross-module DB access.

---

## 11. Data Flow Diagram

```
                         ┌────────────────────────────────────────┐
                         │            VIDEO MODULE                │
                         │                                        │
  Creator ── GraphQL ───►│  LivestreamResolver                   │
                         │    └─ LivestreamService               │
                         │         ├─ livestreams (PG)           │
                         │         ├─ livestream_products (PG)   │
                         │         └─ livestream_statistics (PG) │
                         │                                        │
                         │  ◄── ChannelService (ownership check) │
                         │  ◄── ConfigService (ingest/cdn URLs)  │
                         │                                        │
                         │  endLivestream ──────────────────────►│── recordingQueue
                         │                                        │       │
                         │                                        │       ▼
                         │                                        │  RecordingProcessor
                         │                                        │    ├─ videos (PG)
                         │                                        │    ├─ video_assets (PG)
                         │                                        │    ├─ livestreams (PG)
                         │                                        │    └─►transcodingQueue
                         │                                        │           │
                         │                                        │           ▼
                         │                                        │  TranscodingProcessor
                         │                                        │    (existing VOD pipeline)
                         └────────────────────────────────────────┘
                                      │           ▲
                             events   │           │  events
                                      ▼           │
                         ┌────────────────────────────────────────┐
                         │   Notification / Recommendation / Shop  │
                         └────────────────────────────────────────┘
```

---

## 12. State Machine

```
              scheduleLivestream
                     │
                     ▼
                SCHEDULED ────────────────────► CANCELLED  (terminal)
                     │
              startLivestream
                     │
                     ▼
                   LIVE
                     │
               endLivestream
                     │
                     ▼
                  ENDED  (terminal)
                     │
             (if recordingEnabled)
                     │
                     ▼
            RecordingProcessor
                     │
                     ▼
        Video entity created (UPLOADED)
                     │
                     ▼
        TranscodingProcessor → READY
```

**Notes:**
- Only `SCHEDULED → LIVE` and `LIVE → ENDED` advance the stream forward.
- `CANCELLED` and `ENDED` are terminal — the stream cannot be restarted.
- To re-stream the same content, schedule a new `Livestream` entity.
