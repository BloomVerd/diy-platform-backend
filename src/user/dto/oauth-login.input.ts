import { InputType, Field } from '@nestjs/graphql';
import { IsEnum, IsNotEmpty } from 'class-validator';
import { AuthProvider } from '../entities/user.entity';

@InputType()
export class OAuthLoginInput {
  @Field(() => AuthProvider)
  @IsEnum(AuthProvider)
  provider: AuthProvider;

  @Field()
  @IsNotEmpty()
  idToken: string;
}
