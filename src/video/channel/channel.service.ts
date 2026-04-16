import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Channel, ChannelStatus, DIYCategory } from './channel.entity';
import { CreateChannelInput } from './dto/create-channel.input';

@Injectable()
export class ChannelService {
  constructor(
    @InjectRepository(Channel)
    private readonly channelRepo: Repository<Channel>,
  ) {}

  async createChannel(
    creatorId: string,
    input: CreateChannelInput,
  ): Promise<Channel> {
    const existing = await this.channelRepo.findOne({
      where: { creatorId, category: input.category, status: ChannelStatus.ACTIVE },
    });
    if (existing) {
      throw new BadRequestException(
        `You already have an active channel in the ${input.category} category`,
      );
    }

    const slug = await this.generateUniqueSlug(input.name);

    const channel = this.channelRepo.create({
      creatorId,
      name: input.name,
      slug,
      description: input.description,
      category: input.category,
      coverImageUrl: input.coverImageUrl,
      status: ChannelStatus.ACTIVE,
    });

    return this.channelRepo.save(channel);
    // TODO: emit channel.created event { channelId, creatorId, category }
  }

  async findById(id: string): Promise<Channel> {
    const channel = await this.channelRepo.findOne({ where: { id } });
    if (!channel) {
      throw new NotFoundException(`Channel ${id} not found`);
    }
    return channel;
  }

  async findByCreator(creatorId: string): Promise<Channel[]> {
    return this.channelRepo.find({ where: { creatorId } });
  }

  async assertOwnership(channelId: string, creatorId: string): Promise<Channel> {
    const channel = await this.findById(channelId);
    if (channel.creatorId !== creatorId) {
      throw new ForbiddenException('You do not own this channel');
    }
    return channel;
  }

  private async generateUniqueSlug(name: string): Promise<string> {
    const base = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    const existing = await this.channelRepo.findOne({ where: { slug: base } });
    if (!existing) {
      return base;
    }

    const suffix = Math.random().toString(36).slice(2, 8);
    return `${base}-${suffix}`;
  }
}
