import { Container, type Provider } from '@fluojs/di';
import { DefaultBinder } from '@fluojs/http/internal';
import { InvariantError, type Token } from '@fluojs/core';
import { defineModuleMetadata, getClassDiMetadata } from '@fluojs/core/internal';
import {
  createDispatcher,
  createHandlerMapping,
  type FrameworkRequest,
  type FrameworkResponse,
  type HttpApplicationAdapter,
  type Dispatcher,
  type HandlerSource,
} from '@fluojs/http';

import { DuplicateProviderError } from './errors.js';
import { createBootstrapTimingDiagnostics, type BootstrapTimingPhase } from './health/diagnostics.js';
import { createConsoleApplicationLogger } from './logging/logger.js';
import { compileModuleGraph, createRuntimeTokenSet, providerToken } from './module-graph.js';
import { createRuntimePlatformShell, type RuntimePlatformShell } from './platform-shell.js';
import { APPLICATION_LOGGER, COMPILED_MODULES, HTTP_APPLICATION_ADAPTER, PLATFORM_SHELL, RUNTIME_CONTAINER } from './tokens.js';
import type {
  ApplicationContext,
  Application,
  ApplicationLogger,
  MicroserviceApplication,
  MicroserviceRuntime,
  ApplicationState,
  BootstrapApplicationOptions,
  BootstrapModuleOptions,
  BootstrapResult,
  CompiledModule,
  CreateApplicationOptions,
  CreateApplicationContextOptions,
  CreateMicroserviceOptions,
  ExceptionFilterHandler,
  ModuleDefinition,
  ModuleType,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  OnModuleDestroy,
  OnModuleInit,
} from './types.js';

const DEFAULT_MICROSERVICE_TOKEN = Symbol.for('konekti.microservices.service') as Token<MicroserviceRuntime>;
const runtimePerformance = globalThis.performance;

async function runExceptionFilters(
  filters: readonly ExceptionFilterHandler[],
  error: unknown,
  request: FrameworkRequest,
  response: FrameworkResponse,
  requestId?: string,
): Promise<boolean> {
  for (const filter of filters) {
    const handled = await filter.catch(error, { request, response, requestId });

    if (handled) {
      return true;
    }
  }

  return false;
}

function providerScope(provider: Provider): 'singleton' | 'request' | 'transient' {
  if (typeof provider === 'function') {
    return getClassDiMetadata(provider)?.scope ?? 'singleton';
  }

  if ('useValue' in provider) {
    return 'singleton';
  }

  if ('useClass' in provider) {
    return provider.scope ?? getClassDiMetadata(provider.useClass)?.scope ?? 'singleton';
  }

  if ('useFactory' in provider) {
    return provider.scope ?? (provider.resolverClass ? getClassDiMetadata(provider.resolverClass)?.scope : undefined) ?? 'singleton';
  }

  return 'singleton';
}

async function disposeContainer(container: Container): Promise<void> {
  if (!hasMethod(container, 'dispose')) {
    return;
  }

  await container.dispose();
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function createLifecycleCloseError(errors: unknown[]): Error {
  if (errors.length === 1) {
    return toError(errors[0]);
  }

  return new AggregateError(errors, 'Application close failed for one or more shutdown steps.');
}

async function runCleanupCallbacks(cleanups: readonly (() => void)[]): Promise<unknown[]> {
  const errors: unknown[] = [];

  for (const cleanup of cleanups) {
    try {
      cleanup();
    } catch (error) {
      errors.push(error);
    }
  }

  return errors;
}

async function closeRuntimeResources(options: {
  adapter?: HttpApplicationAdapter;
  container: Container;
  lifecycleInstances: readonly unknown[];
  runtimeCleanup: readonly (() => void)[];
  signal?: string;
}): Promise<void> {
  const errors: unknown[] = [];

  errors.push(...(await runCleanupCallbacks(options.runtimeCleanup)));

  try {
    await runShutdownHooks(options.lifecycleInstances, options.signal);
  } catch (error) {
    errors.push(error);
  }

  if (options.adapter) {
    try {
      await options.adapter.close(options.signal);
    } catch (error) {
      errors.push(error);
    }
  }

  try {
    await disposeContainer(options.container);
  } catch (error) {
    errors.push(error);
  }

  if (errors.length > 0) {
    throw createLifecycleCloseError(errors);
  }
}

async function runBootstrapFailureCleanup(options: {
  container?: Container;
  lifecycleInstances: readonly unknown[];
  logger: ApplicationLogger;
  runtimeCleanup: readonly (() => void)[];
  scope: 'application' | 'application context';
}): Promise<void> {
  const errors: unknown[] = [];

  errors.push(...(await runCleanupCallbacks(options.runtimeCleanup)));

  if (options.lifecycleInstances.length > 0) {
    try {
      await runShutdownHooks(options.lifecycleInstances, 'bootstrap-failed');
    } catch (error) {
      errors.push(error);
    }
  }

  if (options.container) {
    try {
      await disposeContainer(options.container);
    } catch (error) {
      errors.push(error);
    }
  }

  for (const error of errors) {
    options.logger.error(
      `Failed to clean up after ${options.scope} bootstrap failure.`,
      error,
      'KonektiFactory',
    );
  }
}

function hasMethod<TName extends string>(
  value: unknown,
  methodName: TName,
): value is Record<TName, (...args: never[]) => unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return typeof (value as Record<string, unknown>)[methodName] === 'function';
}

function isOnModuleInit(value: unknown): value is OnModuleInit {
  return hasMethod(value, 'onModuleInit');
}

function isOnApplicationBootstrap(value: unknown): value is OnApplicationBootstrap {
  return hasMethod(value, 'onApplicationBootstrap');
}

function isOnModuleDestroy(value: unknown): value is OnModuleDestroy {
  return hasMethod(value, 'onModuleDestroy');
}

function isOnApplicationShutdown(value: unknown): value is OnApplicationShutdown {
  return hasMethod(value, 'onApplicationShutdown');
}

function hasReadinessStateMethods(value: unknown): value is { markReady(): void; markStarting(): void } {
  if (typeof value !== 'function') {
    return false;
  }

  const readinessAware = value as Function & { markReady?: unknown; markStarting?: unknown };

  return typeof readinessAware.markReady === 'function' && typeof readinessAware.markStarting === 'function';
}

function isMicroserviceRuntime(value: unknown): value is MicroserviceRuntime {
  return hasMethod(value, 'listen');
}

function resetReadinessState(modules: CompiledModule[]): void {
  for (const compiledModule of modules) {
    if (hasReadinessStateMethods(compiledModule.type)) {
      compiledModule.type.markStarting();
    }
  }
}

function markReadinessState(modules: CompiledModule[]): void {
  for (const compiledModule of modules) {
    if (hasReadinessStateMethods(compiledModule.type)) {
      compiledModule.type.markReady();
    }
  }
}

type DuplicateProviderPolicy = Exclude<BootstrapModuleOptions['duplicateProviderPolicy'], undefined>;

interface SelectedProviderEntry {
  moduleName: string;
  provider: Provider;
  source: 'module' | 'runtime';
  token: Token;
}

function createDuplicateProviderMessage(token: Token, moduleName: string, existingModuleName: string): string {
  const tokenLabel = typeof token === 'function' ? token.name || '<anonymous>' : String(token);
  return `Duplicate provider token "${tokenLabel}" registered in module "${moduleName}". Previously registered in module "${existingModuleName}".`;
}

function collectProvidersForContainer(
  modules: CompiledModule[],
  runtimeProviders: Provider[] | undefined,
  policy: DuplicateProviderPolicy,
  logger?: ApplicationLogger,
): Provider[] {
  const selectedProviders = new Map<Token, SelectedProviderEntry>();

  for (const runtimeProvider of runtimeProviders ?? []) {
    const token = providerToken(runtimeProvider);
    selectedProviders.set(token, {
      moduleName: '<runtime>',
      provider: runtimeProvider,
      source: 'runtime',
      token,
    });
  }

  for (const compiledModule of modules) {
    for (const provider of compiledModule.definition.providers ?? []) {
      const token = providerToken(provider);
      const existing = selectedProviders.get(token);

      if (existing && existing.source === 'module') {
        const message = createDuplicateProviderMessage(token, compiledModule.type.name, existing.moduleName);

        if (policy === 'throw') {
          throw new DuplicateProviderError(message, {
            module: compiledModule.type.name,
            token,
            phase: 'provider registration',
            hint: `Remove the duplicate registration from one of the modules, use container.override() for intentional replacements, or set duplicateProviderPolicy to 'warn' or 'ignore'.`,
          });
        }

        if (policy === 'warn') {
          logger?.warn(message, 'BootstrapModule');
        }
      }

      selectedProviders.set(token, {
        moduleName: compiledModule.type.name,
        provider,
        source: 'module',
        token,
      });
    }
  }

  return [...selectedProviders.values()].map((entry) => entry.provider);
}

function registerControllers(container: Container, modules: CompiledModule[]): void {
  for (const compiledModule of modules) {
    for (const controller of compiledModule.definition.controllers ?? []) {
      container.register(controller);
    }
  }
}

function registerMiddlewareToken(container: Container, middlewareToken: Function): void {
  if (container.has(middlewareToken as Token)) {
    return;
  }

  container.register(middlewareToken as Parameters<typeof container.register>[0]);
}

function registerModuleMiddleware(container: Container, modules: CompiledModule[]): void {
  for (const compiledModule of modules) {
    for (const middleware of compiledModule.definition.middleware ?? []) {
      if (typeof middleware === 'object' && middleware !== null && 'middleware' in middleware && 'routes' in middleware) {
        const middlewareToken = (middleware as { middleware: unknown; routes: unknown }).middleware;

        if (typeof middlewareToken === 'function') {
          registerMiddlewareToken(container, middlewareToken);
        }

        continue;
      }

      if (typeof middleware === 'function') {
        registerMiddlewareToken(container, middleware);
      }
    }
  }
}

/**
 * Associates module metadata with a module type.
 *
 * @param moduleType Module class that should receive runtime module metadata.
 * @param definition Module definition contract (`imports`, `providers`, `controllers`, `exports`, etc.).
 * @returns The same `moduleType` reference for fluent helper composition.
 */
export function defineModule<T extends ModuleType>(moduleType: T, definition: ModuleDefinition): T {
  defineModuleMetadata(moduleType, definition);

  return moduleType;
}

/**
 * Bootstraps the module graph and returns the root container baseline.
 *
 * @param rootModule Root module type used as the module-graph entrypoint.
 * @param options Bootstrap-module options such as runtime providers and duplicate-provider policy.
 * @returns The compiled module graph and initialized DI container baseline.
 * @throws {DuplicateProviderError} When duplicate module provider tokens are detected and policy is `throw`.
 * @throws {Error} When module-graph compilation or provider registration fails.
 */
export function bootstrapModule(rootModule: ModuleType, options: BootstrapModuleOptions = {}): BootstrapResult {
  const modules = compileModuleGraph(rootModule, options);
  const container = new Container();
  const policy: DuplicateProviderPolicy = options.duplicateProviderPolicy ?? 'warn';

  const runtimeProviders = options.providers ?? [];
  const runtimeProviderTokens = createRuntimeTokenSet(runtimeProviders);
  const moduleProviders = collectProvidersForContainer(modules, runtimeProviders, policy, options.logger)
    .filter((provider) => !runtimeProviderTokens.has(providerToken(provider)));

  if (runtimeProviders.length > 0) {
    container.register(...runtimeProviders);
  }

  if (moduleProviders.length > 0) {
    container.register(...moduleProviders);
  }

  registerControllers(container, modules);
  registerModuleMiddleware(container, modules);

  return {
    container,
    modules,
    rootModule,
  };
}

/**
 * 애플리케이션 라이프사이클과 상태 전이를 담당하는 최소 런타임 셸이다.
 */
class KonektiApplication implements Application {
  private applicationState: ApplicationState = 'bootstrapped';
  private closed = false;
  private closingPromise: Promise<void> | undefined;
  private readonly lifecycleInstances: unknown[];
  private readonly connectedMicroservices: MicroserviceApplication[] = [];

  constructor(
    readonly container: Container,
    readonly modules: CompiledModule[],
    readonly rootModule: ModuleType,
    readonly dispatcher: Dispatcher,
    readonly bootstrapTiming: Application['bootstrapTiming'],
    private readonly adapter: HttpApplicationAdapter,
    private readonly hasHttpAdapter: boolean,
    private readonly platformShell: RuntimePlatformShell,
    lifecycleInstances: unknown[],
    private readonly logger: ApplicationLogger,
    private readonly runtimeCleanup: Array<() => void>,
  ) {
    this.lifecycleInstances = lifecycleInstances;
  }

  get state(): ApplicationState {
    return this.applicationState;
  }

  async get<T>(token: Token<T>): Promise<T> {
    return this.container.resolve(token);
  }

  /**
   * 애플리케이션이 더 이상 닫힌 상태가 아닌지 확인한다.
   */
  async ready(): Promise<void> {
    if (this.applicationState === 'closed') {
      throw new InvariantError('Application cannot become ready after it has been closed.');
    }

    await this.platformShell.assertCriticalReadiness();
  }

  async connectMicroservice(options: CreateMicroserviceOptions = {}): Promise<MicroserviceApplication> {
    const microserviceToken = options.microserviceToken ?? DEFAULT_MICROSERVICE_TOKEN;
    const runtime = await this.container.resolve<unknown>(microserviceToken);

    if (!isMicroserviceRuntime(runtime)) {
      throw new InvariantError('Resolved microservice token does not implement listen().');
    }

    const microservice = new KonektiMicroserviceApplication(this, this.logger, runtime);
    this.connectedMicroservices.push(microservice);

    return microservice;
  }

  async startAllMicroservices(): Promise<void> {
    await Promise.all(this.connectedMicroservices.map(async (microservice) => microservice.listen()));
  }

  /**
   * 준비 검사를 통과한 뒤 어댑터에 바인딩을 위임하고 상태를 `ready`로 전이한다.
   */
  async listen(): Promise<void> {
    if (this.applicationState === 'closed') {
      throw new InvariantError('Application cannot listen after it has been closed.');
    }

    if (this.applicationState === 'ready') {
      return;
    }

    if (!this.hasHttpAdapter) {
      throw new InvariantError(
        'Application cannot listen without an HTTP adapter. Provide options.adapter for HTTP startup, or use createApplicationContext() for adapterless DI-only bootstrap.',
      );
    }

    await this.ready();
    try {
      await this.adapter.listen(this.dispatcher);
    } catch (error: unknown) {
      this.logger.error('Failed to start the HTTP adapter.', error, 'KonektiApplication');
      throw error;
    }

    this.applicationState = 'ready';
    this.logger.log('Konekti application successfully started.', 'KonektiApplication');
  }

  dispatch = async (...args: Parameters<Dispatcher['dispatch']>): Promise<void> => {
    await this.dispatcher.dispatch(...args);
  };

  /**
   * 어댑터 종료와 shutdown hook 실행을 담당하는 명시적 종료 경로다.
   */
  async close(signal?: string): Promise<void> {
    if (this.closed) {
      return;
    }

    if (this.closingPromise) {
      await this.closingPromise;
      return;
    }

    this.closingPromise = (async () => {
      await closeRuntimeResources({
        adapter: this.adapter,
        container: this.container,
        lifecycleInstances: this.lifecycleInstances,
        runtimeCleanup: this.runtimeCleanup,
        signal,
      });
      this.closed = true;
      this.applicationState = 'closed';
    })();

    try {
      await this.closingPromise;
    } catch (error) {
      this.closingPromise = undefined;
      throw error;
    }
  }
}

class KonektiApplicationContext implements ApplicationContext {
  private closed = false;
  private closingPromise: Promise<void> | undefined;

  constructor(
    readonly container: Container,
    readonly modules: CompiledModule[],
    readonly rootModule: ModuleType,
    readonly bootstrapTiming: ApplicationContext['bootstrapTiming'],
    private readonly lifecycleInstances: unknown[],
    private readonly runtimeCleanup: Array<() => void>,
  ) {}

  async get<T>(token: Token<T>): Promise<T> {
    return this.container.resolve(token);
  }

  async close(signal?: string): Promise<void> {
    if (this.closed) {
      return;
    }

    if (this.closingPromise) {
      await this.closingPromise;
      return;
    }

    this.closingPromise = (async () => {
      await closeRuntimeResources({
        container: this.container,
        lifecycleInstances: this.lifecycleInstances,
        runtimeCleanup: this.runtimeCleanup,
        signal,
      });
      this.closed = true;
    })();

    try {
      await this.closingPromise;
    } catch (error) {
      this.closingPromise = undefined;
      throw error;
    }
  }
}

class KonektiMicroserviceApplication implements MicroserviceApplication {
  private closed = false;
  private closingPromise: Promise<void> | undefined;
  private microserviceState: ApplicationState = 'bootstrapped';

  constructor(
    private readonly context: ApplicationContext,
    private readonly logger: ApplicationLogger,
    private readonly runtime: MicroserviceRuntime,
  ) {}

  get container(): Container {
    return this.context.container;
  }

  get modules(): CompiledModule[] {
    return this.context.modules;
  }

  get rootModule(): ModuleType {
    return this.context.rootModule;
  }

  get state(): ApplicationState {
    return this.microserviceState;
  }

  async get<T>(token: Token<T>): Promise<T> {
    return this.context.get(token);
  }

  async listen(): Promise<void> {
    if (this.microserviceState === 'closed') {
      throw new InvariantError('Microservice cannot listen after it has been closed.');
    }

    if (this.microserviceState === 'ready') {
      return;
    }

    await this.runtime.listen();
    this.microserviceState = 'ready';
    this.logger.log('Konekti microservice successfully started.', 'KonektiFactory');
  }

  async send(pattern: string, payload: unknown, signal?: AbortSignal): Promise<unknown> {
    if (!this.runtime.send) {
      throw new InvariantError('Resolved microservice runtime does not implement send().');
    }

    return await this.runtime.send(pattern, payload, signal);
  }

  async emit(pattern: string, payload: unknown): Promise<void> {
    if (!this.runtime.emit) {
      throw new InvariantError('Resolved microservice runtime does not implement emit().');
    }

    await this.runtime.emit(pattern, payload);
  }

  async close(signal?: string): Promise<void> {
    if (this.closed) {
      return;
    }

    if (this.closingPromise) {
      await this.closingPromise;
      return;
    }

    this.closingPromise = (async () => {
      await this.context.close(signal);
      this.closed = true;
      this.microserviceState = 'closed';
    })();

    try {
      await this.closingPromise;
    } catch (error) {
      this.closingPromise = undefined;
      throw error;
    }
  }
}

/**
 * lifecycle hook이 있는 singleton provider 인스턴스를 미리 해석해 둔다.
 */
async function resolveLifecycleInstances(container: Container, providers: Provider[]): Promise<unknown[]> {
  const instances: unknown[] = [];
  const seen = new Set<Token>();

  for (const provider of providers) {
    const scope = providerScope(provider);

    if (scope === 'request' || scope === 'transient') {
      continue;
    }

    const token = providerToken(provider);

    if (seen.has(token)) {
      continue;
    }

    seen.add(token);
    instances.push(await container.resolve(token));
  }

  return instances;
}

/**
 * 부트스트랩 단계의 hook을 고정된 순서로 실행한다.
 */
async function runBootstrapHooks(instances: unknown[]): Promise<void> {
  for (const instance of instances) {
    if (isOnModuleInit(instance)) {
      await instance.onModuleInit();
    }
  }

  for (const instance of instances) {
    if (isOnApplicationBootstrap(instance)) {
      await instance.onApplicationBootstrap();
    }
  }
}

/**
 * 종료 단계의 hook을 역순으로 실행해 이미 시작한 리소스를 정리한다.
 */
async function runShutdownHooks(instances: readonly unknown[], signal?: string): Promise<void> {
  for (const instance of [...instances].reverse()) {
    if (isOnModuleDestroy(instance)) {
      await instance.onModuleDestroy();
    }
  }

  for (const instance of [...instances].reverse()) {
    if (isOnApplicationShutdown(instance)) {
      await instance.onApplicationShutdown(signal);
    }
  }
}

function createHandlerSources(modules: CompiledModule[]): HandlerSource[] {
  return modules.flatMap((compiledModule) =>
    (compiledModule.definition.controllers ?? []).map((controllerToken) => ({
      controllerToken,
      moduleMiddleware: compiledModule.definition.middleware ?? [],
      moduleType: compiledModule.type,
    })),
  );
}

function logCompiledModules(logger: ApplicationLogger, modules: CompiledModule[]): void {
  for (const compiledModule of modules) {
    logger.log(`${compiledModule.type.name} dependencies initialized`, 'InstanceLoader');
  }
}

function logRouteMappings(
  logger: ApplicationLogger,
  descriptors: ReturnType<typeof createHandlerMapping>['descriptors'],
): void {
  const byController = new Map<string, { controllerPath: string; descriptors: typeof descriptors }>();

  for (const descriptor of descriptors) {
    const key = descriptor.controllerToken.name;
    const current = byController.get(key);

    if (current) {
      current.descriptors.push(descriptor);
      continue;
    }

    byController.set(key, {
      controllerPath: descriptor.metadata.controllerPath || '/',
      descriptors: [descriptor],
    });
  }

  for (const [controllerName, value] of byController) {
    logger.log(`${controllerName} {${value.controllerPath}}`, 'RoutesResolver');

    for (const descriptor of value.descriptors) {
      logger.log(`Mapped {${descriptor.route.path}, ${descriptor.route.method}} route`, 'RouterExplorer');
    }
  }
}

function createRuntimeProviders(
  options: { readonly providers?: Provider[] },
  logger: ApplicationLogger,
): Provider[] {
  return [
    ...(options.providers ?? []),
    {
      provide: APPLICATION_LOGGER,
      useValue: logger,
    },
  ];
}

function registerRuntimeBootstrapTokens(
  bootstrapped: BootstrapResult,
  adapter: HttpApplicationAdapter,
  platformShell: RuntimePlatformShell,
): void {
  registerRuntimeContextTokens(bootstrapped, {
    provide: HTTP_APPLICATION_ADAPTER,
    useValue: adapter,
  }, {
    provide: PLATFORM_SHELL,
    useValue: platformShell,
  });
}

function registerRuntimeContextTokens(bootstrapped: BootstrapResult, ...providers: Provider[]): void {
  bootstrapped.container.register(
    ...providers,
    {
      provide: RUNTIME_CONTAINER,
      useValue: bootstrapped.container,
    },
    {
      provide: COMPILED_MODULES,
      useValue: bootstrapped.modules,
    },
  );
}

function registerRuntimeApplicationContextTokens(bootstrapped: BootstrapResult, platformShell: RuntimePlatformShell): void {
  registerRuntimeContextTokens(bootstrapped, {
    provide: PLATFORM_SHELL,
    useValue: platformShell,
  });
}

async function resolveBootstrapLifecycleInstances(
  bootstrapped: BootstrapResult,
  runtimeProviders: Provider[],
): Promise<unknown[]> {
  const lifecycleProviders = [
    ...runtimeProviders,
    ...bootstrapped.modules.flatMap((compiledModule) => compiledModule.definition.providers ?? []),
  ];

  return resolveLifecycleInstances(bootstrapped.container, lifecycleProviders);
}

async function runBootstrapLifecycle(
  modules: CompiledModule[],
  lifecycleInstances: unknown[],
  logger: ApplicationLogger,
  platformShell: RuntimePlatformShell,
): Promise<void> {
  resetReadinessState(modules);
  await runBootstrapHooks(lifecycleInstances);
  await platformShell.start();
  markReadinessState(modules);
  logCompiledModules(logger, modules);
}

type DispatcherOptions = Parameters<typeof createDispatcher>[0];
type ErrorHandler = (
  error: unknown,
  request: FrameworkRequest,
  response: FrameworkResponse,
  requestId?: string,
) => Promise<boolean>;

type ErrorAwareDispatcherOptions = DispatcherOptions & {
  onError?: ErrorHandler;
};

function createFilterErrorHandler(
  filters: readonly ExceptionFilterHandler[] | undefined,
): ErrorHandler | undefined {
  if (!filters || filters.length === 0) {
    return undefined;
  }

  return async (error, request, response, requestId) =>
    runExceptionFilters(filters, error, request, response, requestId);
}

function createRuntimeDispatcherOptions(
  bootstrapped: BootstrapResult,
  options: BootstrapApplicationOptions,
  handlerMapping: ReturnType<typeof createHandlerMapping>,
  errorHandler: ErrorHandler | undefined,
): ErrorAwareDispatcherOptions {
  const dispatcherOptions: ErrorAwareDispatcherOptions = {
    appMiddleware: options.middleware ?? [],
    binder: new DefaultBinder(options.converters ?? []),
    handlerMapping,
    interceptors: options.interceptors ?? [],
    observers: options.observers ?? [],
    rootContainer: bootstrapped.container,
  };

  if (errorHandler) {
    dispatcherOptions.onError = errorHandler;
  }

  return dispatcherOptions;
}

function createRuntimeDispatcher(
  bootstrapped: BootstrapResult,
  options: BootstrapApplicationOptions,
  logger: ApplicationLogger,
): Dispatcher {
  const handlerMapping = createHandlerMapping(createHandlerSources(bootstrapped.modules), {
    versioning: options.versioning,
  });
  logRouteMappings(logger, handlerMapping.descriptors);

  const errorHandler = createFilterErrorHandler(options.filters);
  const dispatcherOptions = createRuntimeDispatcherOptions(
    bootstrapped,
    options,
    handlerMapping,
    errorHandler,
  );

  return createDispatcher(dispatcherOptions);
}

/**
 * Creates the runtime application shell by composing bootstrap-level providers,
 * module bootstrap, and lifecycle hook execution.
 *
 * @param options Runtime bootstrap contract including root module, adapter, and global runtime hooks.
 * @returns A fully bootstrapped `Application` shell ready for `ready()`/`listen()`.
 * @throws {Error} Propagates module-graph, lifecycle, or runtime initialization failures.
 */
export async function bootstrapApplication(options: BootstrapApplicationOptions): Promise<Application> {
  const logger = options.logger ?? createConsoleApplicationLogger();
  let lifecycleInstances: unknown[] = [];
  let bootstrappedContainer: Container | undefined;
  const hasHttpAdapter = options.adapter !== undefined;
  const adapter = options.adapter ?? {
    async close() {},
    async listen() {},
  };
  const runtimeCleanup: Array<() => void> = [];
  const platformShell = createRuntimePlatformShell(options.platform?.components);
  const timingEnabled = options.diagnostics?.timing === true;
  const timingStart = timingEnabled ? runtimePerformance.now() : 0;
  const timingPhases: BootstrapTimingPhase[] = [];

  try {
    logger.log('Starting Konekti application...', 'KonektiFactory');
    const runtimeProviders = createRuntimeProviders(options, logger);

    const moduleBootstrapStart = timingEnabled ? runtimePerformance.now() : 0;
    const bootstrapped = bootstrapModule(options.rootModule, {
      duplicateProviderPolicy: options.duplicateProviderPolicy,
      logger,
      providers: runtimeProviders,
      validationTokens: [RUNTIME_CONTAINER, COMPILED_MODULES, HTTP_APPLICATION_ADAPTER],
    });
    if (timingEnabled) {
      timingPhases.push({
        durationMs: runtimePerformance.now() - moduleBootstrapStart,
        name: 'bootstrap_module',
      });
    }

    const registerTokensStart = timingEnabled ? runtimePerformance.now() : 0;
    registerRuntimeBootstrapTokens(bootstrapped, adapter, platformShell);
    if (timingEnabled) {
      timingPhases.push({
        durationMs: runtimePerformance.now() - registerTokensStart,
        name: 'register_runtime_tokens',
      });
    }

    bootstrappedContainer = bootstrapped.container;

    const resolveLifecycleStart = timingEnabled ? runtimePerformance.now() : 0;
    lifecycleInstances = await resolveBootstrapLifecycleInstances(bootstrapped, runtimeProviders);
    lifecycleInstances.push({
      onModuleDestroy() {
        return platformShell.stop();
      },
    });
    if (timingEnabled) {
      timingPhases.push({
        durationMs: runtimePerformance.now() - resolveLifecycleStart,
        name: 'resolve_lifecycle_instances',
      });
    }

    const lifecycleStart = timingEnabled ? runtimePerformance.now() : 0;
    await runBootstrapLifecycle(bootstrapped.modules, lifecycleInstances, logger, platformShell);
    if (timingEnabled) {
      timingPhases.push({
        durationMs: runtimePerformance.now() - lifecycleStart,
        name: 'run_bootstrap_lifecycle',
      });
    }

    const dispatcherStart = timingEnabled ? runtimePerformance.now() : 0;
    const dispatcher = createRuntimeDispatcher(bootstrapped, options, logger);
    if (timingEnabled) {
      timingPhases.push({
        durationMs: runtimePerformance.now() - dispatcherStart,
        name: 'create_dispatcher',
      });
    }

    const bootstrapTiming = timingEnabled
      ? createBootstrapTimingDiagnostics(timingPhases, runtimePerformance.now() - timingStart)
      : undefined;

    return new KonektiApplication(
      bootstrapped.container,
      bootstrapped.modules,
      options.rootModule,
      dispatcher,
      bootstrapTiming,
      adapter,
      hasHttpAdapter,
      platformShell,
      lifecycleInstances,
      logger,
      runtimeCleanup,
    );
  } catch (error: unknown) {
    logger.error(
      'Failed to bootstrap application. Check the error below for what failed and how to fix it.',
      error,
      'KonektiFactory',
    );

    await runBootstrapFailureCleanup({
      container: bootstrappedContainer,
      lifecycleInstances,
      logger,
      runtimeCleanup,
      scope: 'application',
    });

    throw error;
  }
}

/**
 * Canonical runtime bootstrap facade for HTTP, context-only, and microservice startup.
 */
export class KonektiFactory {
  /**
   * Creates a full HTTP-capable application from the root module.
   *
   * @param rootModule Root module type used as the application composition entrypoint.
   * @param options Optional HTTP-runtime bootstrap options.
   * @returns A bootstrapped HTTP-capable `Application`.
   * @throws {Error} Propagates bootstrap failures from `bootstrapApplication(...)`.
   */
  static async create(rootModule: ModuleType, options: CreateApplicationOptions = {}): Promise<Application> {
    return bootstrapApplication({
      ...options,
      rootModule,
    });
  }

  /**
   * Creates an application context without attaching an HTTP runtime.
   *
   * @param rootModule Root module type used as the context composition entrypoint.
   * @param options Optional context bootstrap options.
   * @returns A bootstrapped `ApplicationContext` that exposes DI and lifecycle control.
   * @throws {Error} Propagates module-graph, lifecycle, and context bootstrap failures.
   */
  static async createApplicationContext(
    rootModule: ModuleType,
    options: CreateApplicationContextOptions = {},
  ): Promise<ApplicationContext> {
    const logger = options.logger ?? createConsoleApplicationLogger();
    let lifecycleInstances: unknown[] = [];
    let bootstrappedContainer: Container | undefined;
    const runtimeCleanup: Array<() => void> = [];
    const platformShell = createRuntimePlatformShell(options.platform?.components);
    const timingEnabled = options.diagnostics?.timing === true;
  const timingStart = timingEnabled ? runtimePerformance.now() : 0;
    const timingPhases: BootstrapTimingPhase[] = [];

    try {
      logger.log('Starting Konekti application context...', 'KonektiFactory');
      const runtimeProviders = createRuntimeProviders(options, logger);

  const moduleBootstrapStart = timingEnabled ? runtimePerformance.now() : 0;
      const bootstrapped = bootstrapModule(rootModule, {
        duplicateProviderPolicy: options.duplicateProviderPolicy,
        logger,
        providers: runtimeProviders,
        validationTokens: [RUNTIME_CONTAINER, COMPILED_MODULES],
      });
      if (timingEnabled) {
        timingPhases.push({
        durationMs: runtimePerformance.now() - moduleBootstrapStart,
          name: 'bootstrap_module',
        });
      }

    const registerTokensStart = timingEnabled ? runtimePerformance.now() : 0;
      registerRuntimeApplicationContextTokens(bootstrapped, platformShell);
      if (timingEnabled) {
        timingPhases.push({
        durationMs: runtimePerformance.now() - registerTokensStart,
          name: 'register_runtime_tokens',
        });
      }

      bootstrappedContainer = bootstrapped.container;

    const resolveLifecycleStart = timingEnabled ? runtimePerformance.now() : 0;
      lifecycleInstances = await resolveBootstrapLifecycleInstances(bootstrapped, runtimeProviders);
      lifecycleInstances.push({
        onModuleDestroy() {
          return platformShell.stop();
        },
      });
      if (timingEnabled) {
        timingPhases.push({
        durationMs: runtimePerformance.now() - resolveLifecycleStart,
          name: 'resolve_lifecycle_instances',
        });
      }

    const lifecycleStart = timingEnabled ? runtimePerformance.now() : 0;
      await runBootstrapLifecycle(bootstrapped.modules, lifecycleInstances, logger, platformShell);
      if (timingEnabled) {
        timingPhases.push({
        durationMs: runtimePerformance.now() - lifecycleStart,
          name: 'run_bootstrap_lifecycle',
        });
      }

      const bootstrapTiming = timingEnabled
    ? createBootstrapTimingDiagnostics(timingPhases, runtimePerformance.now() - timingStart)
        : undefined;

      return new KonektiApplicationContext(
        bootstrapped.container,
        bootstrapped.modules,
        rootModule,
        bootstrapTiming,
        lifecycleInstances,
        runtimeCleanup,
      );
    } catch (error: unknown) {
      logger.error(
        'Failed to bootstrap application context. Check the error below for what failed and how to fix it.',
        error,
        'KonektiFactory',
      );

      await runBootstrapFailureCleanup({
        container: bootstrappedContainer,
        lifecycleInstances,
        logger,
        runtimeCleanup,
        scope: 'application context',
      });

      throw error;
    }
  }

  /**
   * Creates a microservice application from the configured runtime token.
   *
   * @param rootModule Root module type used as the microservice composition entrypoint.
   * @param options Optional microservice bootstrap options, including `microserviceToken` overrides.
   * @returns A bootstrapped `MicroserviceApplication` wrapper around the resolved runtime transport.
   * @throws {InvariantError} When the resolved runtime token does not implement `listen()`.
   * @throws {Error} Propagates application-context bootstrap or runtime-resolution failures.
   */
  static async createMicroservice(
    rootModule: ModuleType,
    options: CreateMicroserviceOptions = {},
  ): Promise<MicroserviceApplication> {
    const logger = options.logger ?? createConsoleApplicationLogger();
    const microserviceToken = options.microserviceToken ?? DEFAULT_MICROSERVICE_TOKEN;
    const context = await KonektiFactory.createApplicationContext(rootModule, options);

    try {
      const runtime = await context.get<unknown>(microserviceToken);

      if (!isMicroserviceRuntime(runtime)) {
        throw new InvariantError('Resolved microservice token does not implement listen().');
      }

      return new KonektiMicroserviceApplication(context, logger, runtime);
    } catch (error) {
      await context.close('bootstrap-failed');
      logger.error(
        'Failed to bootstrap microservice context. Check the error below for what failed and how to fix it.',
        error,
        'KonektiFactory',
      );
      throw error;
    }
  }
}
