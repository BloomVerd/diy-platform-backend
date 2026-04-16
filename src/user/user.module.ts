import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { User } from './entities/user.entity';
import { UserService } from './user.service';
import { UserResolver } from './user.resolver';
import { JwtAccessStrategy } from './strategies/jwt-access.strategy';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';
import { RolesGuard } from './guards/roles.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    JwtModule.register({}),
    PassportModule.register({ defaultStrategy: 'jwt-access' }),
  ],
  providers: [
    UserService,
    UserResolver,
    JwtAccessStrategy,
    JwtRefreshStrategy,
    RolesGuard,
  ],
  exports: [UserService],
})
export class UserModule {}
