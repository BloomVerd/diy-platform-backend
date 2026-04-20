import { InputType, Field } from '@nestjs/graphql';
import { IsEmail } from 'class-validator';

@InputType()
export class RequestOtpInput {
  @Field()
  @IsEmail()
  email: string;
}
