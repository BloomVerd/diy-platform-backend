import { InputType, Field, ID, Int } from '@nestjs/graphql';
import { IsInt, IsNotEmpty, IsPositive, IsString, IsUUID, Max } from 'class-validator';

// 5 GB in bytes
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024;

@InputType()
export class CreateUploadSessionInput {
  @Field(() => ID)
  @IsUUID()
  videoId: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  fileName: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  mimeType: string;

  @Field(() => Int)
  @IsInt()
  @IsPositive()
  @Max(MAX_UPLOAD_BYTES)
  sizeBytes: number;
}
