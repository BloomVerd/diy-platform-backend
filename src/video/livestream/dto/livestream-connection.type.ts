import { ObjectType, Field, Int } from '@nestjs/graphql';
import { Livestream } from '../livestream.entity';

@ObjectType()
export class LivestreamConnection {
  @Field(() => [Livestream])
  items: Livestream[];

  @Field({ nullable: true })
  nextCursor?: string;

  @Field(() => Int)
  totalCount: number;
}
