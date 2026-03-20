import { cloneCollection } from './shared.js';
import type { ModuleMetadata } from './types.js';

const moduleMetadataStore = new WeakMap<Function, ModuleMetadata>();

function cloneModuleMetadata(metadata: ModuleMetadata): ModuleMetadata {
  return {
    controllers: cloneCollection(metadata.controllers),
    exports: cloneCollection(metadata.exports),
    global: metadata.global,
    imports: cloneCollection(metadata.imports),
    middleware: cloneCollection(metadata.middleware),
    providers: cloneCollection(metadata.providers),
  };
}

export function defineModuleMetadata(target: Function, metadata: ModuleMetadata): void {
  const existing = moduleMetadataStore.get(target);

  moduleMetadataStore.set(
    target,
    cloneModuleMetadata({
      controllers: metadata.controllers ?? existing?.controllers,
      exports: metadata.exports ?? existing?.exports,
      global: metadata.global ?? existing?.global,
      imports: metadata.imports ?? existing?.imports,
      middleware: metadata.middleware ?? existing?.middleware,
      providers: metadata.providers ?? existing?.providers,
    }),
  );
}

export function getModuleMetadata(target: Function): ModuleMetadata | undefined {
  const metadata = moduleMetadataStore.get(target);

  return metadata ? cloneModuleMetadata(metadata) : undefined;
}
