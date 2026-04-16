import * as dotenv from 'dotenv';
import * as path from 'path';

const stage = process.env.STAGE ?? 'development';
const envFile = stage === 'development' ? `.env.${stage}.local` : '.env';
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { Client } from 'pg';

async function createDatabase(dbName: string) {
  const client = new Client({
    user: process.env.DB_USERNAME,
    host: process.env.DB_HOST,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432,
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

async function bootstrap() {
  await createDatabase(process.env.DB_NAME || 'main');
  await createDatabase(process.env.DB_NAME_TEST || 'test');

  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: '*', // allow all origins (dev only)
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  const configService = app.get(ConfigService);

  const port = configService.get<number>('PORT', 3000);
  await app.listen(port);
}
bootstrap();
