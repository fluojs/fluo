import type { Constructor, MaybePromise, Token } from '@fluojs/core';
import type { Container, Provider } from '@fluojs/di';
import type {
  ConverterLike,
  Dispatcher,
  FrameworkRequest,
  FrameworkResponse,
  HttpApplicationAdapter,
  InterceptorLike,
  MiddlewareLike,
  RequestObserverLike,
  VersioningOptions,
} from '@fluojs/http';

import type { BootstrapTimingDiagnostics } from './health/diagnostics.js';
import type { PlatformComponentInput } from './platform-contract.js';

/** Module class accepted by bootstrap and module-graph compilation helpers. */
export type ModuleType = Constructor & { definition?: ModuleDefinition };
/** Controller class discovered inside one compiled module definition. */
export type ControllerType = Constructor;

/** Programmatic module definition consumed by `defineModule()` and bootstrap. */
export interface ModuleDefinition {
  imports?: ModuleType[];
  providers?: Provider[];
  controllers?: ControllerType[];
  exports?: Token[];
  middleware?: MiddlewareLike[];
  global?: boolean;
}

/** Low-level options used while compiling the runtime module graph. */
export interface BootstrapModuleOptions {
  duplicateProviderPolicy?: 'warn' | 'throw' | 'ignore';
  logger?: ApplicationLogger;
  providers?: Provider[];
  validationTokens?: Token[];
}

/** Compiled module record produced by module-graph analysis. */
export interface CompiledModule {
  type: ModuleType;
  definition: ModuleDefinition;
  exportedTokens: Set<Token>;
  providerTokens: Set<Token>;
}

/** Result returned by low-level bootstrap compilation helpers. */
export interface BootstrapResult {
  container: Container;
  modules: CompiledModule[];
  rootModule: ModuleType;
}

/** Lifecycle hook invoked after one module's providers are instantiated. */
export interface OnModuleInit {
  onModuleInit(): MaybePromise<void>;
}

/** Lifecycle hook invoked after the full application bootstrap finishes. */
export interface OnApplicationBootstrap {
  onApplicationBootstrap(): MaybePromise<void>;
}

/** Lifecycle hook invoked when one module is being torn down. */
export interface OnModuleDestroy {
  onModuleDestroy(): MaybePromise<void>;
}

/** Lifecycle hook invoked during application shutdown with the active signal. */
export interface OnApplicationShutdown {
  onApplicationShutdown(signal?: string): MaybePromise<void>;
}

/** Convenience union covering every public runtime lifecycle hook contract. */
export type LifecycleHooks =
  | OnModuleInit
  | OnApplicationBootstrap
  | OnModuleDestroy
  | OnApplicationShutdown;

/** Logger contract used by runtime bootstrap and lifecycle diagnostics. */
export interface ApplicationLogger {
  debug(message: string, context?: string): void;
  error(message: string, error?: unknown, context?: string): void;
  log(message: string, context?: string): void;
  warn(message: string, context?: string): void;
}

/** Runtime-visible application states for HTTP and microservice shells. */
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

/** Error filter contract evaluated when a request pipeline throws. */
export interface ExceptionFilterHandler {
  catch(error: unknown, context: ExceptionFilterContext): MaybePromise<boolean | void>;
}

/** High-level bootstrap options for creating an HTTP application shell. */
export interface BootstrapApplicationOptions {
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
  converters?: readonly ConverterLike[];
  interceptors?: InterceptorLike[];
  logger?: ApplicationLogger;
  middleware?: MiddlewareLike[];
  observers?: RequestObserverLike[];
  providers?: Provider[];
  platform?: {
    components?: readonly PlatformComponentInput[];
  };
  rootModule: ModuleType;
  diagnostics?: {
    timing?: boolean;
  };
  versioning?: VersioningOptions;
}

/** Options accepted by `FluoFactory.create(...)`. */
export type CreateApplicationOptions = Omit<BootstrapApplicationOptions, 'rootModule'>;

/** Options accepted by `FluoFactory.createApplicationContext(...)`. */
export interface CreateApplicationContextOptions
  extends Omit<BootstrapApplicationOptions, 'adapter' | 'converters' | 'filters' | 'middleware' | 'observers' | 'rootModule'> {
}

/** Runtime transport contract used by microservice application shells. */
export interface MicroserviceRuntime {
  emit?(pattern: string, payload: unknown): MaybePromise<void>;
  listen(): MaybePromise<void>;
  send?(pattern: string, payload: unknown, signal?: AbortSignal): MaybePromise<unknown>;
}

/** Options accepted by `Application.connectMicroservice(...)`. */
export interface CreateMicroserviceOptions extends CreateApplicationContextOptions {
  microserviceToken?: Token<MicroserviceRuntime>;
}

/** Dependency-injection application shell without an HTTP listener. */
export interface ApplicationContext {
  readonly bootstrapTiming?: BootstrapTimingDiagnostics;
  readonly container: Container;
  readonly modules: CompiledModule[];
  readonly rootModule: ModuleType;

  close(signal?: string): Promise<void>;
  get<T>(token: Token<T>): Promise<T>;
}

/** Full HTTP application shell returned by `FluoFactory.create(...)`. */
export interface Application {
  readonly bootstrapTiming?: BootstrapTimingDiagnostics;
  readonly container: Container;
  readonly modules: CompiledModule[];
  readonly rootModule: ModuleType;
  readonly state: ApplicationState;
  readonly dispatcher: Dispatcher;

  close(signal?: string): Promise<void>;
  connectMicroservice(options?: CreateMicroserviceOptions): Promise<MicroserviceApplication>;
  dispatch: Dispatcher['dispatch'];
  get<T>(token: Token<T>): Promise<T>;
  startAllMicroservices(): Promise<void>;
  listen(): Promise<void>;
  ready(): Promise<void>;
}

/** Connected microservice shell managed by an HTTP application or context. */
export interface MicroserviceApplication extends ApplicationContext {
  readonly state: ApplicationState;

  emit(pattern: string, payload: unknown): Promise<void>;
  listen(): Promise<void>;
  send(pattern: string, payload: unknown, signal?: AbortSignal): Promise<unknown>;
}
