import { InputType, Field } from '@nestjs/graphql';
import { IsEmail, Length } from 'class-validator';

@InputType()
export class VerifyOtpInput {
  @Field()
  @IsEmail()
  email: string;

  @Field()
  @Length(6, 6, { message: 'OTP code must be 6 digits' })
  code: string;
}
