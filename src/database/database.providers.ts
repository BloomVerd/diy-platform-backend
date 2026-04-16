import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';

const defaultPostgresDBConnection = (
  configService: ConfigService,
): TypeOrmModuleOptions => ({
  type: 'postgres',
  autoLoadEntities: true,
  synchronize: configService.get('NODE_ENV') !== 'production',
  url: configService.get('DATABASE_URL'),
  // entities: [__dirname + '../**/*.entity{.ts,.js}'],
  // migrations: [__dirname + '/migrations/**/*{.js,.ts}'],
  // migrationsRun: false,
  ssl: {
    rejectUnauthorized: false,
  },
  // logging: true,
  // maxQueryExecutionTime: 1000,
});

const defaultRedisDBConnection = async (configService: ConfigService) => ({
  connection: {
    url: configService.get<string>('REDIS_URL'),
  },
});

export const databaseProviders = [
  TypeOrmModule.forRootAsync({
    imports: [ConfigModule],
    inject: [ConfigService],
    useFactory: defaultPostgresDBConnection,
  }),
  BullModule.forRootAsync({
    imports: [ConfigModule],
    inject: [ConfigService],
    useFactory: defaultRedisDBConnection,
  }),
];
