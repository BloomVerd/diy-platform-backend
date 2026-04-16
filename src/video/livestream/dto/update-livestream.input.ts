import { InputType, Field, ID } from '@nestjs/graphql';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

@InputType()
export class UpdateLivestreamInput {
  @Field(() => ID)
  @IsUUID()
  livestreamId: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsNotEmpty()
  @IsString()
  title?: string;

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

  @Field({ nullable: true })
  @IsOptional()
  scheduledStartAt?: Date;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  recordingEnabled?: boolean;
}
