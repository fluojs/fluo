import {
  DrizzleDatabase,
  type DrizzleDatabaseFacade,
  type DrizzleHandleProvider,
  DrizzleModule,
} from '@fluojs/drizzle';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { integer, sqliteTable } from 'drizzle-orm/sqlite-core';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
declare function exact<T extends true>(): void;

const client = createClient({ url: 'file:app.db' });
const database = drizzle(client);
type Root = typeof database;
type NativeRunner = Parameters<Root['transaction']>;
type NativeHandle = Parameters<NativeRunner[0]>[0];
type NativeOptions = NativeRunner[1];

DrizzleModule.forRoot({ database: drizzle(client), dispose: () => client.close() });
DrizzleModule.forRoot({
  database,
  dispose(root) {
    exact<Equal<typeof root, Root>>();
    root.$client.close();
  },
});

const wrapper = new DrizzleDatabase(database);
declare const facade: DrizzleDatabaseFacade<Root>;
declare const provider: DrizzleHandleProvider<Root>;
exact<Equal<ReturnType<typeof wrapper.current>, Root | NativeHandle>>();
exact<Equal<ReturnType<typeof facade.current>, Root | NativeHandle>>();
exact<Equal<ReturnType<typeof provider.current>, Root | NativeHandle>>();
exact<Equal<Parameters<typeof wrapper.transaction>[1], NativeOptions>>();
exact<Equal<Parameters<typeof wrapper.requestTransaction>[2], NativeOptions>>();

const users = sqliteTable('users', { id: integer('id') });
wrapper.current().select().from(users);
facade.select().from(users);

const result = wrapper.transaction(async () => 42, { behavior: 'immediate' });
const request = wrapper.requestTransaction(async () => 42, undefined, { behavior: 'deferred' });
exact<Equal<typeof result, Promise<number>>>();
exact<Equal<typeof request, Promise<number>>>();

const fallback = { status: 'ready' };
type Fallback = typeof fallback;
DrizzleModule.forRoot({ database: fallback });
DrizzleModule.forRoot({ database: {} });
DrizzleModule.forRootAsync({ useFactory: () => ({ database: fallback }) });
DrizzleModule.forRootAsync({ useFactory: async () => ({ database: {} }) });
const fallbackWrapper = new DrizzleDatabase(fallback);
const emptyWrapper = new DrizzleDatabase({});
declare const fallbackFacade: DrizzleDatabaseFacade<Fallback>;
const fallbackProvider: DrizzleHandleProvider<Fallback> = fallbackWrapper;
declare const emptyFacade: DrizzleDatabaseFacade<{}>;
const emptyProvider: DrizzleHandleProvider<{}> = emptyWrapper;
exact<Equal<ReturnType<typeof fallbackWrapper.current>, Fallback>>();
exact<Equal<ReturnType<typeof fallbackProvider.current>, Fallback>>();
exact<Equal<ReturnType<typeof emptyProvider.current>, {}>>();
exact<Equal<ReturnType<typeof emptyFacade.current>, {}>>();
exact<Equal<typeof fallbackFacade.status, string>>();
fallbackWrapper.transaction(async () => fallbackWrapper.current().status, 'legacy option');
fallbackProvider.requestTransaction(async () => 42, undefined, 'legacy option');
