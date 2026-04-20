import { InputType, Field, ID, PartialType, OmitType } from '@nestjs/graphql';
import { CreateUserInput } from './create-user.input';
import { UserRole } from '../entities/user.entity';

@InputType()
export class UpdateUserInput extends PartialType(
  OmitType(CreateUserInput, ['email', 'password'] as const),
) {
  @Field(() => ID)
  id!: string;

  @Field(() => UserRole)
  role: UserRole = UserRole.USER;
}
