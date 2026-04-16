import { InputType, Field, ID } from '@nestjs/graphql';
import { IsArray, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

@InputType()
export class CreateVideoDraftInput {
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

  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  tags?: string[];

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  playlistId?: string;
}
