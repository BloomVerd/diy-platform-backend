import { ObjectType, Field, ID, Int, registerEnumType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum DIYCategory {
  FARMING = 'FARMING',
  IT = 'IT',
  CONSTRUCTION = 'CONSTRUCTION',
  COOKING = 'COOKING',
  AUTOMOTIVE = 'AUTOMOTIVE',
  CRAFTS = 'CRAFTS',
  PLUMBING = 'PLUMBING',
  ELECTRICAL = 'ELECTRICAL',
  GARDENING = 'GARDENING',
  TEXTILE = 'TEXTILE',
  OTHER = 'OTHER',
}

export enum ChannelStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  ARCHIVED = 'ARCHIVED',
}

registerEnumType(DIYCategory, { name: 'DIYCategory' });
registerEnumType(ChannelStatus, { name: 'ChannelStatus' });

@ObjectType()
@Entity('channels')
export class Channel {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field()
  @Column()
  creatorId: string;

  @Field()
  @Column({ length: 120 })
  name: string;

  @Field()
  @Column({ length: 120, unique: true })
  slug: string;

  @Field({ nullable: true })
  @Column({ type: 'text', nullable: true })
  description?: string;

  @Field(() => DIYCategory)
  @Column({ type: 'varchar', length: 30 })
  category: DIYCategory;

  @Field({ nullable: true })
  @Column({ type: 'text', nullable: true })
  coverImageUrl?: string;

  @Field(() => ChannelStatus)
  @Column({ type: 'varchar', length: 20, default: ChannelStatus.ACTIVE })
  status: ChannelStatus;

  @Field(() => Int)
  @Column({ default: 0 })
  subscriberCount: number;

  @Field()
  @CreateDateColumn()
  createdAt: Date;

  @Field()
  @UpdateDateColumn()
  updatedAt: Date;
}
