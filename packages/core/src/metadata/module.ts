import { cloneCollection, cloneMutableValue } from './shared.js';
import type { ModuleMetadata } from './types.js';

const moduleMetadataStore = new WeakMap<Function, ModuleMetadata>();

function isValueProvider(provider: unknown): provider is { useValue: unknown } {
  return typeof provider === 'object' && provider !== null && 'useValue' in provider;
}

function cloneProvider(provider: unknown): unknown {
  if (isValueProvider(provider)) {
    // Shallow-copy the provider descriptor but preserve the useValue reference.
    // Deep-cloning useValue would sever object identity for externally supplied
    // instances (e.g. transport adapters) that callers hold references to.
    return { ...provider };
  }

  return cloneMutableValue(provider);
}

function cloneProviders(providers: readonly unknown[] | undefined): unknown[] | undefined {
  return providers ? providers.map(cloneProvider) : undefined;
}

function cloneModuleMetadata(metadata: ModuleMetadata): ModuleMetadata {
  return {
    controllers: cloneCollection(metadata.controllers),
    exports: cloneCollection(metadata.exports),
    global: metadata.global,
    imports: cloneCollection(metadata.imports),
    middleware: cloneCollection(metadata.middleware),
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
