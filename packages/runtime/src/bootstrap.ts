import { join } from 'node:path';

import { Container, type Provider } from '@konekti/di';
import { ConfigService, loadConfig } from '@konekti/config';
import { InvariantError, defineModuleMetadata, getClassDiMetadata, getOwnClassDiMetadata, getModuleMetadata, type Token } from '@konekti/core';
import {
  createDispatcher,
  createHandlerMapping,
  createNoopHttpApplicationAdapter,
  type FrameworkRequest,
  type FrameworkResponse,
  type HttpApplicationAdapter,
  type Dispatcher,
  type HandlerSource,
  type MiddlewareLike,
} from '@konekti/http';

import { DuplicateProviderError, ModuleGraphError, ModuleInjectionMetadataError, ModuleVisibilityError } from './errors.js';
import { createConsoleApplicationLogger } from './logger.js';
import { APPLICATION_LOGGER, COMPILED_MODULES, HTTP_APPLICATION_ADAPTER, RUNTIME_CONTAINER } from './tokens.js';
import type {
  Application,
  ApplicationLogger,
  ApplicationState,
  BootstrapApplicationOptions,
  BootstrapModuleOptions,
  BootstrapResult,
  CompiledModule,
  CreateApplicationOptions,
  ExceptionFilterHandler,
  ModuleDefinition,
  ModuleType,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  OnModuleDestroy,
  OnModuleInit,
} from './types.js';

function providerToken(provider: Provider): Token {
  if (typeof provider === 'function') {
    return provider;
  }

  return provider.provide;
}

function providerDependencies(provider: Provider): Token[] {
  if (typeof provider === 'function') {
    return getClassDiMetadata(provider)?.inject ?? [];
  }

  if ('useFactory' in provider) {
    return provider.inject ?? [];
  }

  if ('useClass' in provider) {
    return provider.inject ?? getClassDiMetadata(provider.useClass)?.inject ?? [];
  }

  return [];
}

function controllerDependencies(controller: ModuleType): Token[] {
  return getClassDiMetadata(controller)?.inject ?? [];
}

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

  return provider.scope ?? 'singleton';
}

function createRuntimeTokenSet(providers: Provider[] = []): Set<Token> {
  return new Set(providers.map((provider) => providerToken(provider)));
}

function mergeRuntimeTokenSets(providers: Provider[] = [], validationTokens: readonly Token[] = []): Set<Token> {
  return new Set<Token>([
    ...createRuntimeTokenSet(providers),
    ...validationTokens,
  ]);
}

function requiredConstructorParameters(target: Function): number {
  if (getOwnClassDiMetadata(target)?.inject !== undefined) {
    return 0;
  }

  return target.length;
}

function validateClassInjectionMetadata(
  subject: string,
  implementation: Function,
  inject: readonly Token[],
  scope: string,
  remedy: string,
): void {
  const required = requiredConstructorParameters(implementation);

  if (required === 0 || inject.length >= required) {
    return;
  }

  const missingIndex = inject.length;
  const configured = inject.length;
  const parameterWord = required === 1 ? 'parameter' : 'parameters';
  const tokenWord = configured === 1 ? 'token is' : 'tokens are';

  throw new ModuleInjectionMetadataError(
    `${subject} in ${scope} declares ${required} constructor ${parameterWord} but only ${configured} injection ${tokenWord} configured. Add ${remedy} for constructor parameter #${missingIndex}.`,
  );
}

function validateProviderInjectionMetadata(provider: Provider, scope: string): void {
  if (typeof provider === 'function') {
    validateClassInjectionMetadata(
      `Provider ${provider.name || '<anonymous>'}`,
      provider,
      getClassDiMetadata(provider)?.inject ?? [],
      scope,
      '@Inject([...]) metadata',
    );
    return;
  }

  if ('useClass' in provider) {
    const providedName = String(provider.provide);
    const implementationName = provider.useClass.name || '<anonymous>';
    const subject = provider.provide === provider.useClass
      ? `Provider ${implementationName}`
      : `Provider ${providedName} (${implementationName})`;

    validateClassInjectionMetadata(
      subject,
      provider.useClass,
      provider.inject ?? getClassDiMetadata(provider.useClass)?.inject ?? [],
      scope,
      provider.inject ? 'provider.inject entries' : '@Inject([...]) metadata or provider.inject entries',
    );
  }
}

function validateControllerInjectionMetadata(controller: ModuleType, scope: string): void {
  validateClassInjectionMetadata(
    `Controller ${controller.name || '<anonymous>'}`,
    controller,
    getClassDiMetadata(controller)?.inject ?? [],
    scope,
    '@Inject([...]) metadata',
  );
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

/**
 * Associates module metadata with a module type.
 */
export function defineModule<T extends ModuleType>(moduleType: T, definition: ModuleDefinition): T {
  defineModuleMetadata(moduleType, definition);

  return moduleType;
}

/**
 * 루트 모듈부터 시작해 모듈 그래프를 재귀적으로 컴파일하고 가시성 규칙을 검증한다.
 */
function compileModule(
  moduleType: ModuleType,
  runtimeProviderTokens: Set<Token>,
  compiled = new Map<ModuleType, CompiledModule>(),
  visiting = new Set<ModuleType>(),
  ordered: CompiledModule[] = [],
) {
  if (compiled.has(moduleType)) {
    const existing = compiled.get(moduleType);

    if (existing) {
      return existing;
    }
  }

  if (visiting.has(moduleType)) {
    throw new ModuleGraphError(`Circular module import detected for ${moduleType.name}.`);
  }

  visiting.add(moduleType);

  const rawDefinition = getModuleMetadata(moduleType);
  const definition: ModuleDefinition = rawDefinition
    ? {
        global: rawDefinition.global ?? false,
        imports: (rawDefinition.imports as ModuleType[] | undefined) ?? [],
        providers: (rawDefinition.providers as Provider[] | undefined) ?? [],
        controllers: (rawDefinition.controllers as ModuleType[] | undefined) ?? [],
        exports: (rawDefinition.exports as Token[] | undefined) ?? [],
        middleware: (rawDefinition.middleware as MiddlewareLike[] | undefined) ?? [],
      }
    : {};

  for (const imported of definition.imports ?? []) {
    compileModule(imported, runtimeProviderTokens, compiled, visiting, ordered);
  }

  const providerTokens = new Set((definition.providers ?? []).map((provider) => providerToken(provider)));

  const compiledModule: CompiledModule = {
    type: moduleType,
    definition,
    exportedTokens: new Set<Token>(),
    providerTokens,
  };

  compiled.set(moduleType, compiledModule);
  visiting.delete(moduleType);
  ordered.push(compiledModule);

  return compiledModule;
}

function validateCompiledModules(
  modules: CompiledModule[],
  runtimeProviders: Provider[],
  runtimeProviderTokens: Set<Token>,
): void {
  const compiledByType = new Map(modules.map((compiledModule) => [compiledModule.type, compiledModule]));
  const globalExportedTokens = new Set<Token>();

  for (const provider of runtimeProviders) {
    validateProviderInjectionMetadata(provider, 'bootstrap runtime');
  }

  for (const compiledModule of modules) {
    if (!compiledModule.definition.global) {
      continue;
    }

    for (const token of compiledModule.definition.exports ?? []) {
      globalExportedTokens.add(token);
    }
  }

  for (const compiledModule of modules) {
    const scope = `module ${compiledModule.type.name}`;
    const importedModules = (compiledModule.definition.imports ?? []).map((imported) => {
      const importedModule = compiledByType.get(imported);

      if (!importedModule) {
        throw new ModuleGraphError(`Imported module ${imported.name} was not compiled.`);
      }

      return importedModule;
    });
    const importedExportedTokens = new Set<Token>(
      importedModules.flatMap((imported) => Array.from(imported.exportedTokens)),
    );
    const accessibleTokens = new Set<Token>([
      ...runtimeProviderTokens,
      ...compiledModule.providerTokens,
      ...importedExportedTokens,
      ...globalExportedTokens,
    ]);

    for (const provider of compiledModule.definition.providers ?? []) {
      validateProviderInjectionMetadata(provider, scope);

      for (const token of providerDependencies(provider)) {
        if (!accessibleTokens.has(token)) {
          throw new ModuleVisibilityError(
            `Provider ${String(providerToken(provider))} in module ${compiledModule.type.name} cannot access token ${String(
              token,
            )} because it is not local, not exported by an imported module, and not visible through a global module.`,
          );
        }
      }
    }

    for (const controller of compiledModule.definition.controllers ?? []) {
      validateControllerInjectionMetadata(controller, scope);

      for (const token of controllerDependencies(controller)) {
        if (!accessibleTokens.has(token)) {
          throw new ModuleVisibilityError(
            `Controller ${controller.name} in module ${compiledModule.type.name} cannot access token ${String(
              token,
            )} because it is not local, not exported by an imported module, and not visible through a global module.`,
          );
        }
      }
    }

    const exportedTokens = new Set<Token>();

    for (const token of compiledModule.definition.exports ?? []) {
      if (!compiledModule.providerTokens.has(token) && !importedExportedTokens.has(token)) {
        throw new ModuleVisibilityError(
          `Module ${compiledModule.type.name} cannot export token ${String(
            token,
          )} because it is neither local nor re-exported from an imported module.`,
        );
      }

      exportedTokens.add(token);
    }

    compiledModule.exportedTokens = exportedTokens;
  }
}

/**
 * 모듈 그래프를 정해진 순서의 목록으로 컴파일하고 visibility 규칙을 검증한다.
 */
export function compileModuleGraph(rootModule: ModuleType, options: BootstrapModuleOptions = {}): CompiledModule[] {
  const ordered: CompiledModule[] = [];
  const runtimeProviders = options.providers ?? [];
  const runtimeProviderTokens = mergeRuntimeTokenSets(runtimeProviders, options.validationTokens ?? []);

  compileModule(rootModule, runtimeProviderTokens, new Map(), new Set(), ordered);
  validateCompiledModules(ordered, runtimeProviders, runtimeProviderTokens);

  return ordered;
}

/**
 * 최소 모듈 그래프를 부트스트랩하고 루트 컨테이너 베이스라인을 반환한다.
 */
export function bootstrapModule(rootModule: ModuleType, options: BootstrapModuleOptions = {}): BootstrapResult {
  const modules = compileModuleGraph(rootModule, options);
  const container = new Container();
  const policy = options.duplicateProviderPolicy ?? 'warn';

  if (options.providers?.length) {
    container.register(...options.providers);
  }

  const registeredProviderTokens = new Map<string | symbol | Function, string>();

  for (const compiledModule of modules) {
    for (const provider of compiledModule.definition.providers ?? []) {
      const token = providerToken(provider);
      const tokenKey = typeof token === 'function' ? token : token;
      const tokenLabel = typeof token === 'function' ? token.name || '<anonymous>' : String(token);
      const existing = registeredProviderTokens.get(tokenKey);

      if (existing !== undefined && policy !== 'ignore') {
        const message = `Duplicate provider token "${tokenLabel}" registered in module "${compiledModule.type.name}". Previously registered in module "${existing}".`;

        if (policy === 'throw') {
          throw new DuplicateProviderError(message);
        } else {
          options.logger?.warn(message, 'BootstrapModule');
        }
      } else {
        registeredProviderTokens.set(tokenKey, compiledModule.type.name);
      }

      container.register(provider);
    }

    for (const controller of compiledModule.definition.controllers ?? []) {
      container.register(controller);
    }

    for (const mw of compiledModule.definition.middleware ?? []) {
      if (typeof mw === 'object' && mw !== null && 'middleware' in mw && 'routes' in mw) {
        const token = (mw as { middleware: unknown; routes: unknown }).middleware;

        if (typeof token === 'function') {
          container.register(token as Parameters<typeof container.register>[0]);
        }

        continue;
      }

      if (typeof mw === 'function') {
        container.register(mw as Parameters<typeof container.register>[0]);
        continue;
      }

    }
  }

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

  constructor(
    readonly config: ConfigService,
    readonly container: Container,
    readonly envFile: string,
    readonly mode: BootstrapApplicationOptions['mode'],
    readonly modules: CompiledModule[],
    readonly rootModule: ModuleType,
    readonly dispatcher: Dispatcher,
    private readonly adapter: HttpApplicationAdapter,
    lifecycleInstances: unknown[],
    private readonly logger: ApplicationLogger,
  ) {
    this.lifecycleInstances = lifecycleInstances;
  }

  get state(): ApplicationState {
    return this.applicationState;
  }

  /**
   * 애플리케이션이 더 이상 닫힌 상태가 아닌지 확인한다.
   */
  async ready(): Promise<void> {
    if (this.applicationState === 'closed') {
      throw new InvariantError('Application cannot become ready after it has been closed.');
    }
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
      await runShutdownHooks(this.lifecycleInstances, signal);
      await this.adapter.close(signal);
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

/**
 * lifecycle hook이 있는 singleton provider 인스턴스를 미리 해석해 둔다.
 */
async function resolveLifecycleInstances(container: Container, providers: Provider[]): Promise<unknown[]> {
  const instances: unknown[] = [];
  const seen = new Set<Token>();

  for (const provider of providers) {
    if (providerScope(provider) === 'request' || providerScope(provider) === 'transient') {
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
async function runShutdownHooks(instances: unknown[], signal?: string): Promise<void> {
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

/**
 * 모드와 작업 디렉터리를 기준으로 실제로 사용될 env 파일 경로를 결정한다.
 */
function resolveEnvFile(options: BootstrapApplicationOptions): string {
  return options.envFile ?? join(options.cwd ?? process.cwd(), `.env.${options.mode}`);
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

/**
 * config 로딩, bootstrap-level provider 등록, 모듈 부트스트랩, lifecycle hook 실행까지를 묶어
 * 런타임 애플리케이션 셸을 만든다.
 */
export async function bootstrapApplication(options: BootstrapApplicationOptions): Promise<Application> {
  const logger = options.logger ?? createConsoleApplicationLogger();
  let lifecycleInstances: unknown[] = [];
  const adapter = options.adapter ?? createNoopHttpApplicationAdapter();

  try {
    logger.log('Starting Konekti application...', 'KonektiFactory');
    const configValues = loadConfig(options);
    const config = new ConfigService(configValues);
    const runtimeProviders: Provider[] = [
      ...(options.providers ?? []),
      {
        provide: ConfigService,
        useValue: config,
      },
      {
        provide: APPLICATION_LOGGER,
        useValue: logger,
      },
    ];
    const bootstrapped = bootstrapModule(options.rootModule, {
      duplicateProviderPolicy: options.duplicateProviderPolicy,
      logger,
      providers: runtimeProviders,
      validationTokens: [RUNTIME_CONTAINER, COMPILED_MODULES, HTTP_APPLICATION_ADAPTER],
    });
    bootstrapped.container.register(
      {
        provide: HTTP_APPLICATION_ADAPTER,
        useValue: adapter,
      },
      {
        provide: RUNTIME_CONTAINER,
        useValue: bootstrapped.container,
      },
      {
        provide: COMPILED_MODULES,
        useValue: bootstrapped.modules,
      },
    );
    resetReadinessState(bootstrapped.modules);
    const lifecycleProviders = [
      ...runtimeProviders,
      ...bootstrapped.modules.flatMap((compiledModule) => compiledModule.definition.providers ?? []),
    ];
    lifecycleInstances = await resolveLifecycleInstances(bootstrapped.container, lifecycleProviders);

    await runBootstrapHooks(lifecycleInstances);
    markReadinessState(bootstrapped.modules);
    logCompiledModules(logger, bootstrapped.modules);

    const handlerMapping = createHandlerMapping(createHandlerSources(bootstrapped.modules));
    logRouteMappings(logger, handlerMapping.descriptors);

    const dispatcher = createDispatcher({
      appMiddleware: options.middleware ?? [],
      handlerMapping,
      onError: options.filters && options.filters.length > 0
        ? async (error, request, response, requestId) => runExceptionFilters(options.filters ?? [], error, request, response, requestId)
        : undefined,
      observers: options.observers ?? [],
      rootContainer: bootstrapped.container,
    });

    return new KonektiApplication(
      config,
      bootstrapped.container,
      resolveEnvFile(options),
      options.mode,
      bootstrapped.modules,
      options.rootModule,
      dispatcher,
      adapter,
      lifecycleInstances,
      logger,
    );
  } catch (error: unknown) {
    logger.error('Failed to bootstrap application.', error, 'KonektiFactory');

    if (lifecycleInstances.length > 0) {
      await runShutdownHooks(lifecycleInstances, 'bootstrap-failed');
    }

    throw error;
  }
}

export class KonektiFactory {
  static async create(rootModule: ModuleType, options: CreateApplicationOptions): Promise<Application> {
    return bootstrapApplication({
      ...options,
      rootModule,
    });
  }
}
