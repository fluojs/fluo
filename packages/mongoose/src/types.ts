import type { MaybePromise } from '@konekti/core';

/**
 * Minimal Mongoose connection seam that optionally supports session creation.
 */
export interface MongooseConnectionLike {
  startSession?(): Promise<MongooseSessionLike>;
}

/**
 * Session contract used by the Mongoose transaction wrapper.
 */
export interface MongooseSessionLike {
  startTransaction(): MaybePromise<void>;
  commitTransaction(): MaybePromise<void>;
  abortTransaction(): MaybePromise<void>;
  endSession(): MaybePromise<void>;
}

/**
 * Module options for registering a Mongoose connection and optional shutdown disposal hook.
 */
export interface MongooseModuleOptions<TConnection extends MongooseConnectionLike = MongooseConnectionLike> {
  connection: TConnection;
  dispose?: (connection: TConnection) => MaybePromise<void>;
  strictTransactions?: boolean;
}

/**
 * Public Mongoose wrapper contract exposed through dependency injection.
 */
export interface MongooseHandleProvider<TConnection extends MongooseConnectionLike = MongooseConnectionLike> {
  current(): TConnection;
  currentSession(): MongooseSessionLike | undefined;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  requestTransaction<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T>;
}
