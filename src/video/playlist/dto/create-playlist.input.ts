import { InputType, Field, ID } from '@nestjs/graphql';
import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

@InputType()
export class CreatePlaylistInput {
  @Field(() => ID)
  @IsUUID()
  channelId: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  title: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  description?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  coverImageUrl?: string;
}
