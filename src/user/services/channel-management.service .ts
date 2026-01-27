import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
// import { OrganizationSetting } from 'src/database/entities/organization_setting.entity';
import { HashHelper } from 'src/shared/helpers';
import { AppLoggerService } from 'src/shared/service/logger.service';
import { Repository } from 'typeorm';
import { User } from '../resources/user.entity';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private jwtService: JwtService,
    private configService: ConfigService,
    private logger: AppLoggerService,
  ) {}

  async createChannel({
    userId,
    channelName,
    description,
  }: {
    userId: string;
    channelName: string;
    description: string;
  }): Promise<{ message: string }> {
    return await this.userRepository.manager.transaction(
      async (transactionalEntityManager) => {
        const existingUser = await transactionalEntityManager.findOne(User, {
          where: { id: userId },
        });

        if (!existingUser) {
          throw new Error('User not found');
        }

        // Logic to create a channel
        const channel = new Channel();
      },
    );
  }
}
