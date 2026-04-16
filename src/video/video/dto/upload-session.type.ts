import { ObjectType, Field, ID } from '@nestjs/graphql';

@ObjectType()
export class UploadField {
  @Field()
  key: string;

  @Field()
  value: string;
}

@ObjectType()
export class UploadSession {
  @Field(() => ID)
  videoId: string;

  @Field()
  uploadUrl: string;

  @Field()
  objectKey: string;

  @Field()
  expiresAt: string;

  @Field(() => [UploadField])
  fields: UploadField[];
}
