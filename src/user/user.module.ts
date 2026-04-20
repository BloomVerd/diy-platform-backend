import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { BullModule } from '@nestjs/bullmq';
import { User } from './entities/user.entity';
import { UserService } from './user.service';
import { UserResolver } from './user.resolver';
import { JwtAccessStrategy } from './strategies/jwt-access.strategy';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';
import { RolesGuard } from './guards/roles.guard';
import { MailService } from './services/mail.service';
import { OAuthService } from './services/oauth.service';
import { OTP_QUEUE } from './processing/otp.queue';
import { OtpProcessor } from './processing/otp.processor';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    JwtModule.register({}),
    PassportModule.register({ defaultStrategy: 'jwt-access' }),
    BullModule.registerQueue({ name: OTP_QUEUE }),
  ],
  providers: [
    UserService,
    UserResolver,
    JwtAccessStrategy,
    JwtRefreshStrategy,
    RolesGuard,
    MailService,
    OAuthService,
    OtpProcessor,
  ],
  exports: [UserService],
})
export class UserModule {}
