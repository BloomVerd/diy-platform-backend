import { InputType, Field, ID, Int } from '@nestjs/graphql';
import { IsOptional, IsString, IsUUID } from 'class-validator';

@InputType()
export class AddVideoToPlaylistInput {
  @Field(() => ID)
  @IsUUID()
  playlistId: string;

  @Field(() => ID)
  @IsUUID()
  videoId: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  sectionId?: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  position?: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  note?: string;
}
