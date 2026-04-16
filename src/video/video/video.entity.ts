import { ObjectType, Field, ID, Int, registerEnumType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { VideoVariant } from './video-variant.entity';
import { VideoAsset } from './video-asset.entity';

export enum VideoVisibility {
  DRAFT = 'DRAFT',
  PRIVATE = 'PRIVATE',
  PUBLISHED = 'PUBLISHED',
}

export enum ProcessingStatus {
  DRAFT = 'DRAFT',
  UPLOADING = 'UPLOADING',
  UPLOADED = 'UPLOADED',
  PROCESSING = 'PROCESSING',
  READY = 'READY',
  FAILED = 'FAILED',
  PUBLISHED = 'PUBLISHED',
}

registerEnumType(VideoVisibility, { name: 'VideoVisibility' });
registerEnumType(ProcessingStatus, { name: 'ProcessingStatus' });

@ObjectType()
@Entity('videos')
export class Video {
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

  @Field(() => [String])
  @Column({ type: 'text', array: true, default: [] })
  tags: string[];

  @Field({ nullable: true })
  @Column({ type: 'varchar', length: 80, nullable: true })
  category?: string;

  @Field(() => VideoVisibility)
  @Column({ type: 'varchar', length: 20, default: VideoVisibility.DRAFT })
  visibility: VideoVisibility;

  @Field(() => ProcessingStatus)
  @Column({ type: 'varchar', length: 20, default: ProcessingStatus.DRAFT })
  processingStatus: ProcessingStatus;

  @Field(() => Int, { nullable: true })
  @Column({ nullable: true })
  durationSec?: number;

  @Field({ nullable: true })
  @Column({ type: 'text', nullable: true })
  thumbnailUrl?: string;

  @Field({ nullable: true })
  @Column({ type: 'text', nullable: true })
  playbackManifestUrl?: string;

  @Field(() => Int)
  @Column({ default: 0 })
  viewCount: number;

  @Field(() => [VideoVariant])
  @OneToMany(() => VideoVariant, (v) => v.video, { eager: false })
  variants: VideoVariant[];

  @Field(() => [VideoAsset])
  @OneToMany(() => VideoAsset, (a) => a.video, { eager: false })
  assets: VideoAsset[];

  @Field({ nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  publishedAt?: Date;

  @Field()
  @CreateDateColumn()
  createdAt: Date;

  @Field()
  @UpdateDateColumn()
  updatedAt: Date;
}
