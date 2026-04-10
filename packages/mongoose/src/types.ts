import type { MaybePromise } from '@fluojs/core';

/**
 * Minimal Mongoose connection seam that optionally supports session creation.
 *
 * @remarks
 * Konekti only requires `startSession()` to expose transaction helpers; plain connection usage still works without it.
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
 *
 * @typeParam TConnection Root Mongoose connection shape registered in the module.
 */
export interface MongooseModuleOptions<TConnection extends MongooseConnectionLike = MongooseConnectionLike> {
  /** Root Mongoose connection shared outside request/session transaction scopes. */
  connection: TConnection;
  /** Optional shutdown hook used to close the connection or surrounding driver resources. */
  dispose?: (connection: TConnection) => MaybePromise<void>;
  /**
   * Throws when transaction helpers are used against a connection that does not implement `startSession()`.
   *
   * @remarks
   * Leave this disabled when `transaction()` / `requestTransaction()` should fall back to direct execution.
   */
  strictTransactions?: boolean;
}

/**
 * Public Mongoose wrapper contract exposed through dependency injection.
 *
 * @typeParam TConnection Root Mongoose connection shape registered in the module.
 */
export interface MongooseHandleProvider<TConnection extends MongooseConnectionLike = MongooseConnectionLike> {
  /** Returns the root Mongoose connection used for model access and session creation. */
  current(): TConnection;
  /** Returns the ambient Mongoose session for the current async context, when one exists. */
  currentSession(): MongooseSessionLike | undefined;
  /**
   * Opens a Mongoose session transaction boundary around `fn`.
   *
   * @param fn Callback executed within the transaction scope.
   * @returns The callback result after the session transaction finishes or the direct-execution fallback completes.
   */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  /**
   * Opens an abort-aware request transaction boundary around `fn`.
   *
   * @param fn Callback executed within the request transaction scope.
   * @param signal Optional abort signal linked to the request lifecycle.
   * @returns The callback result after the request transaction finishes or the direct-execution fallback completes.
   */
  requestTransaction<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T>;
}
