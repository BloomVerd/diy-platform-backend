import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Repository } from 'typeorm';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { Livestream, LivestreamStatus } from './livestream.entity';
import { LivestreamProduct } from './livestream-product.entity';
import { LivestreamStatistics } from './livestream-statistics.entity';
import { ScheduleLivestreamInput } from './dto/schedule-livestream.input';
import { UpdateLivestreamInput } from './dto/update-livestream.input';
import { LinkProductsToLivestreamInput } from './dto/link-products-to-livestream.input';
import { LivestreamConnection } from './dto/livestream-connection.type';
import { ChannelService } from '../channel/channel.service';
import { RECORDING_QUEUE, RecordingJobPayload } from '../processing/recording.queue';

const MAX_PRODUCTS_PER_LIVESTREAM = 30;

@Injectable()
export class LivestreamService {
  private readonly ingestBaseUrl: string;
  private readonly cdnBaseUrl: string;

  constructor(
    @InjectRepository(Livestream)
    private readonly livestreamRepo: Repository<Livestream>,
    @InjectRepository(LivestreamProduct)
    private readonly productRepo: Repository<LivestreamProduct>,
    @InjectRepository(LivestreamStatistics)
    private readonly statsRepo: Repository<LivestreamStatistics>,
    @InjectQueue(RECORDING_QUEUE)
    private readonly recordingQueue: Queue<RecordingJobPayload>,
    private readonly channelService: ChannelService,
    private readonly configService: ConfigService,
  ) {
    this.ingestBaseUrl = this.configService.getOrThrow<string>('STREAM_INGEST_BASE_URL');
    this.cdnBaseUrl = this.configService.getOrThrow<string>('CDN_BASE_URL');
  }

  // ---------------------------------------------------------------------------
  // Schedule
  // ---------------------------------------------------------------------------

  async scheduleLivestream(
    creatorId: string,
    input: ScheduleLivestreamInput,
  ): Promise<Livestream> {
    await this.channelService.assertOwnership(input.channelId, creatorId);

    const streamKey = crypto.randomBytes(16).toString('hex');
    const ingestUrl = `${this.ingestBaseUrl}/${streamKey}`;

    const livestream = this.livestreamRepo.create({
      creatorId,
      channelId: input.channelId,
      title: input.title,
      description: input.description,
      category: input.category,
      thumbnailUrl: input.thumbnailUrl,
      scheduledStartAt: input.scheduledStartAt,
      recordingEnabled: input.recordingEnabled ?? true,
      status: LivestreamStatus.SCHEDULED,
      streamKey,
      ingestUrl,
    });

    const saved = await this.livestreamRepo.save(livestream);

    // Initialise statistics row
    await this.statsRepo.save(
      this.statsRepo.create({ livestreamId: saved.id }),
    );

    // TODO: emit livestream.scheduled event { livestreamId, creatorId, channelId, scheduledStartAt }

    return saved;
  }

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------

  async startLivestream(creatorId: string, livestreamId: string): Promise<Livestream> {
    const livestream = await this.assertOwnership(livestreamId, creatorId);

    if (livestream.status !== LivestreamStatus.SCHEDULED) {
      throw new BadRequestException(
        'Only a SCHEDULED livestream can be started',
      );
    }

    const playbackUrl = `${this.cdnBaseUrl}/live/${livestream.streamKey}/index.m3u8`;

    await this.livestreamRepo.update(livestreamId, {
      status: LivestreamStatus.LIVE,
      startedAt: new Date(),
      playbackUrl,
    });

    // TODO: emit livestream.started event { livestreamId, creatorId, channelId, playbackUrl }

    return this.findById(livestreamId);
  }

  // ---------------------------------------------------------------------------
  // End
  // ---------------------------------------------------------------------------

  async endLivestream(creatorId: string, livestreamId: string): Promise<Livestream> {
    const livestream = await this.assertOwnership(livestreamId, creatorId);

    if (livestream.status !== LivestreamStatus.LIVE) {
      throw new BadRequestException('Only a LIVE stream can be ended');
    }

    await this.livestreamRepo.update(livestreamId, {
      status: LivestreamStatus.ENDED,
      endedAt: new Date(),
    });

    if (livestream.recordingEnabled) {
      const recordingKey = `recordings/${creatorId}/${livestreamId}/recording.mp4`;
      await this.recordingQueue.add(
        'process-recording',
        {
          livestreamId,
          channelId: livestream.channelId,
          creatorId,
          recordingKey,
          title: livestream.title,
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
    }

    // TODO: emit livestream.ended event { livestreamId, creatorId, channelId }

    return this.findById(livestreamId);
  }

  // ---------------------------------------------------------------------------
  // Cancel
  // ---------------------------------------------------------------------------

  async cancelLivestream(creatorId: string, livestreamId: string): Promise<Livestream> {
    const livestream = await this.assertOwnership(livestreamId, creatorId);

    if (livestream.status !== LivestreamStatus.SCHEDULED) {
      throw new BadRequestException('Only a SCHEDULED livestream can be cancelled');
    }

    await this.livestreamRepo.update(livestreamId, {
      status: LivestreamStatus.CANCELLED,
    });

    // TODO: emit livestream.cancelled event { livestreamId, creatorId }

    return this.findById(livestreamId);
  }

  // ---------------------------------------------------------------------------
  // Update metadata (SCHEDULED only)
  // ---------------------------------------------------------------------------

  async updateLivestream(
    creatorId: string,
    input: UpdateLivestreamInput,
  ): Promise<Livestream> {
    const livestream = await this.assertOwnership(input.livestreamId, creatorId);

    if (livestream.status !== LivestreamStatus.SCHEDULED) {
      throw new BadRequestException(
        'Livestream metadata can only be updated while it is SCHEDULED',
      );
    }

    Object.assign(livestream, {
      ...(input.title !== undefined && { title: input.title }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.category !== undefined && { category: input.category }),
      ...(input.thumbnailUrl !== undefined && { thumbnailUrl: input.thumbnailUrl }),
      ...(input.scheduledStartAt !== undefined && { scheduledStartAt: input.scheduledStartAt }),
      ...(input.recordingEnabled !== undefined && { recordingEnabled: input.recordingEnabled }),
    });

    return this.livestreamRepo.save(livestream);
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  async findById(id: string): Promise<Livestream> {
    const livestream = await this.livestreamRepo.findOne({ where: { id } });
    if (!livestream) throw new NotFoundException(`Livestream ${id} not found`);
    return livestream;
  }

  async listChannelLivestreams(
    channelId: string,
    status: LivestreamStatus | undefined,
    cursor: string | undefined,
    limit: number,
  ): Promise<LivestreamConnection> {
    const qb = this.livestreamRepo
      .createQueryBuilder('l')
      .where('l.channelId = :channelId', { channelId });

    if (status) {
      qb.andWhere('l.status = :status', { status });
    }

    if (cursor) {
      qb.andWhere('l.createdAt < :cursor', {
        cursor: new Date(Buffer.from(cursor, 'base64').toString()),
      });
    }

    qb.orderBy('l.createdAt', 'DESC').take(limit + 1);

    const items = await qb.getMany();
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;

    const nextCursor = hasMore
      ? Buffer.from(page[page.length - 1].createdAt.toISOString()).toString('base64')
      : undefined;

    const totalCount = await qb.clone().skip(0).take(undefined).getCount();

    return { items: page, nextCursor, totalCount };
  }

  // ---------------------------------------------------------------------------
  // Product links
  // ---------------------------------------------------------------------------

  async linkProducts(
    creatorId: string,
    input: LinkProductsToLivestreamInput,
  ): Promise<Livestream> {
    const livestream = await this.assertOwnership(input.livestreamId, creatorId);

    if (livestream.status === LivestreamStatus.ENDED || livestream.status === LivestreamStatus.CANCELLED) {
      throw new BadRequestException('Cannot link products to an ENDED or CANCELLED livestream');
    }

    const existingCount = await this.productRepo.count({
      where: { livestreamId: input.livestreamId },
    });
    if (existingCount + input.links.length > MAX_PRODUCTS_PER_LIVESTREAM) {
      throw new BadRequestException(
        `A livestream can have at most ${MAX_PRODUCTS_PER_LIVESTREAM} product links`,
      );
    }

    // TODO: call ShopService.getProductsByIds to validate ownership

    for (const link of input.links) {
      const existing = await this.productRepo.findOne({
        where: { livestreamId: input.livestreamId, productId: link.productId },
      });

      if (existing) {
        existing.displayOrder = link.displayOrder ?? existing.displayOrder;
        existing.note = link.note ?? existing.note;
        await this.productRepo.save(existing);
      } else {
        await this.productRepo.save(
          this.productRepo.create({
            livestreamId: input.livestreamId,
            productId: link.productId,
            displayOrder: link.displayOrder ?? 0,
            note: link.note,
          }),
        );
      }
    }

    return this.findById(input.livestreamId);
  }

  async unlinkProduct(
    creatorId: string,
    livestreamId: string,
    productId: string,
  ): Promise<boolean> {
    await this.assertOwnership(livestreamId, creatorId);

    const link = await this.productRepo.findOne({
      where: { livestreamId, productId },
    });
    if (!link) throw new NotFoundException('Product link not found');

    await this.productRepo.remove(link);
    return true;
  }

  async pinProduct(
    creatorId: string,
    livestreamId: string,
    productId: string,
  ): Promise<LivestreamProduct> {
    const livestream = await this.assertOwnership(livestreamId, creatorId);

    if (livestream.status !== LivestreamStatus.LIVE) {
      throw new BadRequestException('Products can only be pinned during a LIVE stream');
    }

    const link = await this.productRepo.findOne({
      where: { livestreamId, productId },
    });
    if (!link) throw new NotFoundException('Product is not linked to this livestream');

    // Unpin any currently pinned product first
    await this.productRepo.update({ livestreamId, isPinned: true }, { isPinned: false });

    link.isPinned = true;
    return this.productRepo.save(link);
  }

  async unpinProduct(
    creatorId: string,
    livestreamId: string,
    productId: string,
  ): Promise<LivestreamProduct> {
    await this.assertOwnership(livestreamId, creatorId);

    const link = await this.productRepo.findOne({
      where: { livestreamId, productId },
    });
    if (!link) throw new NotFoundException('Product is not linked to this livestream');

    link.isPinned = false;
    return this.productRepo.save(link);
  }

  async listLinkedProducts(livestreamId: string): Promise<LivestreamProduct[]> {
    return this.productRepo.find({
      where: { livestreamId },
      order: { displayOrder: 'ASC' },
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  async assertOwnership(livestreamId: string, creatorId: string): Promise<Livestream> {
    const livestream = await this.findById(livestreamId);
    if (livestream.creatorId !== creatorId) {
      throw new ForbiddenException('You do not own this livestream');
    }
    return livestream;
  }
}
