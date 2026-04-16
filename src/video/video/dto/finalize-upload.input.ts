import { InputType, Field, ID } from '@nestjs/graphql';
import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

@InputType()
export class FinalizeUploadInput {
  @Field(() => ID)
  @IsUUID()
  videoId: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  objectKey: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  checksum?: string;
}
