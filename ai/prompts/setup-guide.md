# Setup GraphQL

## Import graphql module in the **app.module.ts**
```ts
  GraphQLModule.forRoot<ApolloDriverConfig>({
      autoSchemaFile: true,
      introspection: true,
      playground: true,
      driver: ApolloDriver,
      resolvers: {},
    }),
```

# Setup Environment variables

## Import config module in the **app.module.ts**
```ts
ConfigModule.forRoot({
  envFilePath: [
    process.env.STAGE === 'development'
      ? `.env.${process.env.STAGE}.local`
      : '.env',
  ],
  validationSchema: configValidationSchema,
})
```

# Setup Database

## Create a database
Create a database provider where all the different databases (redis, postgres, cassandra, etc) to be used are configured

```ts
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';

/**
 * Setup default connection in the application
 * @param config {ConfigService}
 */
const defaultPostgresDBConnection = (
  configService: ConfigService,
): TypeOrmModuleOptions => ({
  type: 'postgres',
  autoLoadEntities: true,
  synchronize: configService.get('NODE_ENV') !== 'production',
  url: configService.get('DATABASE_URL'),
  ssl: {
    rejectUnauthorized: false, // allow self-signed AWS certs
  },
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
```

## Create Database Module
The database module imports the database providers. After this the database module itself is imported into the **app.module.ts** file.

```ts
import { Module } from '@nestjs/common';
import { databaseProviders } from './database.provider';

@Module({
  imports: [...databaseProviders],
})
export class DatabaseModule {}
```

Should create the required database(schedular-db, schedular-db-test) when the application starts
```ts
async function createDatabase(dbName: string) {
  const client = new Client({
    user: process.env.DB_USERNAME,
    host: process.env.DB_HOST,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
  });

  try {
    await client.connect();
    await client.query(`CREATE DATABASE "${dbName}"`);
    console.log(`Database ${dbName} created successfully`);
  } catch (error) {
    if (error.code === '42P04') {
      console.log(`Database ${dbName} already exists`);
    } else {
      console.error(`Error creating database ${dbName}:`, error);
    }
  } finally {
    await client.end();
  }
}
```

example use case in main
```ts
// Create main database
  await createDatabase(process.env.DB_NAME);

  // Create test database
  await createDatabase(process.env.DB_NAME_TEST);
```

One thing I want you to take a look at is the use of process.env. Especially in the case of the ConfigModule, I have to pass it in the npm run start:dev command like STAGE=development npm run start:dev. Is there a way to make use of configService?

Add documentation of everything in the **ai/docs** folder
