import { InputType, Field, ID, PartialType, OmitType } from '@nestjs/graphql';
import { CreateUserInput } from './create-user.input';

@InputType()
export class UpdateUserInput extends PartialType(
  OmitType(CreateUserInput, ['email', 'password'] as const),
) {
  @Field(() => ID)
  id: string;
}
