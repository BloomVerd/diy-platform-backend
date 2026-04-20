import { ObjectType, Field, ID, Int, Float, registerEnumType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  OneToMany,
  OneToOne,
} from 'typeorm';
import { PlaylistSection } from './playlist-section.entity';
import { PlaylistItem } from './playlist-item.entity';
import { PlaylistStatistics } from './playlist-statistics.entity';
import { PlaylistProductLink } from './playlist-product-link.entity';

export enum PlaylistVisibility {
  DRAFT = 'DRAFT',
  PRIVATE = 'PRIVATE',
  PUBLISHED = 'PUBLISHED',
}

registerEnumType(PlaylistVisibility, { name: 'PlaylistVisibility' });

@ObjectType()
@Entity('playlists')
export class Playlist {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field()
  @Column()
  channelId: string;

  @Field()
  @Column()
  creatorId: string;

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
  coverImageUrl?: string;

  @Field(() => PlaylistVisibility)
  @Column({ type: 'varchar', length: 20, default: PlaylistVisibility.DRAFT })
  visibility: PlaylistVisibility;

  @Field(() => Int)
  @Column({ default: 0 })
  totalDurationSec: number;

  @Field(() => Int)
  @Column({ default: 0 })
  videoCount: number;

  @Field(() => [PlaylistSection])
  @OneToMany(() => PlaylistSection, (s) => s.playlist, { eager: false })
  sections: PlaylistSection[];

  @Field(() => [PlaylistItem])
  @OneToMany(() => PlaylistItem, (i) => i.playlist, { eager: false })
  items: PlaylistItem[];

  @Field(() => [PlaylistProductLink])
  @OneToMany(() => PlaylistProductLink, (l) => l.playlist, { eager: false })
  linkedProducts: PlaylistProductLink[];

  @Field(() => PlaylistStatistics, { nullable: true })
  @OneToOne(() => PlaylistStatistics, (s) => s.playlist, { eager: false })
  statistics?: PlaylistStatistics;

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
