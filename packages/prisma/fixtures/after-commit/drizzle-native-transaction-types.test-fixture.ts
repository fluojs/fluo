import {
  type DrizzleAsyncModuleOptions,
  DrizzleDatabase,
  type DrizzleDatabaseFacade,
  type DrizzleHandleProvider,
  DrizzleModule,
  type DrizzleModuleOptions,
} from '@fluojs/drizzle';
import { drizzle } from 'drizzle-orm/node-postgres';
import { integer, pgTable } from 'drizzle-orm/pg-core';
import { Pool } from 'pg';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
declare function exact<T extends true>(): void;

type AppDatabase = ReturnType<typeof drizzle>;
type NativeRunner = Parameters<AppDatabase['transaction']>;
type NativeHandle = Parameters<NativeRunner[0]>[0];
type NativeOptions = NativeRunner[1];

declare class DatabaseConfig {
  getDatabaseUrl(): string;
}

DrizzleModule.forRootAsync({
  inject: [DatabaseConfig],
  useFactory: async (config: DatabaseConfig) => {
    const pool = new Pool({ connectionString: config.getDatabaseUrl() });
    return {
      database: drizzle(pool),
      dispose: async () => {
        await pool.end();
      },
    };
  },
});
const database = drizzle(new Pool());
type Root = typeof database;
const options: DrizzleModuleOptions<Root> = {
  database,
  dispose(root) {
    exact<Equal<typeof root, Root>>();
    return root.$client.end();
  },
};
const asyncOptions: DrizzleAsyncModuleOptions<Root> = {
  name: 'reporting',
  inject: [DatabaseConfig],
  useFactory: (config: DatabaseConfig) => ({
    database: drizzle(new Pool({ connectionString: config.getDatabaseUrl() })),
    dispose: options.dispose,
  }),
};
DrizzleModule.forRoot({ ...options, name: 'reporting' });
DrizzleModule.forRootAsync(asyncOptions);
DrizzleModule.forRootAsync({ useFactory: () => options });
DrizzleModule.forRootAsync({ name: 'billing', useFactory: () => Promise.resolve(options) });

declare const wrapper: DrizzleDatabase<AppDatabase>;
declare const facade: DrizzleDatabaseFacade<AppDatabase>;
const provider: DrizzleHandleProvider<AppDatabase> = wrapper;
exact<Equal<ReturnType<typeof wrapper.current>, AppDatabase | NativeHandle>>();
exact<Equal<ReturnType<typeof facade.current>, AppDatabase | NativeHandle>>();
exact<Equal<ReturnType<typeof provider.current>, AppDatabase | NativeHandle>>();
exact<Equal<Parameters<typeof wrapper.transaction>[1], NativeOptions>>();
exact<Equal<Parameters<typeof wrapper.requestTransaction>[2], NativeOptions>>();

const users = pgTable('users', { id: integer('id') });
wrapper.current().select().from(users);
facade.select().from(users);
const result = wrapper.transaction(async () => 42, { isolationLevel: 'serializable' });
const request = wrapper.requestTransaction(async () => 42, undefined, { accessMode: 'read only' });
exact<Equal<typeof result, Promise<number>>>();
exact<Equal<typeof request, Promise<number>>>();

const explicitOptions: DrizzleModuleOptions<Root, NativeHandle, NativeOptions> = options;
const explicitAsync: DrizzleAsyncModuleOptions<Root, NativeHandle, NativeOptions> = asyncOptions;
DrizzleModule.forRoot<Root, NativeHandle, NativeOptions>(explicitOptions);
DrizzleModule.forRootAsync<Root, NativeHandle, NativeOptions>(explicitAsync);
DrizzleModule.forRoot<Root, NativeHandle>(explicitOptions);
DrizzleModule.forRootAsync<Root, NativeHandle>(explicitAsync);
const explicitWrapper = new DrizzleDatabase<Root, NativeHandle, NativeOptions>(database);
const explicitProvider: DrizzleHandleProvider<Root, NativeHandle, NativeOptions> = explicitWrapper;
declare const explicitFacade: DrizzleDatabaseFacade<Root, NativeHandle, NativeOptions>;
explicitProvider.transaction(async () => 42, { accessMode: 'read only' });
explicitFacade.transaction(async () => 42, { isolationLevel: 'serializable' });
