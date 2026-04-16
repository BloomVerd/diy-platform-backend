import { ObjectType, Field, ID, Int, registerEnumType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Video } from './video.entity';

export enum VideoResolution {
  P360 = '360P',
  P720 = '720P',
  P1080 = '1080P',
}

registerEnumType(VideoResolution, { name: 'VideoResolution' });

@ObjectType()
@Entity('video_variants')
export class VideoVariant {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field()
  @Column()
  videoId: string;

  @ManyToOne(() => Video, (v) => v.variants, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'videoId' })
  video: Video;

  @Field(() => VideoResolution)
  @Column({ type: 'varchar', length: 10 })
  resolution: VideoResolution;

  @Field(() => Int)
  @Column()
  bitrate: number;

  @Field()
  @Column({ type: 'varchar', length: 20 })
  codec: string;

  @Field()
  @Column({ type: 'text' })
  manifestPath: string;

  @Field()
  @CreateDateColumn()
  createdAt: Date;
}
