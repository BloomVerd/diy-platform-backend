# Video Module — NestJS Backend Implementation Prompt

## Project Context

You are building the **Video Module** for a **DIY-focused video streaming platform** called
[Platform Name]. The platform is structured around DIY categories (Farming, IT, Construction,
Cooking, etc.) and operates on the following business model:

- Content creators publish DIY video playlists organised into channels by category.
- Viewers watch videos and can order the **tools/materials** demonstrated — delivered to their
  door. The platform earns revenue through these product sales.
- **Creators are paid a commission** when purchases are made from products linked to their
  content.
- The platform also offers **DIY services** (booking expert creators for jobs), **workshops**
  (physical/virtual training events run by top creators), and a **labour marketplace** model
  that creates employment.

This module is one of four bounded contexts in a NestJS modular monolith. The other modules
are: Auth/User/Admin, Shop/Product/Order/Payment, and Recommendation/Feed. Your module
must expose clean service interfaces for those modules to consume.

---

## Technology Stack

| Layer | Technology |
|---|---|
| Framework | NestJS (modular monolith, code-first GraphQL) |
| API | GraphQL via `@nestjs/graphql` + Apollo Server |
| ORM | TypeORM (PostgreSQL) |
| Object Storage | AWS S3 (raw uploads, thumbnails, manifests, segments) |
| Background Jobs | BullMQ + Redis (transcoding queue, thumbnail jobs) |
| Cache | Redis (processing status, hot playlist cache) |
| CDN | CloudFront or equivalent (manifest + segment delivery) |
| File Upload | AWS S3 Presigned URLs (direct client-to-S3 upload) |
| Auth | JWT guards + RBAC decorators provided by the Auth module |
| Video Processing | AWS Lambda or a worker service (FFmpeg-based transcoding) |
| Adaptive Streaming | HLS (`.m3u8` master manifest + `.ts` segments per variant) |

---

## Module Boundaries

This module owns the following domain objects and their persistence:

**PostgreSQL tables**
- `channels`
- `playlists`
- `playlist_sections`
- `playlist_items`
- `videos`
- `video_assets` (raw, thumbnail, manifest, segment metadata)
- `video_variants` (360p, 720p, 1080p renditions)
- `playlist_product_links`
- `playlist_statistics` (aggregated view/engagement counters)

**Redis keys (owned)**
- Video processing status cache (`video:processing:{videoId}`)
- Playlist hot cache (`playlist:hot:{playlistId}`)
- Upload session temp state (`upload:session:{sessionId}`)

**S3 prefixes (owned)**
- `raw/{creatorId}/{videoId}/` — original uploaded file
- `thumbnails/{videoId}/` — generated thumbnail images
- `manifests/{videoId}/` — HLS master and variant manifests
- `segments/{videoId}/{variant}/` — HLS `.ts` segment files

**Do NOT** directly access Shop, Payment, or User tables. Consume those modules through their
exported NestJS services or internal event contracts.

---

## Domain Model

### Channel

A **channel** is a creator's top-level publishing identity within a DIY category. One creator
may have one channel (MVP) or multiple channels per category (future phase).

```
Channel
  id              UUID PK
  creatorId       UUID FK → users.id
  name            VARCHAR(120) NOT NULL
  slug            VARCHAR(120) UNIQUE NOT NULL
  description     TEXT
  category        ENUM (see Category enum below)
  coverImageUrl   TEXT
  status          ENUM: ACTIVE | SUSPENDED | ARCHIVED
  subscriberCount INT DEFAULT 0
  createdAt       TIMESTAMP
  updatedAt       TIMESTAMP
```

**Category enum** (extensible — store as VARCHAR, validate at application layer):
`FARMING | IT | CONSTRUCTION | COOKING | AUTOMOTIVE | CRAFTS | PLUMBING |
ELECTRICAL | GARDENING | TEXTILE | OTHER`

---

### Playlist

A **playlist** is an ordered, publishable collection of videos within a channel. Playlists are
the primary content unit on the platform — this is what viewers discover and what products are
linked to.

```
Playlist
  id              UUID PK
  channelId       UUID FK → channels.id
  creatorId       UUID FK → users.id
  title           VARCHAR(200) NOT NULL
  description     TEXT
  category        VARCHAR(80)
  coverImageUrl   TEXT
  visibility      ENUM: DRAFT | PRIVATE | PUBLISHED
  totalDurationSec INT DEFAULT 0   -- recomputed on video add/remove
  videoCount      INT DEFAULT 0    -- recomputed on video add/remove
  publishedAt     TIMESTAMP NULL
  createdAt       TIMESTAMP
  updatedAt       TIMESTAMP
```

---

### PlaylistSection

Sections are optional groupings **within a single playlist** for long-form content (e.g. a
Farming playlist might have sections: "Soil Preparation", "Planting", "Harvesting").

```
PlaylistSection
  id              UUID PK
  playlistId      UUID FK → playlists.id
  title           VARCHAR(150) NOT NULL
  description     TEXT
  position        INT NOT NULL   -- sort order within the playlist
  createdAt       TIMESTAMP
```

---

### PlaylistItem

Ordered linking of a video into a playlist, with optional section assignment.

```
PlaylistItem
  id              UUID PK
  playlistId      UUID FK → playlists.id
  videoId         UUID FK → videos.id
  sectionId       UUID FK → playlist_sections.id NULL
  position        INT NOT NULL
  note            TEXT          -- creator contextual note shown to viewer
  createdAt       TIMESTAMP
```

---

### Video

The core content unit. A video belongs to a creator and may be linked into one or more
playlists.

```
Video
  id                UUID PK
  creatorId         UUID FK → users.id
  channelId         UUID FK → channels.id
  title             VARCHAR(200) NOT NULL
  description       TEXT
  tags              TEXT[]
  category          VARCHAR(80)
  visibility        ENUM: DRAFT | PRIVATE | PUBLISHED
  processingStatus  ENUM: DRAFT | UPLOADING | UPLOADED | PROCESSING | READY | FAILED | PUBLISHED
  durationSec       INT NULL
  thumbnailUrl      TEXT NULL
  playbackManifestUrl TEXT NULL   -- CloudFront URL to HLS master manifest
  viewCount         INT DEFAULT 0
  publishedAt       TIMESTAMP NULL
  createdAt         TIMESTAMP
  updatedAt         TIMESTAMP
```

---

### VideoAsset

Tracks every S3 object associated with a video.

```
VideoAsset
  id          UUID PK
  videoId     UUID FK → videos.id
  assetType   ENUM: RAW | THUMBNAIL | MANIFEST | SEGMENT
  storageKey  TEXT NOT NULL     -- S3 object key
  mimeType    VARCHAR(80)
  sizeBytes   BIGINT
  createdAt   TIMESTAMP
```

---

### VideoVariant

Metadata for each transcoded playback rendition.

```
VideoVariant
  id            UUID PK
  videoId       UUID FK → videos.id
  resolution    ENUM: 360P | 720P | 1080P
  bitrate       INT           -- kbps
  codec         VARCHAR(20)   -- h264, h265
  manifestPath  TEXT          -- S3 key or CDN path to variant manifest
  createdAt     TIMESTAMP
```

---

### PlaylistProductLink

Links a shop product to a playlist so viewers see the tools used.

```
PlaylistProductLink
  id            UUID PK
  playlistId    UUID FK → playlists.id
  productId     UUID           -- FK into Shop module's products table (soft reference)
  displayOrder  INT DEFAULT 0
  note          TEXT           -- e.g. "Used in Section 2: Planting"
  createdAt     TIMESTAMP
```

> **Note:** Do not add a hard FK constraint to the products table since it lives in the Shop
> module boundary. Validate product existence via `ShopService.getProductById()` before
> inserting.

---

### PlaylistStatistics

Aggregated metrics per playlist, updated asynchronously by the Recommendation/Feed module
and watch-event consumers.

```
PlaylistStatistics
  playlistId        UUID PK FK → playlists.id
  totalViews        BIGINT DEFAULT 0
  totalWatchTimeSec BIGINT DEFAULT 0
  totalOrders       INT DEFAULT 0       -- updated by Order module event
  totalRevenue      DECIMAL(12,2) DEFAULT 0  -- updated by Payment module event
  lastComputedAt    TIMESTAMP
```

---

## GraphQL Endpoints

Implement all operations below as code-first NestJS resolvers using `@nestjs/graphql`.
Follow the shared GraphQL conventions established in the project:
- Cursor-based pagination on all list queries (`cursor`, `limit`)
- Standard error shape: `{ message, code, field? }`
- Use `@UseGuards(JwtAuthGuard)` and `@Roles(...)` decorators from the Auth module
- Long-running async operations return the entity with its current `processingStatus`
  rather than blocking

---

### 1. `CreateChannel`

**Type:** Mutation  
**Auth:** `CREATOR` role required  
**Purpose:** A creator registers a new channel under a DIY category. This is the first step
before creating playlists or uploading videos.

**Input:**
```graphql
input CreateChannelInput {
  name:         String!
  description:  String
  category:     DIYCategory!
  coverImageUrl: String
}
```

**Response:** `Channel`

**Business rules:**
- `slug` must be auto-generated from `name` and made unique (append short UUID suffix on
  collision).
- MVP: one active channel per creator per category. Return a validation error if the creator
  already has an active channel in that category.
- Set `status = ACTIVE` on creation.
- Emit internal event `channel.created` for analytics consumers.

**Service method signature:**
```typescript
async createChannel(creatorId: string, input: CreateChannelInput): Promise<Channel>
```

---

### 2. `CreatePlaylist`

**Type:** Mutation  
**Auth:** `CREATOR` role required  
**Purpose:** Creates a new playlist draft inside the creator's channel. Playlists start as
`DRAFT` and are not visible to viewers until published.

**Input:**
```graphql
input CreatePlaylistInput {
  channelId:    ID!
  title:        String!
  description:  String
  category:     String
  coverImageUrl: String
}
```

**Response:** `Playlist`

**Business rules:**
- Verify the `channelId` belongs to the authenticated creator.
- `visibility` defaults to `DRAFT`.
- Optionally allow creating initial sections in the same mutation via a nested
  `sections: [CreateSectionInput!]` field (optional, MVP can skip).

---

### 3. `UpdatePlaylist`

**Type:** Mutation  
**Auth:** `CREATOR` role required (owner only)  
**Purpose:** Update playlist metadata, reorder videos, manage sections, and update product
links. This is the primary editing surface for a playlist after creation.

**Input:**
```graphql
input UpdatePlaylistInput {
  playlistId:   ID!
  title:        String
  description:  String
  category:     String
  coverImageUrl: String
  visibility:   PlaylistVisibility
}
```

**Response:** `Playlist`

**Supporting mutations to implement alongside:**

```graphql
# Add a section to a playlist
mutation AddPlaylistSection(playlistId: ID!, title: String!, description: String, position: Int): PlaylistSection

# Rename or reorder an existing section
mutation UpdatePlaylistSection(sectionId: ID!, title: String, description: String, position: Int): PlaylistSection

# Remove a section (videos in section become unsectioned, not deleted)
mutation RemovePlaylistSection(sectionId: ID!): Boolean

# Add a video to the playlist
mutation AddVideoToPlaylist(input: AddVideoToPlaylistInput!): PlaylistItem

input AddVideoToPlaylistInput {
  playlistId: ID!
  videoId:    ID!
  sectionId:  ID         # optional — assign to a section
  position:   Int        # optional — appends to end if omitted
  note:       String
}

# Reorder all items in a playlist
mutation ReorderPlaylistItems(playlistId: ID!, itemIds: [ID!]!): Playlist

# Remove a video from a playlist
mutation RemoveVideoFromPlaylist(playlistId: ID!, videoId: ID!): Boolean
```

**Business rules for `UpdatePlaylist`:**
- Ownership check required on every mutation in this group.
- When a video is added/removed, recompute `Playlist.videoCount` and
  `Playlist.totalDurationSec` (use a DB trigger or application-level recompute after write).
- `visibility` change to `PUBLISHED` should redirect to `PublishPlaylist` business rules
  (see below) — or enforce those rules inline.

---

### 4. `ListUserPlaylists`

**Type:** Query  
**Auth:** `CREATOR` for their own playlists (all statuses); public for `PUBLISHED` playlists  
**Purpose:** Returns a paginated list of playlists for a given channel or creator. Used in the
creator dashboard and on public channel pages.

**Input:**
```graphql
query ListUserPlaylists(
  creatorId:  ID
  channelId:  ID
  visibility: PlaylistVisibility   # filter — omit for all
  category:   String
  cursor:     String
  limit:      Int = 20
): PlaylistConnection
```

**Response type:**
```graphql
type PlaylistConnection {
  items:      [Playlist!]!
  nextCursor: String
  totalCount: Int
}
```

**Business rules:**
- If `creatorId` matches authenticated user → return all visibility statuses.
- If requesting another user's playlists (or unauthenticated) → return `PUBLISHED` only.
- Support filtering by `channelId` and `category`.
- Default sort: `updatedAt DESC`.

---

### 5. `UploadVideo`

**Type:** Mutation (multi-step flow — implement all three steps)  
**Auth:** `CREATOR` role required  
**Purpose:** Manages the full upload lifecycle from draft creation to S3 ingestion to
processing queue submission.

#### Step 1 — `CreateVideoDraft`

Creates the video metadata record before any file is transferred.

```graphql
mutation CreateVideoDraft(input: CreateVideoDraftInput!): Video

input CreateVideoDraftInput {
  channelId:   ID!
  title:       String!
  description: String
  tags:        [String!]
  category:    String
  playlistId:  ID        # optional — link to playlist immediately
}
```

Sets `processingStatus = DRAFT`.

---

#### Step 2 — `CreateUploadSession`

Generates a presigned S3 upload URL for direct client-to-S3 transfer. Returns all headers
the client needs to PUT the file directly.

```graphql
mutation CreateUploadSession(input: CreateUploadSessionInput!): UploadSession

input CreateUploadSessionInput {
  videoId:   ID!
  fileName:  String!
  mimeType:  String!    # must be video/mp4, video/mov, video/webm, etc.
  sizeBytes: Int!
}

type UploadSession {
  videoId:   ID!
  uploadUrl: String!    # presigned S3 PUT URL
  objectKey: String!    # S3 key client must upload to
  expiresAt: String!    # ISO timestamp — URL validity window
  fields:    [UploadField!]   # additional form fields if using multipart POST
}

type UploadField {
  key:   String!
  value: String!
}
```

**Implementation notes:**
- Generate presigned URL with a TTL of 60 minutes.
- Object key format: `raw/{creatorId}/{videoId}/{sanitizedFileName}`
- Set `processingStatus = UPLOADING` and cache in Redis with a 90-minute TTL.
- Validate `mimeType` against an allowlist before issuing the URL.
- Validate `sizeBytes` does not exceed the configured maximum (e.g. 5 GB).

---

#### Step 3 — `FinalizeUpload`

Called by the client after the S3 PUT completes successfully. Triggers the transcoding
pipeline.

```graphql
mutation FinalizeUpload(input: FinalizeUploadInput!): Video

input FinalizeUploadInput {
  videoId:   ID!
  objectKey: String!
  checksum:  String    # optional MD5/SHA256 for integrity verification
}
```

**Implementation notes:**
- Verify the S3 object exists at `objectKey` using `HeadObject`.
- Verify `objectKey` matches the prefix expected for this `creatorId`/`videoId` (security
  check).
- Set `processingStatus = UPLOADED`.
- Enqueue a BullMQ job to the `video-transcoding` queue with payload:
  `{ videoId, objectKey, variants: ['360p', '720p', '1080p'] }`.
- Update Redis status cache: `video:processing:{videoId} = PROCESSING`.
- Return the updated `Video` record.

**Transcoding worker (implement as a BullMQ processor):**
- Invokes Lambda or runs FFmpeg locally.
- On success: write `VideoVariant` records, write `VideoAsset` records, update
  `video.processingStatus = READY`, update `video.thumbnailUrl`,
  `video.playbackManifestUrl`, `video.durationSec`. Emit `video.processing.complete`
  internal event.
- On failure: set `processingStatus = FAILED`. Emit `video.processing.failed`.
- Support retry via `requestTranscode(videoId)` mutation (admin/creator can trigger
  reprocessing).

---

### 6. `PublishPlaylist`

**Type:** Mutation  
**Auth:** `CREATOR` role required (owner only)  
**Purpose:** Publishes a playlist so it becomes publicly visible on the platform. Performs
pre-flight validation before flipping visibility.

**Input:**
```graphql
mutation PublishPlaylist(playlistId: ID!): Playlist
```

**Response:** `Playlist` with `visibility = PUBLISHED`

**Business rules (pre-flight checks):**
1. Playlist must have at least **1 video** in `PUBLISHED` status.
2. Playlist `title` must not be empty.
3. Creator's channel must be `ACTIVE`.
4. Creator account must be in good standing (call `UserService.isCreatorEligible(creatorId)`).
5. If any of the above fail, return a structured `UserInputError` with a clear message and
   `code` field.

**On success:**
- Set `visibility = PUBLISHED`, `publishedAt = now()`.
- Invalidate Redis playlist cache for this playlist.
- Emit internal event `playlist.published` for the Recommendation/Feed module to index.
- Trigger a notification to the creator via the Notification service:
  `PLAYLIST_PUBLISHED`.

---

### 7. `LinkProductsToPlaylist`

**Type:** Mutation  
**Auth:** `CREATOR` role required (playlist owner only)  
**Purpose:** Attaches one or more shop products to a playlist so viewers can browse and order
the tools/materials featured in the DIY content. This is the core monetisation linkage.

**Input:**
```graphql
mutation LinkProductsToPlaylist(input: LinkProductsToPlaylistInput!): Playlist

input LinkProductsToPlaylistInput {
  playlistId: ID!
  links:      [ProductLinkInput!]!
}

input ProductLinkInput {
  productId:    ID!
  displayOrder: Int
  note:         String   # e.g. "Used in step 3 — Soil Preparation"
}
```

**Response:** `Playlist` with `linkedProducts` field populated

**Supporting operations:**

```graphql
# Remove a product link from a playlist
mutation UnlinkProductFromPlaylist(playlistId: ID!, productId: ID!): Boolean

# Reorder product links in a playlist
mutation ReorderPlaylistProducts(playlistId: ID!, productIds: [ID!]!): Playlist

# Query products linked to a playlist (used by viewer-facing UI)
query ListPlaylistProducts(playlistId: ID!): [PlaylistProduct!]!

type PlaylistProduct {
  productId:    ID!
  displayOrder: Int!
  note:         String
  # Resolved by calling ShopService — do not store product fields in this module
  product:      Product   # resolved via DataLoader → ShopService
}
```

**Business rules:**
- Call `ShopService.getProductsByIds(productIds)` to verify all products exist and belong
  to the same creator as the playlist. Return a `ForbiddenError` if any product belongs to
  a different creator.
- Maximum **50 product links** per playlist (enforce at service layer).
- Upsert behaviour: if a `productId` already exists on the playlist, update `displayOrder`
  and `note` rather than inserting a duplicate.
- Emit internal event `playlist.products.updated` for the Shop module to react to.

---

## GraphQL Type Definitions (SDL Reference)

```graphql
enum DIYCategory {
  FARMING
  IT
  CONSTRUCTION
  COOKING
  AUTOMOTIVE
  CRAFTS
  PLUMBING
  ELECTRICAL
  GARDENING
  TEXTILE
  OTHER
}

enum ChannelStatus {
  ACTIVE
  SUSPENDED
  ARCHIVED
}

enum PlaylistVisibility {
  DRAFT
  PRIVATE
  PUBLISHED
}

enum VideoVisibility {
  DRAFT
  PRIVATE
  PUBLISHED
}

enum ProcessingStatus {
  DRAFT
  UPLOADING
  UPLOADED
  PROCESSING
  READY
  FAILED
  PUBLISHED
}

type Channel {
  id:              ID!
  creatorId:       ID!
  name:            String!
  slug:            String!
  description:     String
  category:        DIYCategory!
  coverImageUrl:   String
  status:          ChannelStatus!
  subscriberCount: Int!
  playlists:       [Playlist!]
  createdAt:       String!
}

type Playlist {
  id:               ID!
  channelId:        ID!
  creatorId:        ID!
  title:            String!
  description:      String
  category:         String
  coverImageUrl:    String
  visibility:       PlaylistVisibility!
  totalDurationSec: Int!
  videoCount:       Int!
  sections:         [PlaylistSection!]!
  items:            [PlaylistItem!]!
  linkedProducts:   [PlaylistProduct!]!
  statistics:       PlaylistStatistics
  publishedAt:      String
  createdAt:        String!
  updatedAt:        String!
}

type PlaylistSection {
  id:          ID!
  playlistId:  ID!
  title:       String!
  description: String
  position:    Int!
  items:       [PlaylistItem!]!
}

type PlaylistItem {
  id:         ID!
  playlistId: ID!
  video:      Video!
  section:    PlaylistSection
  position:   Int!
  note:       String
}

type Video {
  id:                 ID!
  creatorId:          ID!
  channelId:          ID!
  title:              String!
  description:        String
  tags:               [String!]!
  category:           String
  visibility:         VideoVisibility!
  processingStatus:   ProcessingStatus!
  durationSec:        Int
  thumbnailUrl:       String
  playbackManifestUrl: String
  viewCount:          Int!
  variants:           [VideoVariant!]!
  publishedAt:        String
  createdAt:          String!
  updatedAt:          String!
}

type VideoVariant {
  id:           ID!
  resolution:   String!
  bitrate:      Int!
  codec:        String!
  manifestPath: String!
}

type PlaylistProduct {
  productId:    ID!
  displayOrder: Int!
  note:         String
}

type PlaylistStatistics {
  playlistId:        ID!
  totalViews:        Int!
  totalWatchTimeSec: Int!
  totalOrders:       Int!
  totalRevenue:      Float!
  lastComputedAt:    String
}

type PlaylistConnection {
  items:      [Playlist!]!
  nextCursor: String
  totalCount: Int!
}
```

---

## Module Architecture

### File Structure

```
src/
  video/
    video.module.ts
    channel/
      channel.resolver.ts
      channel.service.ts
      channel.entity.ts
      dto/
        create-channel.input.ts
    playlist/
      playlist.resolver.ts
      playlist.service.ts
      playlist.entity.ts
      playlist-item.entity.ts
      playlist-section.entity.ts
      playlist-statistics.entity.ts
      dto/
        create-playlist.input.ts
        update-playlist.input.ts
        add-video-to-playlist.input.ts
        link-products.input.ts
    video/
      video.resolver.ts
      video.service.ts
      video.entity.ts
      video-asset.entity.ts
      video-variant.entity.ts
      dto/
        create-video-draft.input.ts
        create-upload-session.input.ts
        finalize-upload.input.ts
    upload/
      upload.service.ts         # S3 presigned URL logic
    processing/
      transcoding.processor.ts  # BullMQ job processor
      transcoding.queue.ts      # Queue registration
    loaders/
      playlist-products.loader.ts  # DataLoader for product resolution
    events/
      video.events.ts
    interfaces/
      shop-service.interface.ts   # Interface for Shop module dependency
```

---

### Internal Events

The Video Module must emit the following internal events (use NestJS `EventEmitter2` or an
internal event bus):

| Event | Payload | Consumed By |
|---|---|---|
| `channel.created` | `{ channelId, creatorId, category }` | Analytics |
| `playlist.published` | `{ playlistId, creatorId, channelId, category }` | Recommendation/Feed module |
| `playlist.products.updated` | `{ playlistId, productIds }` | Shop module |
| `video.processing.complete` | `{ videoId, manifestUrl, durationSec }` | Notification service |
| `video.processing.failed` | `{ videoId, reason }` | Notification service, Admin |

The Video Module must also **listen** for the following events from other modules:

| Event | Action |
|---|---|
| `order.fulfilled` (Shop module) | Increment `PlaylistStatistics.totalOrders` and `totalRevenue` for playlists linked to ordered products |
| `watch.progress` (Recommendation module) | Increment `Video.viewCount` and `PlaylistStatistics.totalViews` |

---

## Playlist Statistics

`PlaylistStatistics` is updated **asynchronously** — never in the hot request path.

Implement a BullMQ job `update-playlist-stats` that:
1. Accepts `{ playlistId }` as payload.
2. Aggregates watch events from the Recommendation module's Cassandra tables (via a service
   call, not direct DB access).
3. Aggregates order/revenue data from the Shop module.
4. Writes the result to `playlist_statistics`.

This job should be triggered by the events listed above.

---

## Security Checklist

- [ ] All mutations check resource ownership before writing (creator owns channel, playlist,
      video).
- [ ] Presigned URLs are scoped to a path prefix that encodes `creatorId` — a creator cannot
      upload to another creator's path.
- [ ] `FinalizeUpload` verifies the S3 `objectKey` matches the expected prefix.
- [ ] Product links validate that products belong to the same creator as the playlist.
- [ ] `PublishPlaylist` validates creator eligibility before flipping visibility.
- [ ] Rate-limit `CreateUploadSession` per creator (e.g. max 20 active upload sessions at
      once).
- [ ] Admin role can call `requestTranscode` and `moderateVideo` (block/unpublish) on any
      video.

---

## Open Questions to Resolve Before Implementation

1. **Multi-playlist videos:** Can one video appear in more than one playlist? If yes,
   `PlaylistItem` already supports this — confirm with the product team.
2. **Thumbnail selection:** Should creators be able to select a custom thumbnail from
   generated frames, or auto-select frame 1?
3. **Section requirement:** Are sections mandatory for playlists above a video count threshold,
   or always optional?
4. **Creator commission trigger:** The `playlist.products.updated` event notifies the Shop
   module — confirm the exact commission percentage and settlement schedule with the business
   team.
5. **Playback URL signing:** Will `playbackManifestUrl` be a public CDN URL or a
   time-limited signed URL? Signed URLs add viewer auth complexity.
6. **Video-level product links:** The architecture document shows `attachProductToVideo` as
   a separate operation. MVP scope: implement at playlist level only, or both?

---

## Acceptance Criteria

The following end-to-end flow must work in the Week 3 demo:

1. An approved creator creates a channel with category `FARMING`.
2. Creator creates a playlist draft titled "How to Grow Tomatoes at Home".
3. Creator adds two sections: "Soil Preparation" and "Planting".
4. Creator creates a video draft and receives a presigned upload URL.
5. Client uploads the video file directly to S3 using the presigned URL.
6. Client calls `FinalizeUpload` — transcoding job is queued.
7. Transcoding worker processes the file and sets `processingStatus = READY`.
8. Creator adds the video to the playlist under "Planting" section.
9. Creator links 3 products from their shop (spade, seeds, fertilizer) to the playlist.
10. Creator calls `PublishPlaylist` — playlist becomes publicly visible.
11. `ListUserPlaylists` returns the published playlist with correct `videoCount`,
    `totalDurationSec`, and `linkedProducts`.
12. `ListPlaylistProducts` returns the 3 linked products in `displayOrder`.
