import { InvariantError, type Token } from '@fluojs/core';
import { Container, type Provider } from '@fluojs/di';
import { createDispatcher, createHandlerMapping, type Dispatcher, type FrameworkRequest, type FrameworkResponse, type HandlerDescriptor, type HandlerSource, type HttpApplicationAdapter } from '@fluojs/http/portable';
import { applyStudioDevtoolsApplicationOptions, applyStudioDevtoolsContextOptions, createStudioDevtoolsRuntimeFromConfig, publishStudioBootstrapSnapshot } from './devtools/studio-runtime.js';
import { DuplicateProviderError } from './errors.js';
import { type BootstrapTimingPhase, createBootstrapTimingDiagnostics } from './health/diagnostics.js';
import { createHttpAdapterMiddleware } from './http-application-options.js';
import { FluoApplication } from './internal/application.js';
import { FluoApplicationContext } from './internal/application-context.js';
import { createContextCacheableTokenSet } from './internal/context-resolution.js';
import { RuntimeDefaultBinder } from './internal/http-runtime.js';
import { type MutableBootstrapReadySignal, resolveBootstrapLifecycleInstances, runBootstrapLifecycle } from './internal/lifecycle.js';
import { DEFAULT_MICROSERVICE_TOKEN, FluoMicroserviceApplication, isMicroserviceRuntime } from './internal/microservice-application.js';
import { isMultiProvider } from './internal/provider-policy.js';
import { createRuntimeCleanupRegistration, runBootstrapFailureCleanup, type RuntimeCleanupCallback } from './internal/runtime-resources.js';
import { createDefaultApplicationLogger } from './logging/default-logger.js';
import { defineModule } from './module-definition.js';
import { compileModuleGraph, providerToken } from './module-graph.js';
import { createRuntimePlatformShell, type RuntimePlatformShell } from './platform-shell.js';
import type { BootstrapReadySignal } from './tokens.js';
import { APPLICATION_LOGGER, BOOTSTRAP_PROVIDER_TOKENS, BOOTSTRAP_READY_SIGNAL, COMPILED_MODULES, HTTP_APPLICATION_ADAPTER, PLATFORM_SHELL, RUNTIME_CLEANUP_REGISTRATION, RUNTIME_CONTAINER } from './tokens.js';
import type { Application, ApplicationContext, ApplicationLogger, BootstrapApplicationOptions, BootstrapEffectiveProviders, BootstrapModuleOptions, BootstrapResult, CompiledModule, CreateApplicationContextOptions, CreateApplicationOptions, CreateMicroserviceOptions, ExceptionFilterHandler, MicroserviceApplication, ModuleType } from './types.js';

export { defineModule };

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

function createBootstrapReadySignal(): MutableBootstrapReadySignal {
  let markReady!: () => void;
  let markFailed!: (error: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    markReady = resolve;
    markFailed = reject;
  });

  ready.catch(() => undefined);

  return {
    markFailed,
    markReady,
    wait() {
      return ready;
    },
  };
}

type DuplicateProviderPolicy = Exclude<BootstrapModuleOptions['duplicateProviderPolicy'], undefined>;

interface SelectedProviderEntry {
  moduleName: string;
  moduleType?: ModuleType;
  provider: Provider;
  source: 'module' | 'runtime';
  token: Token;
}

function createDuplicateProviderMessage(token: Token, moduleName: string, existingModuleName: string): string {
  const tokenLabel = typeof token === 'function' ? token.name || '<anonymous>' : String(token);
  return `Duplicate provider token "${tokenLabel}" registered in module "${moduleName}". Previously registered in module "${existingModuleName}".`;
}

function createDuplicateRuntimeProviderMessage(token: Token): string {
  const tokenLabel = typeof token === 'function' ? token.name || '<anonymous>' : String(token);
  return `Duplicate runtime provider token "${tokenLabel}" registered.`;
}

function handleDuplicateProvider(
  token: Token,
  moduleName: string,
  existingModuleName: string,
  policy: DuplicateProviderPolicy,
  logger?: ApplicationLogger,
): void {
  const message = createDuplicateProviderMessage(token, moduleName, existingModuleName);

  if (policy === 'throw') {
    throw new DuplicateProviderError(message, {
      module: moduleName,
      token,
      phase: 'provider registration',
      hint: `Remove the duplicate registration from one of the modules, use container.override() for intentional replacements, or set duplicateProviderPolicy to 'warn' or 'ignore'.`,
    });
  }

  if (policy === 'warn') {
    logger?.warn(message, 'BootstrapModule');
  }
}

function handleDuplicateRuntimeProvider(
  token: Token,
  policy: DuplicateProviderPolicy,
  logger?: ApplicationLogger,
): void {
  const message = createDuplicateRuntimeProviderMessage(token);

  if (policy === 'throw') {
    throw new DuplicateProviderError(message, {
      module: '<runtime>',
      token,
      phase: 'provider registration',
      hint: `Remove the duplicate runtime provider registration, use container.override() after bootstrap for intentional replacements, or set duplicateProviderPolicy to 'warn' or 'ignore'.`,
    });
  }

  if (policy === 'warn') {
    logger?.warn(message, 'BootstrapModule');
  }
}

function selectEffectiveBootstrapProviders(
  modules: CompiledModule[],
  runtimeProviders: Provider[] | undefined,
  rootModule: ModuleType,
  policy: DuplicateProviderPolicy,
  logger?: ApplicationLogger,
): BootstrapEffectiveProviders {
  const selectedRuntimeProviderIndexes = new Map<Token, number>();
  const selectedModuleProviderIndexes = new Map<Token, number>();
  const runtimeMultiTokens = new Set<Token>();
  const runtimeSingleTokens = new Set<Token>();
  const runtimeProviderEntries: SelectedProviderEntry[] = [];
  const moduleProviderEntries: SelectedProviderEntry[] = [];

  for (const runtimeProvider of runtimeProviders ?? []) {
    const token = providerToken(runtimeProvider);
    const multi = isMultiProvider(runtimeProvider);
    const existingRuntimeProviderIndex = selectedRuntimeProviderIndexes.get(token);

    if (multi) {
      runtimeMultiTokens.add(token);
    } else {
      runtimeSingleTokens.add(token);
    }

    if (!multi && existingRuntimeProviderIndex !== undefined) {
      handleDuplicateRuntimeProvider(token, policy, logger);
    }

    runtimeProviderEntries.push({
      moduleName: '<runtime>',
      provider: runtimeProvider,
      source: 'runtime',
      token,
    });

    if (!multi) {
      selectedRuntimeProviderIndexes.set(token, runtimeProviderEntries.length - 1);
    }
  }

  for (const compiledModule of modules) {
    for (const provider of compiledModule.definition.providers ?? []) {
      const token = providerToken(provider);
      const multi = isMultiProvider(provider);
      const existingModuleProviderIndex = selectedModuleProviderIndexes.get(token);
      const existing = existingModuleProviderIndex === undefined
        ? undefined
        : moduleProviderEntries[existingModuleProviderIndex];

      if (!multi && existing && existing.source === 'module') {
        handleDuplicateProvider(token, compiledModule.type.name, existing.moduleName, policy, logger);
      }

      const entry: SelectedProviderEntry = {
        moduleName: compiledModule.type.name,
        moduleType: compiledModule.type,
        provider,
        source: 'module',
        token,
      };

      moduleProviderEntries.push(entry);

      if (!multi) {
        selectedModuleProviderIndexes.set(token, moduleProviderEntries.length - 1);
      }
    }
  }

  const selectedModuleProviderIndexesSet = new Set(selectedModuleProviderIndexes.values());
  const selectedRuntimeProviderIndexesSet = new Set(selectedRuntimeProviderIndexes.values());
  const moduleProviders: Provider[] = [];
  const rootModuleProviders: Provider[] = [];
  const effectiveRuntimeProviders = runtimeProviderEntries
    .filter((entry, index) => isMultiProvider(entry.provider) || selectedRuntimeProviderIndexesSet.has(index))
    .map((entry) => entry.provider);

  moduleProviderEntries.forEach((entry, index) => {
    const multi = isMultiProvider(entry.provider);

    if (entry.source !== 'module' || (!multi && !selectedModuleProviderIndexesSet.has(index))) {
      return;
    }

    if (runtimeSingleTokens.has(entry.token) || (runtimeMultiTokens.has(entry.token) && !multi)) {
      return;
    }

    moduleProviders.push(entry.provider);

    if (entry.moduleType === rootModule) {
      rootModuleProviders.push(entry.provider);
    }
  });

  return {
    moduleProviders,
    rootModuleProviders,
    runtimeProviders: effectiveRuntimeProviders,
  };
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
  const effectiveProviders = selectEffectiveBootstrapProviders(
    modules,
    runtimeProviders,
    rootModule,
    policy,
    options.logger,
  );

  if (effectiveProviders.runtimeProviders.length > 0) {
    container.register(...effectiveProviders.runtimeProviders);
  }

  if (effectiveProviders.moduleProviders.length > 0) {
    container.register(...effectiveProviders.moduleProviders);
  }

  registerControllers(container, modules);
  registerModuleMiddleware(container, modules);

  return {
    container,
    effectiveProviders,
    modules,
    rootModule,
  };
}

function createHandlerSources(modules: CompiledModule[]): HandlerSource[] {
  const globalModules = modules.filter((compiledModule) => compiledModule.definition.global);

  return modules.flatMap((compiledModule) =>
    (compiledModule.definition.controllers ?? []).map((controllerToken) => ({
      controllerToken,
      moduleMiddleware: [
        ...globalModules
          .filter((globalModule) => globalModule !== compiledModule)
          .flatMap((globalModule) => globalModule.definition.middleware ?? []),
        ...(compiledModule.definition.middleware ?? []),
      ],
      moduleType: compiledModule.type,
    })),
  );
}

function logRouteMappings(
  logger: ApplicationLogger,
  descriptors: ReturnType<typeof createHandlerMapping>['descriptors'],
): void {
  const byController = new Map<string, { controllerPath: string; descriptors: HandlerDescriptor[] }>();

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
  const bootstrapProviderTokens = new Set((options.providers ?? []).map(providerToken));

  return [
    ...(options.providers ?? []),
    {
      provide: BOOTSTRAP_PROVIDER_TOKENS,
      useValue: bootstrapProviderTokens,
    },
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
  runtimeCleanup: RuntimeCleanupCallback[],
  bootstrapReadySignal: BootstrapReadySignal,
): void {
  registerRuntimeContextTokens(bootstrapped, {
    provide: HTTP_APPLICATION_ADAPTER,
    useValue: adapter,
  }, {
    provide: PLATFORM_SHELL,
    useValue: platformShell,
  }, {
    provide: RUNTIME_CLEANUP_REGISTRATION,
    useValue: createRuntimeCleanupRegistration(runtimeCleanup),
  }, {
    provide: BOOTSTRAP_READY_SIGNAL,
    useValue: bootstrapReadySignal,
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

function registerRuntimeApplicationContextTokens(
  bootstrapped: BootstrapResult,
  platformShell: RuntimePlatformShell,
  runtimeCleanup: RuntimeCleanupCallback[],
  bootstrapReadySignal: BootstrapReadySignal,
): void {
  registerRuntimeContextTokens(bootstrapped, {
    provide: PLATFORM_SHELL,
    useValue: platformShell,
  }, {
    provide: RUNTIME_CLEANUP_REGISTRATION,
    useValue: createRuntimeCleanupRegistration(runtimeCleanup),
  }, {
    provide: BOOTSTRAP_READY_SIGNAL,
    useValue: bootstrapReadySignal,
  });
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
  logger: ApplicationLogger,
): ErrorAwareDispatcherOptions {
  const converters = options.converters ?? [];
  const dispatcherOptions: ErrorAwareDispatcherOptions = {
    appMiddleware: options.middleware ?? [],
    ...(options.contentNegotiation === undefined
      ? {}
      : { contentNegotiation: options.contentNegotiation }),
    ...(options.conditionalRequest === undefined
      ? {}
      : { conditionalRequest: options.conditionalRequest }),
    ...(options.errorRepresentation === undefined
      ? {}
      : { errorRepresentation: options.errorRepresentation }),
    handlerMapping,
    interceptors: options.interceptors ?? [],
    logger,
    observers: options.observers ?? [],
    requestScope: {
      converterDefinitions: converters,
    },
    rootContainer: bootstrapped.container,
  };

  if (options.binder !== undefined || converters.length > 0) {
    const defaultBinder = new RuntimeDefaultBinder(converters);
    const binder = options.binder === undefined ? defaultBinder : options.binder(defaultBinder);
    if (typeof binder !== 'object' || binder === null || typeof binder.bind !== 'function') {
      throw new TypeError('The bootstrap binder factory must return a Binder.');
    }
    dispatcherOptions.binder = binder;
  }

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
    logger,
  );

  return createDispatcher(dispatcherOptions);
}

/**
 * Canonical runtime bootstrap facade for HTTP, context-only, and microservice startup.
 */
export class FluoFactory {
  /**
   * Creates an HTTP application and owns its module, dispatcher, and lifecycle assembly.
   *
   * @param rootModule Root module type used as the application composition entrypoint.
   * @param options HTTP options, portable logging, middleware, and host shutdown registration.
   * @returns A bootstrapped application; call its instance listen() and close() methods.
   * @throws {Error} Propagates the original creation failure after acquired-resource cleanup.
   */
  static async create(rootModule: ModuleType, options: CreateApplicationOptions = {}): Promise<Application> {
    const studioDevtools = options.studioDevtools ?? createStudioDevtoolsRuntimeFromConfig();
    const effectiveOptions = applyStudioDevtoolsApplicationOptions({ ...options, rootModule }, studioDevtools);
    const logger = effectiveOptions.logger ?? createDefaultApplicationLogger();
    let lifecycleInstances: unknown[] = [];
    let bootstrappedContainer: Container | undefined;
    let bootstrappedModules: CompiledModule[] = [];
    const hasHttpAdapter = effectiveOptions.adapter !== undefined;
    const adapter = effectiveOptions.adapter ?? {
      async close() {},
      async listen() {},
    };
    const runtimeCleanup: RuntimeCleanupCallback[] = [];
    if (studioDevtools) {
      runtimeCleanup.push(() => studioDevtools.close());
    }
    const bootstrapReadySignal = createBootstrapReadySignal();
    const platformShell = createRuntimePlatformShell(effectiveOptions.platform?.components);
    const timingEnabled = effectiveOptions.diagnostics?.timing === true;
    const timingStart = timingEnabled ? runtimePerformance.now() : 0;
    const timingPhases: BootstrapTimingPhase[] = [];

    try {
      logger.log('Starting fluo application...', 'FluoFactory');
      const runtimeProviders = createRuntimeProviders(effectiveOptions, logger);

      const moduleBootstrapStart = timingEnabled ? runtimePerformance.now() : 0;
      const bootstrapped = bootstrapModule(effectiveOptions.rootModule, {
        duplicateProviderPolicy: effectiveOptions.duplicateProviderPolicy,
        logger,
        moduleGraphCache: effectiveOptions.moduleGraphCache,
        providers: runtimeProviders,
        validationTokens: [
          RUNTIME_CONTAINER,
          COMPILED_MODULES,
          HTTP_APPLICATION_ADAPTER,
          RUNTIME_CLEANUP_REGISTRATION,
          BOOTSTRAP_READY_SIGNAL,
        ],
      });
      if (timingEnabled) {
        timingPhases.push({
          durationMs: runtimePerformance.now() - moduleBootstrapStart,
          name: 'bootstrap_module',
        });
      }

      const registerTokensStart = timingEnabled ? runtimePerformance.now() : 0;
      registerRuntimeBootstrapTokens(bootstrapped, adapter, platformShell, runtimeCleanup, bootstrapReadySignal);
      if (timingEnabled) {
        timingPhases.push({
          durationMs: runtimePerformance.now() - registerTokensStart,
          name: 'register_runtime_tokens',
        });
      }

      bootstrappedContainer = bootstrapped.container;
      bootstrappedModules = bootstrapped.modules;

      const resolveLifecycleStart = timingEnabled ? runtimePerformance.now() : 0;
      lifecycleInstances = await resolveBootstrapLifecycleInstances(bootstrapped, lifecycleInstances);
      lifecycleInstances.unshift({
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
      await runBootstrapLifecycle(bootstrapped.modules, lifecycleInstances, logger, platformShell, bootstrapReadySignal);
      if (timingEnabled) {
        timingPhases.push({
          durationMs: runtimePerformance.now() - lifecycleStart,
          name: 'run_bootstrap_lifecycle',
        });
      }

      const dispatcherStart = timingEnabled ? runtimePerformance.now() : 0;
      const dispatcher = createRuntimeDispatcher(bootstrapped, {
        ...effectiveOptions,
        middleware: createHttpAdapterMiddleware(effectiveOptions),
      }, logger);
      if (timingEnabled) {
        timingPhases.push({
          durationMs: runtimePerformance.now() - dispatcherStart,
          name: 'create_dispatcher',
        });
      }

      const bootstrapTiming = timingEnabled
        ? createBootstrapTimingDiagnostics(timingPhases, runtimePerformance.now() - timingStart)
        : undefined;

      publishStudioBootstrapSnapshot(studioDevtools, {
        modules: bootstrapped.modules,
        rootModule: effectiveOptions.rootModule,
        routes: dispatcher.describeRoutes?.() ?? [],
        timing: bootstrapTiming,
      });

      return new FluoApplication(
        { container: bootstrapped.container, modules: bootstrapped.modules, lifecycleInstances, runtimeCleanup },
        effectiveOptions.rootModule,
        dispatcher,
        bootstrapTiming,
        {
          adapter,
          hasHttpAdapter,
          adapterlessListenMessage: 'Application cannot listen without an HTTP adapter. Provide options.adapter for HTTP startup, or use createApplicationContext() for adapterless DI-only bootstrap.',
        },
        platformShell,
        logger,
        createContextCacheableTokenSet(
          bootstrapped.effectiveProviders,
          [
            RUNTIME_CONTAINER,
            COMPILED_MODULES,
            HTTP_APPLICATION_ADAPTER,
            PLATFORM_SHELL,
            RUNTIME_CLEANUP_REGISTRATION,
            BOOTSTRAP_READY_SIGNAL,
          ],
        ),
        effectiveOptions,
      );
    } catch (error: unknown) {
      bootstrapReadySignal.markFailed(error);
      try {
        await runBootstrapFailureCleanup({
          adapter,
          container: bootstrappedContainer,
          lifecycleInstances,
          logger,
          modules: bootstrappedModules,
          runtimeCleanup,
          scope: 'application',
        });
        logger.error(
          'Failed to bootstrap the fluo application. Check the error below for what failed and how to fix it.',
          error,
          'FluoFactory',
        );
      } catch {
        throw error;
      }
      throw error;
    }
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
    const studioDevtools = options.studioDevtools ?? createStudioDevtoolsRuntimeFromConfig();
    const effectiveOptions = applyStudioDevtoolsContextOptions(options, studioDevtools);
    const logger = createDefaultApplicationLogger();
    let lifecycleInstances: unknown[] = [];
    let bootstrappedContainer: Container | undefined;
    let bootstrappedModules: CompiledModule[] = [];
    const runtimeCleanup: RuntimeCleanupCallback[] = [];
    if (studioDevtools) {
      runtimeCleanup.push(() => studioDevtools.close());
    }
    const bootstrapReadySignal = createBootstrapReadySignal();
    const platformShell = createRuntimePlatformShell(effectiveOptions.platform?.components);
    const timingEnabled = effectiveOptions.diagnostics?.timing === true;
    const timingStart = timingEnabled ? runtimePerformance.now() : 0;
    const timingPhases: BootstrapTimingPhase[] = [];

    try {
      logger.log('Starting fluo application context...', 'FluoFactory');
      const runtimeProviders = createRuntimeProviders(effectiveOptions, logger);

      const moduleBootstrapStart = timingEnabled ? runtimePerformance.now() : 0;
      const bootstrapped = bootstrapModule(rootModule, {
        duplicateProviderPolicy: effectiveOptions.duplicateProviderPolicy,
        logger,
        moduleGraphCache: effectiveOptions.moduleGraphCache,
        providers: runtimeProviders,
        validationTokens: [RUNTIME_CONTAINER, COMPILED_MODULES, RUNTIME_CLEANUP_REGISTRATION, BOOTSTRAP_READY_SIGNAL],
      });
      if (timingEnabled) {
        timingPhases.push({
          durationMs: runtimePerformance.now() - moduleBootstrapStart,
          name: 'bootstrap_module',
        });
      }

      const registerTokensStart = timingEnabled ? runtimePerformance.now() : 0;
      registerRuntimeApplicationContextTokens(bootstrapped, platformShell, runtimeCleanup, bootstrapReadySignal);
      if (timingEnabled) {
        timingPhases.push({
          durationMs: runtimePerformance.now() - registerTokensStart,
          name: 'register_runtime_tokens',
        });
      }

      bootstrappedContainer = bootstrapped.container;
      bootstrappedModules = bootstrapped.modules;

      const resolveLifecycleStart = timingEnabled ? runtimePerformance.now() : 0;
      lifecycleInstances = await resolveBootstrapLifecycleInstances(bootstrapped, lifecycleInstances);
      lifecycleInstances.unshift({
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
      await runBootstrapLifecycle(bootstrapped.modules, lifecycleInstances, logger, platformShell, bootstrapReadySignal);
      if (timingEnabled) {
        timingPhases.push({
          durationMs: runtimePerformance.now() - lifecycleStart,
          name: 'run_bootstrap_lifecycle',
        });
      }

      const bootstrapTiming = timingEnabled
        ? createBootstrapTimingDiagnostics(timingPhases, runtimePerformance.now() - timingStart)
        : undefined;

      publishStudioBootstrapSnapshot(studioDevtools, {
        modules: bootstrapped.modules,
        rootModule,
        timing: bootstrapTiming,
      });

      return new FluoApplicationContext(
        { container: bootstrapped.container, modules: bootstrapped.modules, lifecycleInstances, runtimeCleanup },
        rootModule,
        bootstrapTiming,
        createContextCacheableTokenSet(
          bootstrapped.effectiveProviders,
          [
            RUNTIME_CONTAINER,
            COMPILED_MODULES,
            PLATFORM_SHELL,
            RUNTIME_CLEANUP_REGISTRATION,
            BOOTSTRAP_READY_SIGNAL,
          ],
        ),
      );
    } catch (error: unknown) {
      bootstrapReadySignal.markFailed(error);
      logger.error(
        'Failed to bootstrap application context. Check the error below for what failed and how to fix it.',
        error,
        'FluoFactory',
      );

      await runBootstrapFailureCleanup({
        container: bootstrappedContainer,
        lifecycleInstances,
        logger,
        modules: bootstrappedModules,
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
    const logger = createDefaultApplicationLogger();
    const microserviceToken = options.microserviceToken ?? DEFAULT_MICROSERVICE_TOKEN;
    const context = await FluoFactory.createApplicationContext(rootModule, options);

    try {
      const runtime = await context.get<unknown>(microserviceToken);

      if (!isMicroserviceRuntime(runtime)) {
        throw new InvariantError('Resolved microservice token does not implement listen().');
      }

      return new FluoMicroserviceApplication(context, logger, runtime, true);
    } catch (error) {
      try {
        await context.close('bootstrap-failed');
      } catch (cleanupError) {
        logger.error(
          'Failed to clean up after microservice bootstrap failure.',
          cleanupError,
          'FluoFactory',
        );
      }
      logger.error(
        'Failed to bootstrap microservice context. Check the error below for what failed and how to fix it.',
        error,
        'FluoFactory',
      );
      throw error;
    }
  }
}
