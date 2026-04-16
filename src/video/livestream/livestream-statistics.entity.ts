import { ObjectType, Field, ID, Int, Float } from '@nestjs/graphql';
import {
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Livestream } from './livestream.entity';

@ObjectType()
@Entity('livestream_statistics')
export class LivestreamStatistics {
  @Field(() => ID)
  @PrimaryColumn('uuid')
  livestreamId: string;

  @OneToOne(() => Livestream, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'livestreamId' })
  livestream: Livestream;

  @Field(() => Int)
  @Column({ type: 'bigint', default: 0 })
  totalViews: number;

  @Field(() => Int)
  @Column({ default: 0 })
  peakConcurrentViewers: number;

  @Field(() => Int)
  @Column({ type: 'bigint', default: 0 })
  totalWatchTimeSec: number;

  @Field(() => Int)
  @Column({ default: 0 })
  totalOrders: number;

  @Field(() => Float)
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  totalRevenue: number;

  @Field(() => Int)
  @Column({ default: 0 })
  chatMessageCount: number;

  @Field({ nullable: true })
  @UpdateDateColumn()
  lastComputedAt: Date;
}
