import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { CassandraModule } from './cassandra/cassandra.module';
// import { DatabaseQueryLogger } from '../shared/interceptors/database-query.logger';

/**
 * Setup default connection in the application
 * @param config {ConfigService}
 */
const defaultPostgresDBConnection = (
  configService: ConfigService,
  //   queryLogger: DatabaseQueryLogger,
): TypeOrmModuleOptions => ({
  type: 'postgres',
  autoLoadEntities: true,
  synchronize: configService.get('NODE_ENV') !== 'production',
  url: configService.get('DATABASE_URL'),
  entities: [__dirname + '../**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/**/*{.js,.ts}'],
  migrationsRun: false,
  ssl: {
    rejectUnauthorized: false, // allow self-signed AWS certs
  },
  logging: true,
  //   logger: queryLogger,
  maxQueryExecutionTime: 1000, // Log queries slower than 1 second
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
  CassandraModule.forRoot({
    contactPoints: ['127.0.0.1'],
    localDataCenter: 'datacenter1',
    keyspace: 'diy_keyspace',
    credentials: {
      username: 'cassandra',
      password: 'cassandra',
    },
  }),
];
