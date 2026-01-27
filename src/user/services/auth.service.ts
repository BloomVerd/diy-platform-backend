import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
// import { OrganizationSetting } from 'src/database/entities/organization_setting.entity';
import { HashHelper } from '../../shared/helpers';
import { AppLoggerService } from '../../shared/helpers';
import { Repository } from 'typeorm';
import { User } from '../resources/user.entity';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private jwtService: JwtService,
    private configService: ConfigService,
    private logger: AppLoggerService,
  ) {}

  // async loginUser({
  //   email,
  //   password,
  // }: {
  //   email: string;
  //   password: string;
  // }): Promise<{ token: string }> {
  //   return await this.userRepository.manager.transaction(
  //     async (transactionalEntityManager) => {
  //       const existingUser = await transactionalEntityManager.findOne(User, {
  //         where: { email },
  //       });

  //       if (!existingUser) {
  //         this.logger.warn(
  //           `Login failed: User with email ${email} not found`,
  //           'UserAuth',
  //         );
  //         throw new Error('Invalid email or password');
  //       }

  //       const isPasswordValid = await HashHelper.compare(
  //         password,
  //         existingUser.password,
  //       );

  //       if (!isPasswordValid) {
  //         this.logger.warn(
  //           `Login failed: Invalid password for email ${email}`,
  //           'UserAuth',
  //         );
  //         throw new Error('Invalid email or password');
  //       }

  //       const payload = { sub: existingUser.id, email: existingUser.email };
  //       const token = this.jwtService.sign(payload, {
  //         secret: this.configService.get<string>('JWT_SECRET'),
  //         expiresIn: this.configService.get<string>('JWT_EXPIRES_IN'),
  //       });

  //       this.logger.log(`User logged in successfully: ${email}`, 'UserAuth');

  //       return { token };
  //     },
  //   );
  // }

  async registerUser({
    firstName,
    lastName,
    email,
    password,
  }: {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
  }): Promise<{ message: string }> {
    return await this.userRepository.manager.transaction(
      async (transactionalEntityManager) => {
        const existingUser = await transactionalEntityManager.findOne(User, {
          where: { email },
        });

        if (existingUser) {
          this.logger.warn(
            `Registration failed: Organization with email ${email} already exists`,
            'OrganizationAuth',
          );
          throw new Error('User  with this email already exists');
        }

        // const setting = new OrganizationSetting();
        // await transactionalEntityManager.save(OrganizationSetting, setting);

        const user = new User();
        user.name = `${firstName} ${lastName}`;
        user.email = email;
        user.password = await HashHelper.encrypt(password);

        await transactionalEntityManager.save(User, user);

        // Track organization creation

        this.logger.log(
          `Organization registered successfully: ${email}`,
          'OrganizationAuth',
        );

        return { message: 'User account created successfully' };
      },
    );
  }
}
