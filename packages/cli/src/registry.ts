import type { GeneratorFactory, GeneratorRegistration } from './generator-types.js';

import { builtInGeneratorCollection, listGeneratorDefinitions } from './generators/manifest.js';

/** In-memory registry that maps generator tokens to factories and their owning collection. */
export class GeneratorRegistry {
  private readonly registry = new Map<string, GeneratorRegistration>();

  register(kind: string, factory: GeneratorFactory, description?: string, collectionId?: string): this {
    this.registry.set(kind, { collectionId, factory, description });
    return this;
  }

  collectionId(kind: string): string | undefined {
    return this.registry.get(kind)?.collectionId;
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

/** Default generator registry populated from the deterministic built-in collection. */
export const defaultRegistry = new GeneratorRegistry();

for (const entry of listGeneratorDefinitions()) {
  defaultRegistry.register(entry.kind, entry.factory, entry.description, builtInGeneratorCollection.id);

  const registryAliases = 'registryAliases' in entry ? entry.registryAliases : undefined;
  if (registryAliases) {
    for (const alias of registryAliases) {
      defaultRegistry.register(alias, entry.factory, entry.description, builtInGeneratorCollection.id);
    }
  }
}
