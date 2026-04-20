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

export enum AssetType {
  RAW = 'RAW',
  THUMBNAIL = 'THUMBNAIL',
  MANIFEST = 'MANIFEST',
  SEGMENT = 'SEGMENT',
}

registerEnumType(AssetType, { name: 'AssetType' });

@ObjectType()
@Entity('video_assets')
export class VideoAsset {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field()
  @Column()
  videoId: string;

  @ManyToOne(() => Video, (v) => v.assets, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'videoId' })
  video: Video;

  @Field(() => AssetType)
  @Column({ type: 'varchar', length: 20 })
  assetType: AssetType;

  @Field()
  @Column({ type: 'text' })
  storageKey: string;

  @Field({ nullable: true })
  @Column({ type: 'varchar', length: 80, nullable: true })
  mimeType?: string;

  @Field(() => Int, { nullable: true })
  @Column({ type: 'bigint', nullable: true })
  sizeBytes?: number;

  @Field()
  @CreateDateColumn()
  createdAt: Date;
}
