import { Module } from '@nestjs/common';
import { databaseProviders } from './database.providers';
import { CassandraModule } from './cassandra/cassandra.module';

@Module({
  imports: [...databaseProviders],
})
export class DatabaseModule {}
