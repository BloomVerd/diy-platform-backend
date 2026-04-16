import { ObjectType, Field, ID, Int, Float } from '@nestjs/graphql';
import {
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Playlist } from './playlist.entity';

@ObjectType()
@Entity('playlist_statistics')
export class PlaylistStatistics {
  @Field(() => ID)
  @PrimaryColumn('uuid')
  playlistId: string;

  @OneToOne(() => Playlist, (p) => p.statistics, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'playlistId' })
  playlist: Playlist;

  @Field(() => Int)
  @Column({ type: 'bigint', default: 0 })
  totalViews: number;

  @Field(() => Int)
  @Column({ type: 'bigint', default: 0 })
  totalWatchTimeSec: number;

  @Field(() => Int)
  @Column({ default: 0 })
  totalOrders: number;

  @Field(() => Float)
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  totalRevenue: number;

  @Field({ nullable: true })
  @UpdateDateColumn()
  lastComputedAt: Date;
}
