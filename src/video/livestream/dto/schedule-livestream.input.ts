import { InputType, Field, ID } from '@nestjs/graphql';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

@InputType()
export class ScheduleLivestreamInput {
  @Field(() => ID)
  @IsUUID()
  channelId: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  title: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  description?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  category?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  /** ISO 8601 datetime string for when the stream is expected to start. */
  @Field({ nullable: true })
  @IsOptional()
  scheduledStartAt?: Date;

  @Field({ nullable: true, defaultValue: true })
  @IsOptional()
  @IsBoolean()
  recordingEnabled?: boolean;
}
