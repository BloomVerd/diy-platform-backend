import {
  ObjectType,
  Field,
  ID,
  Int,
  registerEnumType,
} from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum LivestreamStatus {
  SCHEDULED = 'SCHEDULED',
  LIVE = 'LIVE',
  ENDED = 'ENDED',
  CANCELLED = 'CANCELLED',
}

registerEnumType(LivestreamStatus, { name: 'LivestreamStatus' });

@ObjectType()
@Entity('livestreams')
export class Livestream {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field()
  @Column()
  creatorId: string;

  @Field()
  @Column()
  channelId: string;

  @Field()
  @Column({ length: 200 })
  title: string;

  @Field({ nullable: true })
  @Column({ type: 'text', nullable: true })
  description?: string;

  @Field({ nullable: true })
  @Column({ type: 'varchar', length: 80, nullable: true })
  category?: string;

  @Field({ nullable: true })
  @Column({ type: 'text', nullable: true })
  thumbnailUrl?: string;

  @Field(() => LivestreamStatus)
  @Column({ type: 'varchar', length: 20, default: LivestreamStatus.SCHEDULED })
  status: LivestreamStatus;

  /** Unique per stream — used as the RTMP stream path segment. */
  @Field()
  @Column({ unique: true })
  streamKey: string;

  /** RTMP ingest URL for the streaming software (OBS, etc.). */
  @Field()
  @Column({ type: 'text' })
  ingestUrl: string;

  /** HLS playback URL — set when the stream transitions to LIVE. */
  @Field({ nullable: true })
  @Column({ type: 'text', nullable: true })
  playbackUrl?: string;

  @Field({ nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  scheduledStartAt?: Date;

  @Field({ nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  startedAt?: Date;

  @Field({ nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  endedAt?: Date;

  @Field(() => Int)
  @Column({ default: 0 })
  viewerCount: number;

  @Field(() => Int)
  @Column({ default: 0 })
  peakViewerCount: number;

  /** When true, the raw RTMP recording is processed into a Video after the stream ends. */
  @Field()
  @Column({ default: true })
  recordingEnabled: boolean;

  /** Populated after the recording is transcoded into a Video entity. */
  @Field({ nullable: true })
  @Column({ nullable: true })
  recordingVideoId?: string;

  @Field()
  @CreateDateColumn()
  createdAt: Date;

  @Field()
  @UpdateDateColumn()
  updatedAt: Date;
}
