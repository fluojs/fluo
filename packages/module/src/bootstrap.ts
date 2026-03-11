import { defineModuleMetadata, getModuleMetadata, type Token } from '@konekti/core';
import { Container, type Provider } from '@konekti-internal/di';

import { ModuleGraphError, ModuleVisibilityError } from './errors';
import type { BootstrapResult, CompiledModule, ModuleDefinition, ModuleType } from './types';

function providerToken(provider: Provider): Token {
  if (typeof provider === 'function') {
    return provider;
  }

  return provider.provide;
}

function providerDependencies(provider: Provider): Token[] {
  if (typeof provider === 'function') {
    return provider.inject ?? [];
  }

  if ('useFactory' in provider) {
    return provider.inject ?? [];
  }

  if ('useClass' in provider) {
    return provider.inject ?? provider.useClass.inject ?? [];
  }

  return [];
}

function controllerDependencies(controller: ModuleType): Token[] {
  return (controller as { inject?: Token[] }).inject ?? [];
}

/**
 * Associates module metadata with a module type.
 */
export function defineModule<T extends ModuleType>(moduleType: T, definition: ModuleDefinition): T {
  defineModuleMetadata(moduleType, definition);

  return moduleType;
}

function compileModule(
  moduleType: ModuleType,
  compiled = new Map<ModuleType, CompiledModule>(),
  visiting = new Set<ModuleType>(),
  ordered: CompiledModule[] = [],
) {
  if (compiled.has(moduleType)) {
    return compiled.get(moduleType)!;
  }

  if (visiting.has(moduleType)) {
    throw new ModuleGraphError(`Circular module import detected for ${moduleType.name}.`);
  }

  visiting.add(moduleType);

  const rawDefinition = getModuleMetadata(moduleType);
  const definition: ModuleDefinition = rawDefinition
    ? {
        imports: (rawDefinition.imports as ModuleType[] | undefined) ?? [],
        providers: (rawDefinition.providers as Provider[] | undefined) ?? [],
        controllers: (rawDefinition.controllers as ModuleType[] | undefined) ?? [],
        exports: (rawDefinition.exports as Token[] | undefined) ?? [],
      }
    : {};

  const importedModules = (definition.imports ?? []).map((imported: ModuleType) =>
    compileModule(imported, compiled, visiting, ordered),
  );

  const providerTokens = new Set((definition.providers ?? []).map((provider) => providerToken(provider)));
  const importedExportedTokens = new Set<Token>(
    importedModules.flatMap((compiledModule) => Array.from(compiledModule.exportedTokens)),
  );
  const accessibleTokens = new Set<Token>([...providerTokens, ...importedExportedTokens]);

  for (const provider of definition.providers ?? []) {
    for (const token of providerDependencies(provider)) {
      if (!accessibleTokens.has(token)) {
        throw new ModuleVisibilityError(
          `Provider ${String(providerToken(provider))} in module ${moduleType.name} cannot access token ${String(
            token,
          )} because it is not local and not exported by an imported module.`,
        );
      }
    }
  }

  for (const controller of definition.controllers ?? []) {
    for (const token of controllerDependencies(controller)) {
      if (!accessibleTokens.has(token)) {
        throw new ModuleVisibilityError(
          `Controller ${controller.name} in module ${moduleType.name} cannot access token ${String(
            token,
          )} because it is not local and not exported by an imported module.`,
        );
      }
    }
  }

  const exportedTokens = new Set<Token>();

  for (const token of definition.exports ?? []) {
    if (!providerTokens.has(token) && !importedExportedTokens.has(token)) {
      throw new ModuleVisibilityError(
        `Module ${moduleType.name} cannot export token ${String(
          token,
        )} because it is neither local nor re-exported from an imported module.`,
      );
    }

    exportedTokens.add(token);
  }

  const compiledModule: CompiledModule = {
    type: moduleType,
    definition,
    exportedTokens,
    providerTokens,
  };

  compiled.set(moduleType, compiledModule);
  visiting.delete(moduleType);
  ordered.push(compiledModule);

  return compiledModule;
}

/**
 * Compiles the module graph into an ordered module list with visibility checks.
 */
export function compileModuleGraph(rootModule: ModuleType): CompiledModule[] {
  const ordered: CompiledModule[] = [];

  compileModule(rootModule, new Map(), new Set(), ordered);

  return ordered;
}

/**
 * Bootstraps the minimal module graph and returns the root container baseline.
 */
export function bootstrapModule(rootModule: ModuleType): BootstrapResult {
  const modules = compileModuleGraph(rootModule);
  const container = new Container();

  for (const compiledModule of modules) {
    for (const provider of compiledModule.definition.providers ?? []) {
      container.register(provider);
    }
  }

  return {
    container,
    modules,
    rootModule,
  };
}
