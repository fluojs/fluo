import type { GeneratorFactory, GeneratorRegistration } from './generator-types.js';

import { generatorManifest } from './generators/manifest.js';

export class GeneratorRegistry {
  private readonly registry = new Map<string, GeneratorRegistration>();

  register(kind: string, factory: GeneratorFactory, description?: string): this {
    this.registry.set(kind, { factory, description });
    return this;
  }

  resolve(kind: string): GeneratorFactory | undefined {
    return this.registry.get(kind)?.factory;
  }

  has(kind: string): boolean {
    return this.registry.has(kind);
  }

  kinds(): string[] {
    return Array.from(this.registry.keys());
  }
}

export const defaultRegistry = new GeneratorRegistry();

for (const entry of generatorManifest) {
  defaultRegistry.register(entry.kind, entry.factory, entry.description);

  const registryAliases = 'registryAliases' in entry ? entry.registryAliases : undefined;
  if (registryAliases) {
    for (const alias of registryAliases) {
      defaultRegistry.register(alias, entry.factory, entry.description);
    }
  }
}
