import type { MaybePromise } from '@konekti/core';

export interface MongooseConnectionLike {
  startSession?(): Promise<MongooseSessionLike>;
}

export interface MongooseSessionLike {
  startTransaction(): Promise<void>;
  commitTransaction(): Promise<void>;
  abortTransaction(): Promise<void>;
  endSession(): Promise<void>;
}

export interface MongooseRuntimeOptions {
  strictTransactions: boolean;
}

export interface MongooseModuleOptions<TConnection extends MongooseConnectionLike = MongooseConnectionLike> {
  connection: TConnection;
  dispose?: (connection: TConnection) => MaybePromise<void>;
  strictTransactions?: boolean;
}

export interface MongooseHandleProvider<TConnection extends MongooseConnectionLike = MongooseConnectionLike> {
  current(): TConnection;
  currentSession(): MongooseSessionLike | undefined;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  requestTransaction<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T>;
}
