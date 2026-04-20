import { InputType, Field, ID, Int } from '@nestjs/graphql';
import { IsOptional, IsString, IsUUID, ValidateNested, ArrayMaxSize, IsArray } from 'class-validator';
import { Type } from 'class-transformer';

@InputType()
export class ProductLinkInput {
  @Field(() => ID)
  @IsUUID()
  productId: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  displayOrder?: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  note?: string;
}

@InputType()
export class LinkProductsToPlaylistInput {
  @Field(() => ID)
  @IsUUID()
  playlistId: string;

  @Field(() => [ProductLinkInput])
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ProductLinkInput)
  links: ProductLinkInput[];
}
