import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Client } from 'pg';
import { Client as CassandraClient } from 'cassandra-driver';

async function createDatabase(dbName: string) {
  const client = new Client({
    user: process.env.DB_USERNAME,
    host: process.env.DB_HOST,
    password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT),
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

async function createKeyspace() {
  const client = new CassandraClient({
    keyspace: process.env.CASSANDRA_DB_KEYSPACE,
    contactPoints: [process.env.CASSANDRA_CONTACT_POINTS || '127.0.0.1'],
    localDataCenter: process.env.CASSANDRA_LOCAL_DATA_CENTER,
    credentials: {
      username: process.env.CASSANDRA_USERNAME || '',
      password: process.env.CASSANDRA_PASSWORD || '',
    },
  });

  const query = `
      CREATE KEYSPACE IF NOT EXISTS diy_keyspace
      WITH replication = {
        'class': 'SimpleStrategy',
        'replication_factor': 1
      }
    `;
  await client.execute(query);
  // this.logger.log('Keyspace created/verified');
}

async function bootstrap() {
  // Create main database
  await createDatabase(process.env.DB_NAME || 'main');
  await createKeyspace();

  // Create test database
  await createDatabase(process.env.DB_NAME_TEST || 'test');

  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
