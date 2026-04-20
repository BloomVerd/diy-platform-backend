import { ObjectType, Field, ID, Int } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Livestream } from './livestream.entity';

@ObjectType()
@Entity('livestream_products')
export class LivestreamProduct {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field()
  @Column()
  livestreamId: string;

  @ManyToOne(() => Livestream, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'livestreamId' })
  livestream: Livestream;

  /** Soft reference — no FK constraint to the Shop module's products table. */
  @Field()
  @Column()
  productId: string;

  @Field(() => Int)
  @Column({ default: 0 })
  displayOrder: number;

  @Field({ nullable: true })
  @Column({ type: 'text', nullable: true })
  note?: string;

  /** Whether this product is currently highlighted in the live UI. */
  @Field()
  @Column({ default: false })
  isPinned: boolean;

  @Field()
  @CreateDateColumn()
  createdAt: Date;
}
