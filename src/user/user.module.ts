import { Module } from '@nestjs/common';
import { AuthResolver } from './resources/resolvers/auth.resolver';

@Module({
  imports: [],
  controllers: [],
  providers: [AuthResolver],
})
export class UserModule {}
