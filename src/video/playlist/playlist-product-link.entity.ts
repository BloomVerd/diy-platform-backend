import { ObjectType, Field, ID, Int } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Playlist } from './playlist.entity';

@ObjectType()
@Entity('playlist_product_links')
export class PlaylistProductLink {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field()
  @Column()
  playlistId: string;

  @ManyToOne(() => Playlist, (p) => p.linkedProducts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'playlistId' })
  playlist: Playlist;

  @Field(() => ID)
  @Column()
  productId: string;

  @Field(() => Int)
  @Column({ default: 0 })
  displayOrder: number;

  @Field({ nullable: true })
  @Column({ type: 'text', nullable: true })
  note?: string;

  @Field()
  @CreateDateColumn()
  createdAt: Date;
}
