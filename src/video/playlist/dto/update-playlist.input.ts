import { InputType, Field, ID } from '@nestjs/graphql';
import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PlaylistVisibility } from '../playlist.entity';

@InputType()
export class UpdatePlaylistInput {
  @Field(() => ID)
  @IsUUID()
  playlistId: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

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

  @Field(() => PlaylistVisibility, { nullable: true })
  @IsOptional()
  @IsEnum(PlaylistVisibility)
  visibility?: PlaylistVisibility;
}

@InputType()
export class AddPlaylistSectionInput {
  @Field(() => ID)
  @IsUUID()
  playlistId: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  @MaxLength(150)
  title: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  description?: string;

  @Field({ nullable: true })
  @IsOptional()
  position?: number;
}

@InputType()
export class UpdatePlaylistSectionInput {
  @Field(() => ID)
  @IsUUID()
  sectionId: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  title?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  description?: string;

  @Field({ nullable: true })
  @IsOptional()
  position?: number;
}
