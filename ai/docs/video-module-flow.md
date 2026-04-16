# Video Module — End-to-End Flow

This document walks through every user-facing flow in the video module in the order a creator would experience them. Each section shows the request, the code path it travels, and the side-effects it produces.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Channel Creation](#2-channel-creation)
3. [Playlist Creation](#3-playlist-creation)
4. [Adding Sections to a Playlist](#4-adding-sections-to-a-playlist)
5. [Video Upload (3-step flow)](#5-video-upload-3-step-flow)
   - [Step 1 — Create Video Draft](#step-1--create-video-draft)
   - [Step 2 — Create Upload Session](#step-2--create-upload-session)
   - [Step 3 — Finalize Upload](#step-3--finalize-upload)
6. [Background: Transcoding Pipeline](#6-background-transcoding-pipeline)
7. [Adding Videos to a Playlist](#7-adding-videos-to-a-playlist)
8. [Linking Products to a Playlist](#8-linking-products-to-a-playlist)
9. [Publishing a Playlist](#9-publishing-a-playlist)
10. [Viewing Playlists (Public & Creator)](#10-viewing-playlists-public--creator)
11. [Re-transcoding a Failed Video](#11-re-transcoding-a-failed-video)
12. [Async Statistics Updates](#12-async-statistics-updates)
13. [Data Flow Diagram](#13-data-flow-diagram)
14. [State Machines](#14-state-machines)

---

## 1. Prerequisites

Before a creator can publish any content, two conditions must be true:

| Condition | Where enforced |
|---|---|
| User has `role = CREATOR` | `@Roles(UserRole.CREATOR)` guard on every creator mutation |
| Account is active and in good standing | `UserService.isCreatorEligible()` called inside `PublishPlaylist` |

The JWT access token issued at login carries `{ userId, email, role }`. Every authenticated resolver extracts this via the `@CurrentUser()` decorator, which reads `req.user` from the GraphQL context populated by `GqlAuthGuard`.

---

## 2. Channel Creation

**Mutation:** `createChannel(input: CreateChannelInput): Channel`

```
Client ──► ChannelResolver.createChannel()
              │
              ├─ Guard: GqlAuthGuard  → validates JWT
              ├─ Guard: RolesGuard    → asserts role = CREATOR
              │
              └─► ChannelService.createChannel(creatorId, input)
                    │
                    ├─ DB: check no existing ACTIVE channel for this creatorId + category
                    │   └─ Throws BadRequestException if duplicate found
                    │
                    ├─ generateUniqueSlug(name)
                    │   ├─ Slugify name  →  e.g. "John's Farm" → "johns-farm"
                    │   └─ If slug taken → append 6-char random suffix → "johns-farm-a4x9kz"
                    │
                    ├─ DB: INSERT into channels
                    │   └─ status = ACTIVE
                    │
                    └─ TODO: emit channel.created event
```

**DB state after:** One row in `channels` with `status = ACTIVE`.

**Constraint:** One active channel per creator per DIY category (MVP rule).

---

## 3. Playlist Creation

**Mutation:** `createPlaylist(input: CreatePlaylistInput): Playlist`

```
Client ──► PlaylistResolver.createPlaylist()
              │
              └─► PlaylistService.createPlaylist(creatorId, input)
                    │
                    ├─ ChannelService.assertOwnership(channelId, creatorId)
                    │   └─ Throws ForbiddenException if channel belongs to someone else
                    │
                    └─ DB: INSERT into playlists
                        └─ visibility = DRAFT
                           videoCount = 0
                           totalDurationSec = 0
```

**DB state after:** One row in `playlists` with `visibility = DRAFT`. Not visible to any viewer.

---

## 4. Adding Sections to a Playlist

**Mutation:** `addPlaylistSection(input: AddPlaylistSectionInput): PlaylistSection`

Sections are optional groupings within a playlist (e.g. "Soil Preparation", "Planting").

```
Client ──► PlaylistResolver.addPlaylistSection()
              │
              └─► PlaylistService.addSection(creatorId, input)
                    │
                    ├─ assertOwnership(playlistId, creatorId)
                    │
                    ├─ position = input.position ?? COUNT(existing sections)
                    │   └─ Auto-appends if no position given
                    │
                    └─ DB: INSERT into playlist_sections
```

When `removePlaylistSection` is called, the service sets `sectionId = NULL` on all items in that section rather than deleting the videos — they stay in the playlist, just unsectioned.

---

## 5. Video Upload (3-step flow)

Uploads follow a 3-step protocol to keep large files out of the backend process entirely — the client uploads directly to S3.

```
┌─────────┐   Step 1: CreateVideoDraft    ┌──────────┐
│  Client │ ─────────────────────────────► │ Backend  │ ── INSERT video (DRAFT)
│         │ ◄───── { videoId } ───────────  │          │
│         │                                │          │
│         │   Step 2: CreateUploadSession  │          │
│         │ ─────────────────────────────► │          │ ── presign S3 PUT URL
│         │ ◄──── { uploadUrl, objectKey } │          │ ── UPDATE video → UPLOADING
│         │                                │          │
│         │   PUT file ──────────────────► │  AWS S3  │
│         │ ◄── 200 OK ───────────────────  │          │
│         │                                │          │
│         │   Step 3: FinalizeUpload       │          │
│         │ ─────────────────────────────► │          │ ── HeadObject verify
│         │ ◄──── updated Video (UPLOADED) │          │ ── enqueue BullMQ job
└─────────┘                                └──────────┘
```

### Step 1 — Create Video Draft

**Mutation:** `createVideoDraft(input: CreateVideoDraftInput): Video`

```
VideoService.createVideoDraft(creatorId, input)
  │
  ├─ ChannelService.assertOwnership(channelId, creatorId)
  │
  ├─ DB: INSERT into videos
  │   └─ processingStatus = DRAFT
  │      visibility = DRAFT
  │
  └─ If input.playlistId provided:
      └─ PlaylistService.addVideoToPlaylist(...)
          └─ Immediately links the video draft to the playlist
```

### Step 2 — Create Upload Session

**Mutation:** `createUploadSession(input: CreateUploadSessionInput): UploadSession`

```
VideoService.createUploadSession(creatorId, input)
  │
  ├─ assertOwnership(videoId, creatorId)
  │
  ├─ Validate processingStatus is DRAFT or FAILED
  │   └─ Cannot re-open a session for an UPLOADING/PROCESSING/READY video
  │
  ├─ Rate-limit check: COUNT videos WHERE creatorId + status = UPLOADING
  │   └─ Throws if >= 20 active sessions
  │
  ├─ UploadService.validateMimeType(mimeType)
  │   └─ Allowlist: video/mp4, video/quicktime, video/webm, video/x-msvideo, video/x-matroska
  │   └─ Throws BadRequestException on unsupported type
  │
  ├─ UploadService.buildRawObjectKey(creatorId, videoId, fileName)
  │   └─ Key format: raw/{creatorId}/{videoId}/{sanitizedFileName}
  │   └─ Sanitization: replaces non-alphanumeric/dot/dash/underscore with "_"
  │
  ├─ UploadService.createPresignedUploadUrl(objectKey, mimeType)
  │   └─ AWS SDK: PutObjectCommand → getSignedUrl
  │   └─ TTL: 60 minutes
  │
  ├─ DB: UPDATE video SET processingStatus = UPLOADING
  │
  ├─ TODO: cache session in Redis: upload:session:{videoId}  TTL = 90 min
  │
  └─ Returns: { videoId, uploadUrl, objectKey, expiresAt, fields: [] }
```

The client uses `uploadUrl` to `PUT` the file directly to S3 — the backend is not in the data path for the file bytes.

### Step 3 — Finalize Upload

**Mutation:** `finalizeUpload(input: FinalizeUploadInput): Video`

Called by the client after the S3 PUT completes successfully.

```
VideoService.finalizeUpload(creatorId, input)
  │
  ├─ assertOwnership(videoId, creatorId)
  │
  ├─ Security: verify objectKey starts with raw/{creatorId}/{videoId}/
  │   └─ Throws ForbiddenException if prefix mismatch
  │   └─ Prevents a creator from triggering transcoding on another creator's file
  │
  ├─ UploadService.objectExists(objectKey)
  │   └─ AWS SDK: HeadObjectCommand
  │   └─ Throws BadRequestException if object not found in S3
  │
  ├─ DB: UPDATE video SET processingStatus = UPLOADED
  │
  ├─ BullMQ: transcodingQueue.add('transcode', { videoId, objectKey, creatorId, variants: ['360p','720p','1080p'] })
  │   └─ 3 retries with exponential backoff (5s base)
  │
  ├─ TODO: set Redis cache: video:processing:{videoId} = PROCESSING
  │
  └─ Returns: updated Video record
```

---

## 6. Background: Transcoding Pipeline

The `TranscodingProcessor` is a BullMQ worker bound to the `video-transcoding` queue. It runs outside the HTTP request lifecycle.

```
BullMQ Queue: video-transcoding
      │
      ▼
TranscodingProcessor.process(job)
      │
      ├─ DB: UPDATE video SET processingStatus = PROCESSING
      │
      ├─ runTranscoding(videoId, objectKey, variants)
      │   └─ [Production] Invokes AWS Lambda or local FFmpeg subprocess
      │   └─ [Current stub] Returns mock manifest/thumbnail paths
      │
      ├─ On SUCCESS:
      │   ├─ DB: INSERT video_assets  (MANIFEST record, THUMBNAIL record)
      │   ├─ DB: INSERT video_variants (one row per rendition: 360P, 720P, 1080P)
      │   │   Each variant stores: resolution, bitrate (kbps), codec, manifestPath
      │   │
      │   ├─ DB: UPDATE video SET
      │   │       processingStatus = READY
      │   │       playbackManifestUrl = {CDN_BASE_URL}/manifests/{videoId}/master.m3u8
      │   │       thumbnailUrl = {CDN_BASE_URL}/thumbnails/{videoId}/thumb_0.jpg
      │   │       durationSec = <from worker>
      │   │
      │   └─ TODO: emit video.processing.complete event
      │
      └─ On FAILURE:
          ├─ DB: UPDATE video SET processingStatus = FAILED
          ├─ TODO: emit video.processing.failed event
          └─ BullMQ retries up to 3 times before marking job as failed
```

**S3 layout after transcoding:**

```
raw/{creatorId}/{videoId}/original.mp4          ← original upload
thumbnails/{videoId}/thumb_0.jpg                ← generated thumbnail
manifests/{videoId}/master.m3u8                 ← HLS master manifest
manifests/{videoId}/360p/index.m3u8             ← variant manifest
manifests/{videoId}/720p/index.m3u8
manifests/{videoId}/1080p/index.m3u8
segments/{videoId}/360p/seg_0000.ts             ← HLS segments
segments/{videoId}/720p/seg_0000.ts
segments/{videoId}/1080p/seg_0000.ts
```

Viewers play content via CloudFront by fetching `playbackManifestUrl` (the master manifest). The HLS player automatically selects the appropriate variant based on network conditions (adaptive bitrate).

---

## 7. Adding Videos to a Playlist

**Mutation:** `addVideoToPlaylist(input: AddVideoToPlaylistInput): PlaylistItem`

```
PlaylistService.addVideoToPlaylist(creatorId, input)
  │
  ├─ assertOwnership(playlistId, creatorId)
  ├─ DB: verify video exists
  │
  ├─ position = input.position ?? COUNT(existing items in playlist)
  │
  ├─ DB: INSERT into playlist_items
  │   └─ Links videoId + playlistId + optional sectionId
  │
  └─ recomputePlaylistAggregates(playlistId)
      └─ SELECT COUNT(items), SUM(video.durationSec) WHERE playlistId = ...
      └─ UPDATE playlists SET videoCount = N, totalDurationSec = S
```

A single video can appear in multiple playlists — `PlaylistItem` is a many-to-many join with extra columns (position, note, sectionId).

**Reordering items:** `reorderPlaylistItems(playlistId, itemIds: [ID!]!)` — runs a transaction that sets `position = index` for each item ID in the supplied order.

---

## 8. Linking Products to a Playlist

**Mutation:** `linkProductsToPlaylist(input: LinkProductsToPlaylistInput): Playlist`

This is the core monetisation linkage — products shown to viewers who can order them.

```
PlaylistService.linkProducts(creatorId, input)
  │
  ├─ assertOwnership(playlistId, creatorId)
  │
  ├─ COUNT existing links + new links ≤ 50
  │   └─ Throws BadRequestException if limit would be exceeded
  │
  ├─ TODO: ShopService.getProductsByIds(productIds)
  │   └─ Validate each product exists and belongs to this creator
  │
  ├─ For each ProductLinkInput:
  │   ├─ If link already exists → UPDATE displayOrder + note  (upsert)
  │   └─ If new → INSERT into playlist_product_links
  │
  └─ TODO: emit playlist.products.updated event { playlistId, productIds }
```

`PlaylistProductLink` stores only the `productId` (soft reference — no FK constraint to the Shop module's `products` table). Product details are fetched at query time via a DataLoader calling `ShopService`.

---

## 9. Publishing a Playlist

**Mutation:** `publishPlaylist(playlistId: ID!): Playlist`

Publishing is gated behind four pre-flight checks:

```
PlaylistService.publishPlaylist(creatorId, playlistId)
  │
  ├─ assertOwnership(playlistId, creatorId)
  │
  ├─ Pre-flight 1: at least 1 video with visibility = PUBLISHED
  │   └─ JOIN playlist_items → videos WHERE visibility = PUBLISHED
  │   └─ Throws BadRequestException if count = 0
  │
  ├─ Pre-flight 2: playlist title is not empty
  │   └─ Throws BadRequestException if blank
  │
  ├─ Pre-flight 3: channel.status = ACTIVE
  │   └─ ChannelService.findById(channelId) → check status
  │   └─ Throws BadRequestException if SUSPENDED or ARCHIVED
  │
  ├─ Pre-flight 4: creator account is eligible
  │   └─ UserService.isCreatorEligible(creatorId)
  │   └─ Checks user.isActive = true AND user.role = CREATOR
  │   └─ Throws ForbiddenException if not eligible
  │
  ├─ DB: UPDATE playlists SET visibility = PUBLISHED, publishedAt = NOW()
  │
  ├─ TODO: invalidate Redis cache  playlist:hot:{playlistId}
  │
  └─ TODO: emit playlist.published event { playlistId, creatorId, channelId, category }
       └─ Consumed by Recommendation/Feed module to index for discovery
```

---

## 10. Viewing Playlists (Public & Creator)

**Query:** `listUserPlaylists(...): PlaylistConnection`

```
PlaylistService.listUserPlaylists(requesterId, creatorId, channelId, visibility, ...)
  │
  ├─ isOwner = requesterId === creatorId
  │
  ├─ If isOwner:
  │   └─ Returns all visibility statuses (DRAFT, PRIVATE, PUBLISHED)
  │   └─ Can filter by visibility if specified
  │
  └─ If not owner (or unauthenticated):
      └─ Forces filter: visibility = PUBLISHED only
```

Pagination uses an opaque **cursor** (base64-encoded `updatedAt` timestamp):

```
Request:  { cursor: null, limit: 20 }
Response: { items: [...20 playlists], nextCursor: "MjAyNS0wNC0xNlQx...", totalCount: 47 }

Next page:
Request:  { cursor: "MjAyNS0wNC0xNlQx...", limit: 20 }
  └─ WHERE updatedAt < decoded_cursor ORDER BY updatedAt DESC TAKE 20
```

---

## 11. Re-transcoding a Failed Video

**Mutation:** `requestTranscode(videoId: ID!): Video`

Available to the video's creator or any ADMIN.

```
VideoService.requestTranscode(requesterId, videoId)
  │
  ├─ Fetch video — throws NotFoundException if not found
  │
  ├─ Validate processingStatus = READY or FAILED
  │   └─ Throws BadRequestException otherwise
  │
  ├─ Raw query: SELECT storage_key FROM video_assets WHERE videoId + assetType = RAW
  │   └─ Throws BadRequestException if no raw asset found
  │
  ├─ BullMQ: transcodingQueue.add('transcode', { videoId, objectKey, ... })
  │
  └─ DB: UPDATE video SET processingStatus = UPLOADED
```

---

## 12. Async Statistics Updates

`PlaylistStatistics` is **never written in the hot request path**. Two external events drive updates:

| Event source | Event name | Action |
|---|---|---|
| Shop module | `order.fulfilled` | Increment `totalOrders` + `totalRevenue` for playlists linked to the ordered products |
| Recommendation module | `watch.progress` | Increment `Video.viewCount` + `PlaylistStatistics.totalViews` + `totalWatchTimeSec` |

These are handled by a BullMQ job `update-playlist-stats` that aggregates data via service calls to the originating modules — never via direct DB cross-module access.

---

## 13. Data Flow Diagram

```
                              ┌──────────────────────────────────────┐
                              │            VIDEO MODULE               │
                              │                                       │
  Creator ──── GraphQL ──────►│  ChannelResolver                     │
                              │    └─ ChannelService                  │
                              │         └─ channels (PG)             │
                              │                                       │
               GraphQL ──────►│  PlaylistResolver                    │
                              │    └─ PlaylistService                 │
                              │         ├─ playlists (PG)            │
                              │         ├─ playlist_sections (PG)    │
                              │         ├─ playlist_items (PG)       │
                              │         ├─ playlist_product_links(PG)│
                              │         └─ playlist_statistics (PG)  │
                              │                                       │
               GraphQL ──────►│  VideoResolver                       │
                              │    ├─ VideoService                    │
                              │    │    ├─ videos (PG)               │
                              │    │    └─ UploadService             │
                              │    │         └─ AWS S3 ◄─────────────┼── Client PUT
                              │    │                                  │
                              │    └─ BullMQ queue ──────────────────┼──►TranscodingProcessor
                              │                                       │      ├─ video_assets (PG)
                              │                                       │      ├─ video_variants (PG)
                              │                                       │      └─ AWS Lambda / FFmpeg
                              │                                       │
                              │  ◄── UserModule (JWT, RBAC)          │
                              │  ◄── ShopService (product validation) │
                              └──────────────────────────────────────┘
                                          │           ▲
                                 events   │           │  events
                                          ▼           │
                              ┌──────────────────────────────────────┐
                              │  Recommendation / Feed / Shop modules │
                              └──────────────────────────────────────┘
```

---

## 14. State Machines

### Video `processingStatus`

```
                  createVideoDraft
                        │
                        ▼
                      DRAFT
                        │
              createUploadSession
                        │
                        ▼
                    UPLOADING ──── (timeout / abandon) ────► DRAFT
                        │
                    finalizeUpload
                        │
                        ▼
                    UPLOADED
                        │
                   BullMQ job picked up
                        │
                        ▼
                   PROCESSING
                        │
              ┌─────────┴─────────┐
              │                   │
           success              failure
              │                   │
              ▼                   ▼
            READY              FAILED
              │                   │
         (creator sets        requestTranscode
          visibility)              │
              │                   └──► UPLOADED ──► (loop)
              ▼
          PUBLISHED
```

### Playlist `visibility`

```
  createPlaylist
        │
        ▼
      DRAFT ──────────────────────────────────────────┐
        │                                             │
  updatePlaylist                               updatePlaylist
  (visibility=PRIVATE)                         (visibility=DRAFT)
        │                                             │
        ▼                                             │
     PRIVATE ────────────────────────────────────────┘
        │
  publishPlaylist (passes all 4 pre-flight checks)
        │
        ▼
    PUBLISHED
```

### Channel `status`

```
  createChannel
        │
        ▼
      ACTIVE
        │
   (admin action)              (admin action)
        ├──────► SUSPENDED ──────────────────► ACTIVE
        │
        └──────► ARCHIVED   (terminal — no recovery path)
```
