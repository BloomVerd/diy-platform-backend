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
import { PlaylistSection } from './playlist-section.entity';
import { Video } from '../video/video.entity';

@ObjectType()
@Entity('playlist_items')
export class PlaylistItem {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field()
  @Column()
  playlistId: string;

  @ManyToOne(() => Playlist, (p) => p.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'playlistId' })
  playlist: Playlist;

  @Field()
  @Column()
  videoId: string;

  @Field(() => Video)
  @ManyToOne(() => Video, { eager: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'videoId' })
  video: Video;

  @Field({ nullable: true })
  @Column({ nullable: true })
  sectionId?: string;

  @Field(() => PlaylistSection, { nullable: true })
  @ManyToOne(() => PlaylistSection, (s) => s.items, {
    eager: false,
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'sectionId' })
  section?: PlaylistSection;

  @Field(() => Int)
  @Column()
  position: number;

  @Field({ nullable: true })
  @Column({ type: 'text', nullable: true })
  note?: string;

  @Field()
  @CreateDateColumn()
  createdAt: Date;
}
