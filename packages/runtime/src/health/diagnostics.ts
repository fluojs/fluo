import { type Token } from '@fluojs/core';
import { getClassDiMetadata } from '@fluojs/core/internal';
import type { Provider, Scope } from '@fluojs/di';

import type { CompiledModule, ModuleType } from '../types.js';

export interface RuntimeDiagnosticsGraph {
  version: 1;
  rootModule: string;
  modules: RuntimeDiagnosticsModule[];
  relationships: RuntimeDiagnosticsRelationships;
}

export interface RuntimeDiagnosticsModule {
  name: string;
  global: boolean;
  imports: string[];
  controllers: string[];
  providers: RuntimeDiagnosticsProvider[];
  exports: string[];
}

export interface RuntimeDiagnosticsProvider {
  token: string;
  type: 'class' | 'factory' | 'value' | 'existing';
  scope: Scope;
  multi: boolean;
}

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

export interface BootstrapTimingPhase {
  durationMs: number;
  name:
    | 'bootstrap_module'
    | 'register_runtime_tokens'
    | 'resolve_lifecycle_instances'
    | 'run_bootstrap_lifecycle'
    | 'create_dispatcher';
}

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
    return getClassDiMetadata(provider)?.scope ?? 'singleton';
  }

  if ('useValue' in provider || 'useExisting' in provider) {
    return 'singleton';
  }

  if ('useFactory' in provider) {
    return provider.scope ?? (provider.resolverClass ? getClassDiMetadata(provider.resolverClass)?.scope : undefined) ?? 'singleton';
  }

  if ('useClass' in provider) {
    return provider.scope ?? getClassDiMetadata(provider.useClass)?.scope ?? 'singleton';
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

export function renderRuntimeDiagnosticsMermaid(graph: RuntimeDiagnosticsGraph): string {
  const lines: string[] = ['graph TD'];
  const nodeByModule = new Map<string, string>();

  for (const [index, module] of graph.modules.entries()) {
    const nodeId = `M${String(index + 1)}`;
    nodeByModule.set(module.name, nodeId);

    const summary = [
      module.name,
      `providers: ${String(module.providers.length)}`,
      `controllers: ${String(module.controllers.length)}`,
      `exports: ${String(module.exports.length)}`,
    ].join('\\n');

    lines.push(`  ${nodeId}["${summary}"]`);
  }

  for (const relation of graph.relationships.moduleImports) {
    const from = nodeByModule.get(relation.from);
    const to = nodeByModule.get(relation.to);

    if (!from || !to) {
      continue;
    }

    lines.push(`  ${from} --> ${to}`);
  }

  const rootNodeId = nodeByModule.get(graph.rootModule);
  if (rootNodeId) {
    lines.push(`  class ${rootNodeId} rootModule`);
    lines.push('  classDef rootModule stroke:#2563eb,stroke-width:2px');
  }

  return lines.join('\n');
}

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
