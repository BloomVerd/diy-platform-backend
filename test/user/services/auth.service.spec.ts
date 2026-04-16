import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JwtModule } from '@nestjs/jwt';
import { UserService } from '../../../src/user/user.service';
import { loadEntites } from '../../helpers/load-entities';

describe('UserService', () => {
  let module: TestingModule;
  let dataSource: DataSource;

  let userService: UserService;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: '.env.test.local',
        }),
        JwtModule.register({}),
        TypeOrmModule.forRootAsync({
          imports: [ConfigModule],
          useFactory: async (configService: ConfigService) => ({
            type: 'postgres' as const,
            url: configService.get<string>('DATABASE_URL'),
            entities: loadEntites(),
            synchronize: true,
          }),
          inject: [ConfigService],
        }),
        TypeOrmModule.forFeature(loadEntites()),
      ],
      controllers: [],
      providers: [UserService],
    }).compile();

    dataSource = module.get<DataSource>(DataSource);
    userService = module.get<UserService>(UserService);
  });

  beforeEach(async () => {
    const entities = dataSource.entityMetadatas;
    for (const entity of entities) {
      const repository = dataSource.getRepository(entity.name);
      await repository.query(`TRUNCATE "${entity.tableName}" CASCADE;`);
    }
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await dataSource.destroy();
    await module.close();
  });

  describe('create', () => {
    it('should register a new user', async () => {
      const result = await userService.create({
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        password: 'Secure@123',
      });

      expect(result).toHaveProperty('id');
      expect(result.email).toBe('john.doe@example.com');
    });
  });
});
