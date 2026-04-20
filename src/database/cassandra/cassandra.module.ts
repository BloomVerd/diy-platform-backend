import { Module, Global, DynamicModule, ModuleMetadata } from '@nestjs/common';
import { Client, ClientOptions } from 'cassandra-driver';

export const CASSANDRA_CLIENT = 'CASSANDRA_CLIENT';

export interface CassandraModuleAsyncOptions extends Pick<
  ModuleMetadata,
  'imports'
> {
  inject?: any[];
  useFactory?: (...args: any[]) => Promise<ClientOptions> | ClientOptions;
}

@Global()
@Module({})
export class CassandraModule {
  static forRoot(options: ClientOptions): DynamicModule {
    const cassandraProvider = {
      provide: CASSANDRA_CLIENT,
      useFactory: async () => {
        const client = new Client(options);
        await client.connect();
        return client;
      },
    };

    return {
      module: CassandraModule,
      providers: [cassandraProvider],
      exports: [cassandraProvider],
    };
  }

  static forRootAsync(options: CassandraModuleAsyncOptions): DynamicModule {
    const cassandraProvider = {
      provide: CASSANDRA_CLIENT,
      useFactory: async (...args: any[]) => {
        if (!options.useFactory) {
          throw new Error(
            'CassandraModule.forRootAsync requires a useFactory function in options',
          );
        }
        const clientOptions = await options.useFactory(...args);
        const client = new Client(clientOptions);
        await client.connect();
        return client;
      },
      inject: options.inject || [],
    };

    return {
      module: CassandraModule,
      imports: options.imports || [],
      providers: [cassandraProvider],
      exports: [cassandraProvider],
    };
  }
}
