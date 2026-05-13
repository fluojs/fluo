import { type Token } from '@fluojs/core';
import type { Provider, Scope } from '@fluojs/di';

import { getRuntimeClassDiMetadata } from '../internal/core-metadata.js';
import type { CompiledModule, ModuleType } from '../types.js';

/**
 * Describes the runtime diagnostics graph contract.
 */
export interface RuntimeDiagnosticsGraph {
  version: 1;
  rootModule: string;
  modules: RuntimeDiagnosticsModule[];
  relationships: RuntimeDiagnosticsRelationships;
}

/**
 * Describes the runtime diagnostics module contract.
 */
export interface RuntimeDiagnosticsModule {
  name: string;
  global: boolean;
  imports: string[];
  controllers: string[];
  providers: RuntimeDiagnosticsProvider[];
  exports: string[];
}

/**
 * Describes the runtime diagnostics provider contract.
 */
export interface RuntimeDiagnosticsProvider {
  token: string;
  type: 'class' | 'factory' | 'value' | 'existing';
  scope: Scope;
  multi: boolean;
}

/**
 * Describes the runtime diagnostics relationships contract.
 */
export interface RuntimeDiagnosticsRelationships {
  moduleImports: Array<{
    from: string;
    to: string;
  }>;
  moduleExports: Array<{
    module: string;
    token: string;
  }>;
  moduleProviders: Array<{
    module: string;
    token: string;
    providerType: RuntimeDiagnosticsProvider['type'];
    scope: Scope;
    multi: boolean;
  }>;
  moduleControllers: Array<{
    controller: string;
    module: string;
  }>;
}

/**
 * Describes the bootstrap timing phase contract.
 */
export interface BootstrapTimingPhase {
  durationMs: number;
  name:
    | 'bootstrap_module'
    | 'register_runtime_tokens'
    | 'resolve_lifecycle_instances'
    | 'run_bootstrap_lifecycle'
    | 'create_dispatcher';
}

/**
 * Describes the bootstrap timing diagnostics contract.
 */
export interface BootstrapTimingDiagnostics {
  phases: BootstrapTimingPhase[];
  totalMs: number;
  version: 1;
}

function roundMs(value: number): number {
  return Number(value.toFixed(3));
}

function labelModule(moduleType: ModuleType): string {
  return moduleType.name || '<anonymous-module>';
}

function labelToken(token: Token): string {
  if (typeof token === 'function') {
    return token.name || '<anonymous-token>';
  }

  if (typeof token === 'symbol') {
    return token.description ? `Symbol(${token.description})` : token.toString();
  }

  return String(token);
}

function providerShape(provider: Provider): RuntimeDiagnosticsProvider['type'] {
  if (typeof provider === 'function') {
    return 'class';
  }

  if ('useFactory' in provider) {
    return 'factory';
  }

  if ('useValue' in provider) {
    return 'value';
  }

  if ('useExisting' in provider) {
    return 'existing';
  }

  return 'class';
}

function providerScope(provider: Provider): Scope {
  if (typeof provider === 'function') {
    return getRuntimeClassDiMetadata(provider)?.scope ?? 'singleton';
  }

  if ('useValue' in provider || 'useExisting' in provider) {
    return 'singleton';
  }

  if ('useFactory' in provider) {
    return provider.scope ?? (provider.resolverClass ? getRuntimeClassDiMetadata(provider.resolverClass)?.scope : undefined) ?? 'singleton';
  }

  if ('useClass' in provider) {
    return provider.scope ?? getRuntimeClassDiMetadata(provider.useClass)?.scope ?? 'singleton';
  }

  return 'singleton';
}

function providerToken(provider: Provider): Token {
  if (typeof provider === 'function') {
    return provider;
  }

  return provider.provide;
}

function normalizeProvider(provider: Provider): RuntimeDiagnosticsProvider {
  const multi = typeof provider === 'object' && provider !== null && 'multi' in provider && provider.multi === true;

  return {
    multi,
    scope: providerScope(provider),
    token: labelToken(providerToken(provider)),
    type: providerShape(provider),
  };
}

/**
 * Create runtime diagnostics graph.
 *
 * @param modules The modules.
 * @param rootModule The root module.
 * @returns The create runtime diagnostics graph result.
 */
export function createRuntimeDiagnosticsGraph(modules: readonly CompiledModule[], rootModule: ModuleType): RuntimeDiagnosticsGraph {
  const moduleDiagnostics: RuntimeDiagnosticsModule[] = [];
  const moduleImports: RuntimeDiagnosticsRelationships['moduleImports'] = [];
  const moduleExports: RuntimeDiagnosticsRelationships['moduleExports'] = [];
  const moduleProviders: RuntimeDiagnosticsRelationships['moduleProviders'] = [];
  const moduleControllers: RuntimeDiagnosticsRelationships['moduleControllers'] = [];

  for (const compiledModule of modules) {
    const moduleName = labelModule(compiledModule.type);
    const imports = (compiledModule.definition.imports ?? []).map((moduleType) => labelModule(moduleType));
    const controllers = (compiledModule.definition.controllers ?? []).map((controller) => controller.name || '<anonymous-controller>');
    const providers = (compiledModule.definition.providers ?? []).map((provider) => normalizeProvider(provider));
    const exports = Array.from(compiledModule.exportedTokens).map((token) => labelToken(token));

    moduleDiagnostics.push({
      controllers,
      exports,
      global: compiledModule.definition.global ?? false,
      imports,
      name: moduleName,
      providers,
    });

    for (const imported of imports) {
      moduleImports.push({
        from: moduleName,
        to: imported,
      });
    }

    for (const token of exports) {
      moduleExports.push({
        module: moduleName,
        token,
      });
    }

    for (const provider of providers) {
      moduleProviders.push({
        module: moduleName,
        multi: provider.multi,
        providerType: provider.type,
        scope: provider.scope,
        token: provider.token,
      });
    }

    for (const controller of controllers) {
      moduleControllers.push({
        controller,
        module: moduleName,
      });
    }
  }

  return {
    modules: moduleDiagnostics,
    relationships: {
      moduleControllers,
      moduleExports,
      moduleImports,
      moduleProviders,
    },
    rootModule: labelModule(rootModule),
    version: 1,
  };
}

/**
 * Create bootstrap timing diagnostics.
 *
 * @param phases The phases.
 * @param totalMs The total ms.
 * @returns The create bootstrap timing diagnostics result.
 */
export function createBootstrapTimingDiagnostics(
  phases: BootstrapTimingPhase[],
  totalMs: number,
): BootstrapTimingDiagnostics {
  return {
    phases: phases.map((phase) => ({
      ...phase,
      durationMs: roundMs(phase.durationMs),
    })),
    totalMs: roundMs(totalMs),
    version: 1,
  };
}
