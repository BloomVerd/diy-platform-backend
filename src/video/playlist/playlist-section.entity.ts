import { ObjectType, Field, ID, Int } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  JoinColumn,
} from 'typeorm';
import { Playlist } from './playlist.entity';
import { PlaylistItem } from './playlist-item.entity';

@ObjectType()
@Entity('playlist_sections')
export class PlaylistSection {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field()
  @Column()
  playlistId: string;

  @ManyToOne(() => Playlist, (p) => p.sections, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'playlistId' })
  playlist: Playlist;

  @Field()
  @Column({ length: 150 })
  title: string;

  @Field({ nullable: true })
  @Column({ type: 'text', nullable: true })
  description?: string;

  @Field(() => Int)
  @Column()
  position: number;

  @Field(() => [PlaylistItem])
  @OneToMany(() => PlaylistItem, (i) => i.section, { eager: false })
  items: PlaylistItem[];

  @Field()
  @CreateDateColumn()
  createdAt: Date;
}
