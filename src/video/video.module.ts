import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';

// Channel
import { Channel } from './channel/channel.entity';
import { ChannelService } from './channel/channel.service';
import { ChannelResolver } from './channel/channel.resolver';

// Playlist
import { Playlist } from './playlist/playlist.entity';
import { PlaylistSection } from './playlist/playlist-section.entity';
import { PlaylistItem } from './playlist/playlist-item.entity';
import { PlaylistStatistics } from './playlist/playlist-statistics.entity';
import { PlaylistProductLink } from './playlist/playlist-product-link.entity';
import { PlaylistService } from './playlist/playlist.service';
import { PlaylistResolver } from './playlist/playlist.resolver';

// Video
import { Video } from './video/video.entity';
import { VideoAsset } from './video/video-asset.entity';
import { VideoVariant } from './video/video-variant.entity';
import { VideoService } from './video/video.service';
import { VideoResolver } from './video/video.resolver';

// Upload
import { UploadService } from './upload/upload.service';

// Processing
import { TranscodingProcessor } from './processing/transcoding.processor';
import { TRANSCODING_QUEUE } from './processing/transcoding.queue';
import { RecordingProcessor } from './processing/recording.processor';
import { RECORDING_QUEUE } from './processing/recording.queue';

// Livestream
import { Livestream } from './livestream/livestream.entity';
import { LivestreamProduct } from './livestream/livestream-product.entity';
import { LivestreamStatistics } from './livestream/livestream-statistics.entity';
import { LivestreamService } from './livestream/livestream.service';
import { LivestreamResolver } from './livestream/livestream.resolver';

// User module (for UserService dependency)
import { UserModule } from '../user/user.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      // Channel
      Channel,
      // Playlist
      Playlist,
      PlaylistSection,
      PlaylistItem,
      PlaylistStatistics,
      PlaylistProductLink,
      // Video
      Video,
      VideoAsset,
      VideoVariant,
      // Livestream
      Livestream,
      LivestreamProduct,
      LivestreamStatistics,
    ]),
    BullModule.registerQueue(
      { name: TRANSCODING_QUEUE },
      { name: RECORDING_QUEUE },
    ),
    UserModule,
  ],
  providers: [
    // Channel
    ChannelService,
    ChannelResolver,
    // Playlist
    PlaylistService,
    PlaylistResolver,
    // Video
    VideoService,
    VideoResolver,
    // Upload
    UploadService,
    // Processing
    TranscodingProcessor,
    RecordingProcessor,
    // Livestream
    LivestreamService,
    LivestreamResolver,
  ],
  exports: [ChannelService, PlaylistService, VideoService, LivestreamService],
})
export class VideoModule {}
