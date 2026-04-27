import { cloneCollection, cloneMutableValue } from './shared.js';
import type { ModuleMetadata } from './types.js';

const moduleMetadataStore = new WeakMap<Function, ModuleMetadata>();

function isValueProvider(provider: unknown): provider is { useValue: unknown } {
  return typeof provider === 'object' && provider !== null && 'useValue' in provider;
}

function cloneProviderDescriptorFields<T extends object>(provider: T): T {
  const clonedProvider = { ...provider } as T & { inject?: unknown };

  if (Array.isArray(clonedProvider.inject)) {
    clonedProvider.inject = [...clonedProvider.inject];
  }

  return clonedProvider;
}

function freezeProviderDescriptor<T extends object>(provider: T): T {
  const inject = (provider as { inject?: unknown }).inject;

  if (Array.isArray(inject)) {
    Object.freeze(inject);
  }

  return Object.freeze(provider);
}

function cloneProvider(provider: unknown): unknown {
  if (isValueProvider(provider)) {
    // Shallow-copy descriptor fields but preserve the useValue reference.
    // Deep-cloning useValue would sever object identity for externally supplied
    // instances (e.g. transport adapters) that callers hold references to.
    return freezeProviderDescriptor(cloneProviderDescriptorFields(provider));
  }

  const clonedProvider = cloneMutableValue(provider);

  return typeof clonedProvider === 'object' && clonedProvider !== null
    ? freezeProviderDescriptor(clonedProvider)
    : clonedProvider;
}

function cloneProviders(providers: readonly unknown[] | undefined): unknown[] | undefined {
  return providers ? providers.map(cloneProvider) : undefined;
}

function isMiddlewareRouteConfig(middleware: unknown): middleware is { middleware: unknown; routes: unknown } {
  return typeof middleware === 'object' && middleware !== null && 'middleware' in middleware && 'routes' in middleware;
}

function cloneMiddlewareRouteConfig<T extends { middleware: unknown; routes: unknown }>(middleware: T): T {
  const routes = Array.isArray(middleware.routes) ? Object.freeze([...middleware.routes]) : middleware.routes;

  return Object.freeze({
    ...middleware,
    routes,
  }) as T;
}

function cloneMiddleware(middleware: unknown): unknown {
  return isMiddlewareRouteConfig(middleware) ? cloneMiddlewareRouteConfig(middleware) : middleware;
}

function cloneMiddlewareCollection(middleware: readonly unknown[] | undefined): unknown[] | undefined {
  return middleware ? middleware.map(cloneMiddleware) : undefined;
}

function cloneModuleMetadata(metadata: ModuleMetadata): ModuleMetadata {
  return {
    controllers: cloneCollection(metadata.controllers),
    exports: cloneCollection(metadata.exports),
    global: metadata.global,
    imports: cloneCollection(metadata.imports),
    middleware: cloneMiddlewareCollection(metadata.middleware),
    providers: cloneProviders(metadata.providers),
  };
}

function freezeCollection<T>(collection: T[] | undefined): T[] | undefined {
  return collection ? Object.freeze(collection) as T[] : undefined;
}

function freezeModuleMetadata(metadata: ModuleMetadata): ModuleMetadata {
  return Object.freeze({
    controllers: freezeCollection(metadata.controllers),
    exports: freezeCollection(metadata.exports),
    global: metadata.global,
    imports: freezeCollection(metadata.imports),
    middleware: freezeCollection(metadata.middleware),
    providers: freezeCollection(metadata.providers),
  }) as ModuleMetadata;
}

/**
 * Defines module metadata while preserving previously written fields for partial decorator passes.
 *
 * @param target Module class receiving metadata.
 * @param metadata Partial or complete module metadata payload.
 */
export function defineModuleMetadata(target: Function, metadata: ModuleMetadata): void {
  const existing = moduleMetadataStore.get(target);

  moduleMetadataStore.set(target, freezeModuleMetadata(cloneModuleMetadata({
    controllers: metadata.controllers ?? existing?.controllers,
    exports: metadata.exports ?? existing?.exports,
    global: metadata.global !== undefined ? metadata.global : existing?.global,
    imports: metadata.imports ?? existing?.imports,
    middleware: metadata.middleware ?? existing?.middleware,
    providers: metadata.providers ?? existing?.providers,
  })));
}

/**
 * Reads frozen module metadata for the provided module class.
 *
 * @param target Module class being inspected.
 * @returns A frozen module metadata snapshot, or `undefined` when none was defined.
 */
export function getModuleMetadata(target: Function): ModuleMetadata | undefined {
  return moduleMetadataStore.get(target);
}
