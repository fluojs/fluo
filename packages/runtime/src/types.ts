import type { ConfigLoadOptions, ConfigMode, ConfigService } from '@konekti/config';
import type { Constructor, MaybePromise, Token } from '@konekti/core';
import type { Container, Provider } from '@konekti/di';
import type { Dispatcher, FrameworkRequest, FrameworkResponse, HttpApplicationAdapter, MiddlewareLike, RequestObserverLike } from '@konekti/http';

export type ModuleType = Constructor & { definition?: ModuleDefinition };
export type ControllerType = Constructor;

export interface ModuleDefinition {
  imports?: ModuleType[];
  providers?: Provider[];
  controllers?: ControllerType[];
  exports?: Token[];
  middleware?: MiddlewareLike[];
  global?: boolean;
}

export interface BootstrapModuleOptions {
  duplicateProviderPolicy?: 'warn' | 'throw' | 'ignore';
  logger?: ApplicationLogger;
  providers?: Provider[];
  validationTokens?: Token[];
}

export interface CompiledModule {
  type: ModuleType;
  definition: ModuleDefinition;
  exportedTokens: Set<Token>;
  providerTokens: Set<Token>;
}

export interface BootstrapResult {
  container: Container;
  modules: CompiledModule[];
  rootModule: ModuleType;
}

export interface OnModuleInit {
  onModuleInit(): MaybePromise<void>;
}

export interface OnApplicationBootstrap {
  onApplicationBootstrap(): MaybePromise<void>;
}

export interface OnModuleDestroy {
  onModuleDestroy(): MaybePromise<void>;
}

export interface OnApplicationShutdown {
  onApplicationShutdown(signal?: string): MaybePromise<void>;
}

export interface ApplicationLogger {
  debug(message: string, context?: string): void;
  error(message: string, error?: unknown, context?: string): void;
  log(message: string, context?: string): void;
  warn(message: string, context?: string): void;
}

export type ApplicationState = 'bootstrapped' | 'ready' | 'closed';

/**
 * Called when an unhandled error escapes the request pipeline.
 * Return a value to override the default error response, or return `undefined`
 * to fall through to the next filter or the built-in 500 handler.
 */
export interface ExceptionFilterContext {
  request: FrameworkRequest;
  response: FrameworkResponse;
  requestId?: string;
}

export interface ExceptionFilterHandler {
  catch(error: unknown, context: ExceptionFilterContext): MaybePromise<boolean | void>;
}

export interface BootstrapApplicationOptions extends ConfigLoadOptions {
  adapter?: HttpApplicationAdapter;
  /**
   * Policy for duplicate provider tokens across modules.
   *
   * - `'warn'`   — log a warning but continue bootstrap (default)
   * - `'throw'`  — throw a `DuplicateProviderError` and abort bootstrap
   * - `'ignore'` — silently allow duplicates (last-registered wins)
   */
  duplicateProviderPolicy?: 'warn' | 'throw' | 'ignore';
  /**
   * Global exception filters, evaluated before any module/controller/handler
   * scoped filters.  Each filter's `catch()` is called in order; the first
   * one that returns `true` (handled) stops the chain.
   */
  filters?: ExceptionFilterHandler[];
  logger?: ApplicationLogger;
  middleware?: MiddlewareLike[];
  observers?: RequestObserverLike[];
  providers?: Provider[];
  rootModule: ModuleType;
}

export type CreateApplicationOptions = Omit<BootstrapApplicationOptions, 'rootModule'>;

export interface Application {
  readonly config: ConfigService;
  readonly container: Container;
  readonly envFile: string;
  readonly mode: ConfigMode;
  readonly modules: CompiledModule[];
  readonly rootModule: ModuleType;
  readonly state: ApplicationState;
  readonly dispatcher: Dispatcher;

  close(signal?: string): Promise<void>;
  dispatch: Dispatcher['dispatch'];
  listen(): Promise<void>;
  ready(): Promise<void>;
}
