import { ObjectType, Field, Int } from '@nestjs/graphql';
import { Playlist } from '../playlist.entity';

@ObjectType()
export class PlaylistConnection {
  @Field(() => [Playlist])
  items: Playlist[];

  @Field({ nullable: true })
  nextCursor?: string;

  @Field(() => Int)
  totalCount: number;
}
