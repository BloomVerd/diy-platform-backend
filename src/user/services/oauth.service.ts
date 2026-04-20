import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import appleSignin from 'apple-signin-auth';
import { AuthProvider } from '../entities/user.entity';

export interface OAuthProfile {
  provider: AuthProvider;
  providerId: string;
  email: string;
  emailVerified: boolean;
  firstName?: string;
  lastName?: string;
}

@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);
  private readonly googleClient: OAuth2Client;
  private readonly googleClientId: string;
  private readonly appleClientId: string;

  constructor(private readonly configService: ConfigService) {
    this.googleClientId = this.configService.getOrThrow<string>(
      'GOOGLE_OAUTH_CLIENT_ID',
    );
    this.appleClientId =
      this.configService.getOrThrow<string>('APPLE_CLIENT_ID');
    this.googleClient = new OAuth2Client(this.googleClientId);
  }

  async verify(provider: AuthProvider, idToken: string): Promise<OAuthProfile> {
    switch (provider) {
      case AuthProvider.GOOGLE:
        return this.verifyGoogle(idToken);
      case AuthProvider.APPLE:
        return this.verifyApple(idToken);
      default:
        throw new UnauthorizedException('Unsupported OAuth provider');
    }
  }

  private async verifyGoogle(idToken: string): Promise<OAuthProfile> {
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: this.googleClientId,
      });
      const payload = ticket.getPayload();
      if (!payload || !payload.sub || !payload.email) {
        throw new UnauthorizedException('Invalid Google token');
      }
      return {
        provider: AuthProvider.GOOGLE,
        providerId: payload.sub,
        email: payload.email,
        emailVerified: payload.email_verified === true,
        firstName: payload.given_name,
        lastName: payload.family_name,
      };
    } catch (err) {
      this.logger.warn(`Google token verification failed: ${String(err)}`);
      throw new UnauthorizedException('Invalid Google token');
    }
  }

  private async verifyApple(idToken: string): Promise<OAuthProfile> {
    try {
      const payload = await appleSignin.verifyIdToken(idToken, {
        audience: this.appleClientId,
        ignoreExpiration: false,
      });
      if (!payload.sub || !payload.email) {
        throw new UnauthorizedException('Invalid Apple token');
      }
      const emailVerified =
        payload.email_verified === true || payload.email_verified === 'true';
      return {
        provider: AuthProvider.APPLE,
        providerId: payload.sub,
        email: payload.email,
        emailVerified,
      };
    } catch (err) {
      this.logger.warn(`Apple token verification failed: ${String(err)}`);
      throw new UnauthorizedException('Invalid Apple token');
    }
  }
}
