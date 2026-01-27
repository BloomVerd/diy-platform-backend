import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Connection } from 'typeorm';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from '../../../src/user/services/auth.service';
import { loadEntites } from '../../helpers/load-entities';

describe('AuthService', () => {
  let module: TestingModule;
  let connection: Connection;

  let authService: AuthService;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: '.env.test.local',
        }),
        JwtModule.registerAsync({
          imports: [ConfigModule],
          useFactory: async (configService: ConfigService) => ({
            secret: configService.get<string>('JWT_SECRET'),
            secretOrPrivateKey: configService.get('JWT_SECRET'),
            signOptions: { expiresIn: '1h' },
          }),
          inject: [ConfigService],
        }),
        TypeOrmModule.forRootAsync({
          imports: [ConfigModule],
          useFactory: async (configService: ConfigService) => ({
            type: 'postgres',
            url: configService.get<string>('DATABASE_URL'),
            entities: loadEntites(),

            synchronize: true,
          }),
          inject: [ConfigService],
        }),
        TypeOrmModule.forFeature(loadEntites()),
      ],
      controllers: [],
      providers: [AuthService],
    }).compile();

    connection = module.get<Connection>(Connection);
    authService = module.get<AuthService>(AuthService);
  });

  beforeEach(async () => {
    // Clear the database before each test
    const entities = connection.entityMetadatas;
    for (const entity of entities) {
      const repository = connection.getRepository(entity.name);
      await repository.query(`TRUNCATE "${entity.tableName}" CASCADE;`);
    }
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await connection.close();
    await module.close();
  });

  describe('registerUser', () => {
    it('should register a new user', async () => {
      const result = await authService.registerUser({
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        password: 'securePassword123',
      });

      expect(result).toHaveProperty('message', 'User registered successfully');
    });
  });
});
