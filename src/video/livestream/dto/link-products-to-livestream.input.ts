import { InputType, Field, ID, Int } from '@nestjs/graphql';
import { IsArray, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { Type } from 'class-transformer';

@InputType()
export class LivestreamProductLinkInput {
  @Field(() => ID)
  @IsUUID()
  productId: string;

  @Field(() => Int, { nullable: true, defaultValue: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  note?: string;
}

@InputType()
export class LinkProductsToLivestreamInput {
  @Field(() => ID)
  @IsUUID()
  livestreamId: string;

  @Field(() => [LivestreamProductLinkInput])
  @IsArray()
  @Type(() => LivestreamProductLinkInput)
  links: LivestreamProductLinkInput[];
}
