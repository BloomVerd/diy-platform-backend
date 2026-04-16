import { InputType, Field } from '@nestjs/graphql';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { DIYCategory } from '../channel.entity';

@InputType()
export class CreateChannelInput {
  @Field()
  @IsNotEmpty()
  @IsString()
  @MaxLength(120)
  name: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  description?: string;

  @Field(() => DIYCategory)
  @IsEnum(DIYCategory)
  category: DIYCategory;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  coverImageUrl?: string;
}
