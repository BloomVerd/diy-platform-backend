import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { UserModule } from './user/user.module';
import { VideoModule } from './video/video.module';
import { configValidationSchema } from './config/config.validation';

const stage = process.env.STAGE ?? 'development';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [stage === 'development' ? `.env.${stage}.local` : '.env'],
      validationSchema: configValidationSchema,
    }),
    DatabaseModule,
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: 'schema.gql',
      playground: true,
      introspection: true,
      resolvers: {},
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      context: ({ req, res }: any) => ({ req, res }),
    }),
    UserModule,
    VideoModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
