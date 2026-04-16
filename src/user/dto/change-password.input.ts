import { InputType, Field } from '@nestjs/graphql';
import { IsNotEmpty, Matches, MinLength } from 'class-validator';

@InputType()
export class ChangePasswordInput {
  @Field()
  @IsNotEmpty()
  currentPassword: string;

  @Field()
  @MinLength(8)
  @Matches(/^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9])/, {
    message:
      'Password must contain at least 1 uppercase letter, 1 number, and 1 special character',
  })
  newPassword: string;
}
