import type { Provider } from '@fluojs/di';
import type { Token } from '@fluojs/core';
import {
  getClassDiMetadata,
  getClassDiMetadataVersion,
  getModuleMetadata,
  getModuleMetadataVersion,
  getOwnClassDiMetadata,
} from '@fluojs/core/internal';
import type { MiddlewareLike } from '@fluojs/http';

import { ModuleGraphError, ModuleInjectionMetadataError, ModuleVisibilityError } from './errors.js';
import type { BootstrapModuleOptions, CompiledModule, ModuleDefinition, ModuleType } from './types.js';

/**
 * Returns the public token represented by a provider declaration.
 *
 * @param provider Provider declaration or class provider shortcut.
 * @returns The token that should be registered and resolved for the provider.
 */
export function providerToken(provider: Provider): Token {
  if (typeof provider === 'function') {
    return provider;
  }

  return provider.provide;
}

type InjectionToken = Token | ForwardRefFn | OptionalToken;

type ForwardRefFn = { __forwardRef__: true; forwardRef: () => Token };
type OptionalToken = { __optional__: true; token: Token };

type ClassDiMetadataView = {
  inject?: readonly InjectionToken[];
};

const objectTokenIds = new WeakMap<Function, number>();
const symbolTokenIds = new Map<symbol, number>();
let nextTokenId = 0;
const MODULE_GRAPH_COMPILE_ALGORITHM_VERSION = 1;
const moduleGraphCompileCache = new Map<string, readonly CompiledModule[]>();

/** Clears the process-local module graph compile cache for isolated regression tests. */
export function clearModuleGraphCompileCacheForTesting(): void {
  moduleGraphCompileCache.clear();
}

/**
 * Reads the current process-local module graph compile cache size for tests.
 *
 * @returns Number of successful compile snapshots currently retained in the cache.
 */
export function getModuleGraphCompileCacheSizeForTesting(): number {
  return moduleGraphCompileCache.size;
}

function getFunctionTokenId(token: Function): number {
  const existing = objectTokenIds.get(token);

  if (existing !== undefined) {
    return existing;
  }

  nextTokenId += 1;
  objectTokenIds.set(token, nextTokenId);

  return nextTokenId;
}

function getSymbolTokenId(token: symbol): number {
  const existing = symbolTokenIds.get(token);

  if (existing !== undefined) {
    return existing;
  }

  nextTokenId += 1;
  symbolTokenIds.set(token, nextTokenId);

  return nextTokenId;
}

function describeTokenForCacheKey(token: Token): string {
  if (typeof token === 'function') {
    return `fn:${getFunctionTokenId(token)}`;
  }

  if (typeof token === 'symbol') {
    return `sym:${getSymbolTokenId(token)}`;
  }

  return `str:${JSON.stringify(token)}`;
}

function describeInjectionTokenForCacheKey(token: InjectionToken): string {
  if (isForwardRef(token)) {
    return `forward:${describeTokenForCacheKey(token.forwardRef())}`;
  }

  if (isOptionalToken(token)) {
    return `optional:${describeTokenForCacheKey(token.token)}`;
  }

  return describeTokenForCacheKey(token);
}

function describeProviderForCacheKey(provider: Provider): string {
  if (typeof provider === 'function') {
    return `class:${describeTokenForCacheKey(provider)}`;
  }

  const provide = describeTokenForCacheKey(provider.provide);
  const multi = 'multi' in provider && provider.multi === true ? 'multi' : 'single';

  if ('useClass' in provider) {
    const inject = provider.inject?.map(describeInjectionTokenForCacheKey).join(',') ?? '';

    return `useClass:${provide}:${describeTokenForCacheKey(provider.useClass)}:${provider.scope ?? ''}:${multi}:${inject}`;
  }

  if ('useFactory' in provider) {
    const inject = provider.inject?.map(describeInjectionTokenForCacheKey).join(',') ?? '';
    const resolverClass = provider.resolverClass ? describeTokenForCacheKey(provider.resolverClass) : '';

    return `useFactory:${provide}:${getFunctionTokenId(provider.useFactory)}:${resolverClass}:${provider.scope ?? ''}:${multi}:${inject}`;
  }

  if ('useExisting' in provider) {
    return `useExisting:${provide}:${describeTokenForCacheKey(provider.useExisting)}`;
  }

  return `useValue:${provide}:${multi}`;
}

/**
 * Builds the key used for opt-in module graph compile caching.
 *
 * @param rootModule Root module that would be compiled.
 * @param options Bootstrap options that influence graph validation.
 * @returns Process-local key that changes when metadata or runtime validation inputs change.
 */
export function createModuleGraphCacheKey(rootModule: ModuleType, options: BootstrapModuleOptions = {}): string {
  const runtimeProviders = (options.providers ?? []).map(describeProviderForCacheKey).join('|');
  const validationTokens = (options.validationTokens ?? []).map(describeTokenForCacheKey).join('|');

  return [
    `root:${describeTokenForCacheKey(rootModule)}`,
    `module:${getModuleMetadataVersion()}`,
    `class-di:${getClassDiMetadataVersion()}`,
    `algorithm:${MODULE_GRAPH_COMPILE_ALGORITHM_VERSION}`,
    `runtime:${runtimeProviders}`,
    `validation:${validationTokens}`,
  ].join(';');
}

function cloneModuleDefinition(definition: ModuleDefinition): ModuleDefinition {
  return {
    global: definition.global,
    imports: definition.imports ? [...definition.imports] : undefined,
    providers: definition.providers ? definition.providers.map((provider) => cloneProvider(provider)) : undefined,
    controllers: definition.controllers ? [...definition.controllers] : undefined,
    exports: definition.exports ? [...definition.exports] : undefined,
    middleware: definition.middleware ? definition.middleware.map((middleware) => cloneMutableValue(middleware)) : undefined,
  };
}

function cloneMutableValue<T>(value: T, clones = new WeakMap<object, unknown>()): T {
  if (typeof value !== 'object' || value === null) {
    return value;
  }

  const existing = clones.get(value);
  if (existing !== undefined) {
    return existing as T;
  }

  if (value instanceof Date) {
    return new Date(value) as T;
  }

  if (value instanceof RegExp) {
    return new RegExp(value) as T;
  }

  if (Array.isArray(value)) {
    const clonedArray: unknown[] = [];
    clones.set(value, clonedArray);

    for (const item of value) {
      clonedArray.push(cloneMutableValue(item, clones));
    }

    return clonedArray as T;
  }

  if (value instanceof Map) {
    const clonedMap = new Map<unknown, unknown>();
    clones.set(value, clonedMap);

    for (const [key, entryValue] of value) {
      clonedMap.set(cloneMutableValue(key, clones), cloneMutableValue(entryValue, clones));
    }

    return clonedMap as T;
  }

  if (value instanceof Set) {
    const clonedSet = new Set<unknown>();
    clones.set(value, clonedSet);

    for (const entryValue of value) {
      clonedSet.add(cloneMutableValue(entryValue, clones));
    }

    return clonedSet as T;
  }

  const source = value as Record<PropertyKey, unknown>;
  const prototype = Object.getPrototypeOf(value) as object | null;
  const clonedObject = Object.create(prototype) as Record<PropertyKey, unknown>;
  clones.set(value, clonedObject);

  for (const key of Reflect.ownKeys(source)) {
    clonedObject[key] = cloneMutableValue(source[key], clones);
  }

  return clonedObject as T;
}

function cloneInjectionToken(token: InjectionToken): InjectionToken {
  if (isForwardRef(token)) {
    return {
      __forwardRef__: true,
      forwardRef: token.forwardRef,
    };
  }

  if (isOptionalToken(token)) {
    return {
      __optional__: true,
      token: token.token,
    };
  }

  return token;
}

function cloneProvider(provider: Provider): Provider {
  if (typeof provider === 'function') {
    return provider;
  }

  if ('useClass' in provider) {
    return {
      ...provider,
      ...(provider.inject ? { inject: provider.inject.map((token) => cloneInjectionToken(token)) } : {}),
    };
  }

  if ('useFactory' in provider) {
    return {
      ...provider,
      ...(provider.inject ? { inject: provider.inject.map((token) => cloneInjectionToken(token)) } : {}),
    };
  }

  if ('useValue' in provider) {
    return {
      ...provider,
      useValue: cloneMutableValue(provider.useValue),
    };
  }

  return { ...provider };
}

function cloneCompiledModule(compiledModule: CompiledModule): CompiledModule {
  return {
    type: compiledModule.type,
    definition: cloneModuleDefinition(compiledModule.definition),
    accessibleTokens: new Set(compiledModule.accessibleTokens),
    exportedTokens: new Set(compiledModule.exportedTokens),
    importedExportedTokens: new Set(compiledModule.importedExportedTokens),
    providerTokens: new Set(compiledModule.providerTokens),
  };
}

function cloneCompiledModules(modules: readonly CompiledModule[]): CompiledModule[] {
  return modules.map((compiledModule) => cloneCompiledModule(compiledModule));
}

function freezeInjectionToken(token: InjectionToken): InjectionToken {
  if (isForwardRef(token) || isOptionalToken(token)) {
    Object.freeze(token);
  }

  return token;
}

function freezeMutableValue<T>(value: T, frozen = new WeakSet<object>()): T {
  if (typeof value !== 'object' || value === null || frozen.has(value)) {
    return value;
  }

  frozen.add(value);

  if (value instanceof Map) {
    for (const [key, entryValue] of value) {
      freezeMutableValue(key, frozen);
      freezeMutableValue(entryValue, frozen);
    }
  } else if (value instanceof Set) {
    for (const entryValue of value) {
      freezeMutableValue(entryValue, frozen);
    }
  } else {
    const source = value as Record<PropertyKey, unknown>;
    for (const key of Reflect.ownKeys(source)) {
      freezeMutableValue(source[key], frozen);
    }
  }

  Object.freeze(value);

  return value;
}

function freezeProvider(provider: Provider): Provider {
  if (typeof provider === 'function') {
    return provider;
  }

  if ('inject' in provider && provider.inject) {
    for (const token of provider.inject) {
      freezeInjectionToken(token);
    }
    Object.freeze(provider.inject);
  }

  if ('useValue' in provider) {
    freezeMutableValue(provider.useValue);
  }

  return Object.freeze(provider);
}

function freezeMiddleware(middleware: MiddlewareLike): MiddlewareLike {
  if (typeof middleware === 'object' && middleware !== null) {
    freezeMutableValue(middleware);
  }

  return middleware;
}

function freezeModuleDefinition(definition: ModuleDefinition): ModuleDefinition {
  definition.imports && Object.freeze(definition.imports);
  for (const provider of definition.providers ?? []) {
    freezeProvider(provider);
  }
  definition.providers && Object.freeze(definition.providers);
  definition.controllers && Object.freeze(definition.controllers);
  definition.exports && Object.freeze(definition.exports);
  for (const middleware of definition.middleware ?? []) {
    freezeMiddleware(middleware);
  }
  definition.middleware && Object.freeze(definition.middleware);

  return Object.freeze(definition);
}

function freezeCompiledModule(compiledModule: CompiledModule): CompiledModule {
  freezeModuleDefinition(compiledModule.definition);

  return Object.freeze(compiledModule);
}

function createModuleGraphCacheSnapshot(modules: readonly CompiledModule[]): readonly CompiledModule[] {
  return Object.freeze(cloneCompiledModules(modules).map((compiledModule) => freezeCompiledModule(compiledModule)));
}

function getEffectiveClassDiMetadata(target: Function): ClassDiMetadataView | undefined {
  const metadata = getClassDiMetadata(target);

  if (!metadata) {
    return undefined;
  }

  return {
    inject: metadata.inject ? [...metadata.inject] as readonly InjectionToken[] : undefined,
  };
}

function isForwardRef(value: unknown): value is ForwardRefFn {
  return typeof value === 'object' && value !== null && '__forwardRef__' in value && (value as ForwardRefFn).__forwardRef__ === true;
}

function isOptionalToken(value: unknown): value is OptionalToken {
  return typeof value === 'object' && value !== null && '__optional__' in value && (value as OptionalToken).__optional__ === true;
}

function resolveInjectionToken(t: InjectionToken): Token {
  if (isForwardRef(t)) return t.forwardRef();
  if (isOptionalToken(t)) return t.token;
  return t;
}

function providerDependencies(provider: Provider): InjectionToken[] {
  if (typeof provider === 'function') {
    return [...(getEffectiveClassDiMetadata(provider)?.inject ?? [])];
  }

  if ('useFactory' in provider) {
    return provider.inject ?? [];
  }

  if ('useClass' in provider) {
    return provider.inject ?? [...(getEffectiveClassDiMetadata(provider.useClass)?.inject ?? [])];
  }

  return [];
}

function controllerDependencies(controller: ModuleType): InjectionToken[] {
  return [...(getEffectiveClassDiMetadata(controller)?.inject ?? [])];
}

/**
 * Collects runtime provider tokens into a set for visibility and validation checks.
 *
 * @param providers Runtime providers supplied through bootstrap options.
 * @returns A set containing each provider token exactly once.
 */
export function createRuntimeTokenSet(providers: Provider[] = []): Set<Token> {
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
  inject: readonly InjectionToken[],
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
    {
      module: scope,
      phase: 'injection metadata validation',
      hint: `Ensure ${subject} has a matching @Inject(...) decorator or provider.inject array that covers all ${required} constructor parameters. Use @Inject() for an explicit empty override.`,
    },
  );
}

function validateProviderInjectionMetadata(provider: Provider, scope: string): void {
  if (typeof provider === 'function') {
       validateClassInjectionMetadata(
         `Provider ${provider.name || '<anonymous>'}`,
         provider,
         getEffectiveClassDiMetadata(provider)?.inject ?? [],
         scope,
         '@Inject(...) metadata',
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
        provider.inject ?? getEffectiveClassDiMetadata(provider.useClass)?.inject ?? [],
        scope,
        provider.inject ? 'provider.inject entries' : '@Inject(...) metadata or provider.inject entries',
      );
  }
}

function validateControllerInjectionMetadata(controller: ModuleType, scope: string): void {
  validateClassInjectionMetadata(
    `Controller ${controller.name || '<anonymous>'}`,
    controller,
    getEffectiveClassDiMetadata(controller)?.inject ?? [],
    scope,
    '@Inject(...) metadata',
  );
}

function normalizeModuleDefinition(rawDefinition: ReturnType<typeof getModuleMetadata>): ModuleDefinition {
  if (!rawDefinition) {
    return {};
  }

  return {
    global: rawDefinition.global ?? false,
    imports: (rawDefinition.imports as ModuleType[] | undefined) ?? [],
    providers: (rawDefinition.providers as Provider[] | undefined) ?? [],
    controllers: (rawDefinition.controllers as ModuleType[] | undefined) ?? [],
    exports: (rawDefinition.exports as Token[] | undefined) ?? [],
    middleware: (rawDefinition.middleware as MiddlewareLike[] | undefined) ?? [],
  };
}

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
    throw new ModuleGraphError(
      `Circular module import detected for ${moduleType.name}.`,
      {
        module: moduleType.name,
        phase: 'module graph compilation',
        hint: 'Break the import cycle by extracting shared providers into a separate module that both sides can import independently.',
      },
    );
  }

  visiting.add(moduleType);

  const definition = normalizeModuleDefinition(getModuleMetadata(moduleType));

  for (const imported of definition.imports ?? []) {
    compileModule(imported, runtimeProviderTokens, compiled, visiting, ordered);
  }

  const providerTokens = new Set((definition.providers ?? []).map((provider) => providerToken(provider)));

  const compiledModule: CompiledModule = {
    type: moduleType,
    definition,
    accessibleTokens: new Set<Token>(),
    exportedTokens: new Set<Token>(),
    importedExportedTokens: new Set<Token>(),
    providerTokens,
  };

  compiled.set(moduleType, compiledModule);
  visiting.delete(moduleType);
  ordered.push(compiledModule);

  return compiledModule;
}

function resolveImportedModules(
  compiledModule: CompiledModule,
  compiledByType: Map<ModuleType, CompiledModule>,
): CompiledModule[] {
  return (compiledModule.definition.imports ?? []).map((imported) => {
    const importedModule = compiledByType.get(imported);

    if (!importedModule) {
      throw new ModuleGraphError(
        `Imported module ${imported.name} was not compiled.`,
        {
          module: imported.name,
          phase: 'module graph validation',
          hint: `Ensure ${imported.name} is decorated with @Module() and included in the imports array of a compiled module.`,
        },
      );
    }

    return importedModule;
  });
}

function createImportedExportedTokenSet(importedModules: CompiledModule[]): Set<Token> {
  const importedExportedTokens = new Set<Token>();

  for (const importedModule of importedModules) {
    for (const token of importedModule.exportedTokens) {
      importedExportedTokens.add(token);
    }
  }

  return importedExportedTokens;
}

function createAccessibleTokenSet(
  runtimeProviderTokens: Set<Token>,
  moduleProviderTokens: Set<Token>,
  importedExportedTokens: Set<Token>,
  globalExportedTokens: Set<Token>,
): Set<Token> {
  return new Set<Token>([
    ...runtimeProviderTokens,
    ...moduleProviderTokens,
    ...importedExportedTokens,
    ...globalExportedTokens,
  ]);
}

function memoizeAccessibleTokenSet(
  compiledModule: CompiledModule,
  importedModules: CompiledModule[],
  runtimeProviderTokens: Set<Token>,
  globalExportedTokens: Set<Token>,
): void {
  compiledModule.importedExportedTokens = createImportedExportedTokenSet(importedModules);
  compiledModule.accessibleTokens = createAccessibleTokenSet(
    runtimeProviderTokens,
    compiledModule.providerTokens,
    compiledModule.importedExportedTokens,
    globalExportedTokens,
  );
}

function validateProviderVisibility(
  compiledModule: CompiledModule,
  scope: string,
  accessibleTokens: Set<Token>,
): void {
  for (const provider of compiledModule.definition.providers ?? []) {
    validateProviderInjectionMetadata(provider, scope);

    for (const rawToken of providerDependencies(provider)) {
      const token = resolveInjectionToken(rawToken);

      if (!accessibleTokens.has(token)) {
        throw new ModuleVisibilityError(
          `Provider ${String(providerToken(provider))} in module ${compiledModule.type.name} cannot access token ${String(
            token,
          )} because it is not local, not exported by an imported module, and not visible through a global module.`,
          {
            module: compiledModule.type.name,
            token,
            phase: 'provider visibility validation',
            hint: `Add ${String(token)} to the exports array of the module that owns it, then import that module into ${compiledModule.type.name}. Alternatively, mark the owning module with @Global() to make its exports universally visible.`,
          },
        );
      }
    }
  }
}

function validateControllerVisibility(
  compiledModule: CompiledModule,
  scope: string,
  accessibleTokens: Set<Token>,
): void {
  for (const controller of compiledModule.definition.controllers ?? []) {
    validateControllerInjectionMetadata(controller, scope);

    for (const rawToken of controllerDependencies(controller)) {
      const token = resolveInjectionToken(rawToken);

      if (!accessibleTokens.has(token)) {
        throw new ModuleVisibilityError(
          `Controller ${controller.name} in module ${compiledModule.type.name} cannot access token ${String(
            token,
          )} because it is not local, not exported by an imported module, and not visible through a global module.`,
          {
            module: compiledModule.type.name,
            token,
            phase: 'controller visibility validation',
            hint: `Add ${String(token)} to the exports array of the module that owns it, then import that module into ${compiledModule.type.name}. Alternatively, mark the owning module with @Global().`,
          },
        );
      }
    }
  }
}

function createExportedTokenSet(
  compiledModule: CompiledModule,
  importedExportedTokens: Set<Token>,
): Set<Token> {
  const exportedTokens = new Set<Token>();

  for (const token of compiledModule.definition.exports ?? []) {
    if (!compiledModule.providerTokens.has(token) && !importedExportedTokens.has(token)) {
      throw new ModuleVisibilityError(
        `Module ${compiledModule.type.name} cannot export token ${String(
          token,
        )} because it is neither local nor re-exported from an imported module.`,
        {
          module: compiledModule.type.name,
          token,
          phase: 'export validation',
          hint: `Either add a provider for ${String(token)} to ${compiledModule.type.name}'s providers array, or import a module that exports ${String(token)} so it can be re-exported.`,
        },
      );
    }

    exportedTokens.add(token);
  }

  return exportedTokens;
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
    memoizeAccessibleTokenSet(
      compiledModule,
      resolveImportedModules(compiledModule, compiledByType),
      runtimeProviderTokens,
      globalExportedTokens,
    );

    validateProviderVisibility(compiledModule, scope, compiledModule.accessibleTokens);
    validateControllerVisibility(compiledModule, scope, compiledModule.accessibleTokens);
    compiledModule.exportedTokens = createExportedTokenSet(compiledModule, compiledModule.importedExportedTokens);
  }
}

/**
 * Compiles and validates the reachable module graph for a bootstrap entry module.
 *
 * @param rootModule Root application module used as the graph entrypoint.
 * @param options Bootstrap options that contribute runtime providers and validation tokens.
 * @returns Compiled modules in dependency order after visibility and injection validation succeed.
 */
export function compileModuleGraph(rootModule: ModuleType, options: BootstrapModuleOptions = {}): CompiledModule[] {
  const cacheKey = options.moduleGraphCache === true
    ? createModuleGraphCacheKey(rootModule, options)
    : undefined;

  if (cacheKey !== undefined) {
    const cachedModules = moduleGraphCompileCache.get(cacheKey);

    if (cachedModules !== undefined) {
      return cloneCompiledModules(cachedModules);
    }
  }

  const ordered: CompiledModule[] = [];
  const runtimeProviders = options.providers ?? [];
  const runtimeProviderTokens = mergeRuntimeTokenSets(runtimeProviders, options.validationTokens ?? []);

  compileModule(rootModule, runtimeProviderTokens, new Map(), new Set(), ordered);
  validateCompiledModules(ordered, runtimeProviders, runtimeProviderTokens);

  if (cacheKey !== undefined) {
    const cacheSnapshot = createModuleGraphCacheSnapshot(ordered);
    moduleGraphCompileCache.set(cacheKey, cacheSnapshot);

    return cloneCompiledModules(cacheSnapshot);
  }

  return ordered;
}
