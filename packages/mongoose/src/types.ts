import type { MaybePromise } from '@fluojs/core';

/** Work registered during a transaction callback to run after confirmed native commit. */
export type AfterCommitCallback = () => void | Promise<void>;

/** Package-owned transaction requirements, separate from native driver options. */
export interface TransactionBoundaryOptions {
  /** Rejects before the user callback when the connection cannot provide native after-commit semantics. */
  readonly requireAfterCommit?: boolean;
}

/**
 * Minimal Mongoose connection seam that optionally supports session transaction APIs.
 *
 * @remarks
 * Fluo can open transaction helpers through either `connection.transaction(...)` or `startSession()`;
 * plain connection usage still works without either API.
 */
export interface MongooseConnectionLike {
  startSession?(): Promise<MongooseSessionLike>;
  transaction?<T>(fn: (session: MongooseSessionLike) => Promise<T>): Promise<T>;
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
 * Callable model facade returned by `MongooseConnection.model(...)`.
 *
 * @remarks
 * The listed operations receive the ambient transaction session automatically when called inside a transaction boundary.
 * Other model properties remain available as `unknown` because fluo does not own application schema or plugin typing.
 *
 * @typeParam TCreateResult Result returned by `create(...)`.
 * @typeParam TFindResult Result returned by `find(...)`.
 * @typeParam TFindOneResult Result returned by `findOne(...)`.
 * @typeParam TAggregateResult Result returned by `aggregate(...)`.
 * @typeParam TBulkWriteResult Result returned by `bulkWrite(...)`.
 */
export interface MongooseModelFacade<
  TCreateResult = unknown,
  TFindResult = unknown,
  TFindOneResult = unknown,
  TAggregateResult = unknown,
  TBulkWriteResult = unknown,
> {
  /** Runs a Mongoose aggregate operation with ambient session options. */
  aggregate(...args: unknown[]): TAggregateResult;
  /** Runs a Mongoose bulk-write operation with ambient session options. */
  bulkWrite(...args: unknown[]): TBulkWriteResult;
  /** Runs a Mongoose create operation with ambient session options. */
  create(...args: unknown[]): TCreateResult;
  /** Runs a Mongoose find operation with ambient session options. */
  find(...args: unknown[]): TFindResult;
  /** Runs a Mongoose find-one operation with ambient session options. */
  findOne(...args: unknown[]): TFindOneResult;
  readonly [key: PropertyKey]: unknown;
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
  /** Whether Mongoose providers should be visible globally. Defaults to `false`. */
  global?: boolean;
  /**
   * Throws when transaction helpers are used against a connection that implements neither `connection.transaction(...)` nor
   * `startSession()`.
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
   * Registers work synchronously on the active native transaction owner.
   *
   * @param callback Hook drained in FIFO order after the outer native transaction commits.
   * @throws {AfterCommitCapabilityError} When no active native callback scope exists.
   */
  afterCommit(callback: AfterCommitCallback): void;
  /**
   * Returns a Mongoose model handle, or a session-aware facade inside an active transaction.
   *
   * @param name Model name passed to the underlying Mongoose connection.
   * @param args Additional model resolver arguments forwarded unchanged.
   * @returns The root model outside transactions, or a model facade inside an active transaction boundary.
   */
  model<TModel extends MongooseModelFacade = MongooseModelFacade>(name: string, ...args: unknown[]): TModel;
  /**
   * Opens a Mongoose session transaction boundary around `fn`.
   *
   * @param fn Callback executed within the transaction scope.
   * @param boundary Optional package-owned capability requirements, checked before invoking `fn`.
   * @returns The callback result after the session transaction finishes or the direct-execution fallback completes.
   */
  transaction<T>(fn: () => Promise<T>, boundary?: TransactionBoundaryOptions): Promise<T>;
  /**
   * Opens an abort-aware request transaction boundary around `fn`.
   *
   * @param fn Callback executed within the request transaction scope.
   * @param signal Optional abort signal linked to the request lifecycle.
   * @param boundary Optional package-owned capability requirements, checked before invoking `fn`.
   * @returns The callback result after the request transaction finishes or the direct-execution fallback completes.
   */
  requestTransaction<T>(fn: () => Promise<T>, signal?: AbortSignal, boundary?: TransactionBoundaryOptions): Promise<T>;
}
