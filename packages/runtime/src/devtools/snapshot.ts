import type { Token } from '@fluojs/core';
import type { Provider, Scope } from '@fluojs/di';
import type { HandlerDescriptor } from '@fluojs/http';

import { createRuntimeDiagnosticsGraph, type BootstrapTimingDiagnostics } from '../health/diagnostics.js';
import { getRuntimeClassDiMetadata, type RuntimeInjectionToken } from '../internal/core-metadata.js';
import { providerToken } from '../module-graph.js';
import type { CompiledModule, ModuleType } from '../types.js';
import type {
  StudioGraphEdge,
  StudioGraphEdgeKind,
  StudioGraphNode,
  StudioLiveDiagnostic,
  StudioLiveSnapshot,
  StudioRouteDescriptor,
} from './contracts.js';

/**
 * Describes Studio Live Snapshot Input data used by the Studio devtool.
 */
export interface StudioLiveSnapshotInput {
  appId: string;
  diagnostics?: readonly StudioLiveDiagnostic[];
  generatedAt?: string;
  modules: readonly CompiledModule[];
  requests?: readonly StudioLiveSnapshot['requests'][number][];
  rootModule: ModuleType;
  routes?: readonly HandlerDescriptor[];
  timing?: BootstrapTimingDiagnostics;
}

type RuntimeForwardRef = { __forwardRef__: true; forwardRef: () => Token };
type RuntimeOptionalToken = { __optional__: true; token: Token };

function isForwardRef(value: RuntimeInjectionToken): value is RuntimeForwardRef {
  return typeof value === 'object' && value !== null && '__forwardRef__' in value && value.__forwardRef__ === true;
}

function isOptionalToken(value: RuntimeInjectionToken): value is RuntimeOptionalToken {
  return typeof value === 'object' && value !== null && '__optional__' in value && value.__optional__ === true;
}

function resolveInjectionToken(token: RuntimeInjectionToken): Token {
  if (isForwardRef(token)) {
    return token.forwardRef();
  }

  if (isOptionalToken(token)) {
    return token.token;
  }

  return token;
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

function labelModule(moduleType: ModuleType): string {
  return moduleType.name || '<anonymous-module>';
}

function providerShape(provider: Provider): string {
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

function providerDependencies(provider: Provider): RuntimeInjectionToken[] {
  if (typeof provider === 'function') {
    return [...(getRuntimeClassDiMetadata(provider)?.inject ?? [])];
  }

  if ('useFactory' in provider) {
    return [...(provider.inject ?? [])] as RuntimeInjectionToken[];
  }

  if ('useClass' in provider) {
    return [...(provider.inject ?? getRuntimeClassDiMetadata(provider.useClass)?.inject ?? [])] as RuntimeInjectionToken[];
  }

  if ('useExisting' in provider) {
    return [provider.useExisting] as RuntimeInjectionToken[];
  }

  return [];
}

function controllerDependencies(controller: ModuleType): RuntimeInjectionToken[] {
  return [...(getRuntimeClassDiMetadata(controller)?.inject ?? [])];
}

function slug(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9_.:-]/g, '_') || 'anonymous';
}

function moduleNodeId(moduleName: string): string {
  return `module:${slug(moduleName)}`;
}

function providerNodeId(moduleName: string, tokenLabel: string): string {
  return `provider:${slug(moduleName)}:${slug(tokenLabel)}`;
}

function controllerNodeId(moduleName: string, controllerName: string): string {
  return `controller:${slug(moduleName)}:${slug(controllerName)}`;
}

function externalNodeId(tokenLabel: string): string {
  return `external:${slug(tokenLabel)}`;
}

function routeNodeId(route: StudioRouteDescriptor): string {
  return `route:${slug(route.id)}`;
}

function edgeId(kind: StudioGraphEdgeKind, from: string, to: string): string {
  return `${kind}:${from}->${to}`;
}

function addNode(nodes: Map<string, StudioGraphNode>, node: StudioGraphNode): void {
  nodes.set(node.id, node);
}

function addEdge(edges: Map<string, StudioGraphEdge>, edge: StudioGraphEdge): void {
  edges.set(edge.id, edge);
}

function createDependencyEdgeTarget(
  tokenLabel: string,
  moduleName: string,
  providerByModuleAndToken: Map<string, string>,
  firstProviderByToken: Map<string, string>,
  nodes: Map<string, StudioGraphNode>,
): string {
  const moduleLocal = providerByModuleAndToken.get(`${moduleName}:${tokenLabel}`);

  if (moduleLocal) {
    return moduleLocal;
  }

  const firstProvider = firstProviderByToken.get(tokenLabel);

  if (firstProvider) {
    return firstProvider;
  }

  const externalId = externalNodeId(tokenLabel);
  addNode(nodes, {
    id: externalId,
    kind: 'external',
    label: tokenLabel,
  });

  return externalId;
}

function routePath(descriptor: HandlerDescriptor): string {
  return descriptor.metadata.effectivePath || descriptor.route.path;
}

/**
 * Creates a stable route id shared by runtime request traces and Studio graph snapshots.
 *
 * @param descriptor HTTP handler descriptor to identify.
 * @returns Stable Studio route id for the handler.
 */
export function createStudioRouteId(descriptor: HandlerDescriptor): string {
  return [
    descriptor.route.method,
    routePath(descriptor),
    descriptor.controllerToken.name || '<anonymous-controller>',
    descriptor.methodName,
  ].join(' ');
}

/**
 * Converts an HTTP handler descriptor into the live Studio route contract.
 *
 * @param descriptor HTTP handler descriptor to expose to Studio.
 * @returns Route descriptor consumed by the Studio UI and request traces.
 */
export function handlerToStudioRouteDescriptor(descriptor: HandlerDescriptor): StudioRouteDescriptor {
  const route: StudioRouteDescriptor = {
    controller: descriptor.controllerToken.name || '<anonymous-controller>',
    handler: descriptor.methodName,
    id: createStudioRouteId(descriptor),
    method: descriptor.route.method,
    path: routePath(descriptor),
  };

  const moduleName = descriptor.metadata.moduleType?.name;
  if (moduleName) {
    route.module = moduleName;
  }

  const version = descriptor.metadata.effectiveVersion ?? descriptor.route.version;
  if (version) {
    route.version = version;
  }

  return route;
}

/**
 * Builds the runtime-connected Studio snapshot from compiled modules and HTTP route descriptors.
 *
 * @param input Runtime module graph, route, diagnostic, and timing inputs.
 * @returns Live Studio snapshot for graph, routes, diagnostics, requests, and timing.
 */
export function createStudioLiveSnapshot(input: StudioLiveSnapshotInput): StudioLiveSnapshot {
  const diagnosticsGraph = createRuntimeDiagnosticsGraph(input.modules, input.rootModule);
  const nodes = new Map<string, StudioGraphNode>();
  const edges = new Map<string, StudioGraphEdge>();
  const providerByModuleAndToken = new Map<string, string>();
  const firstProviderByToken = new Map<string, string>();
  const controllerByModuleAndName = new Map<string, string>();

  for (const module of diagnosticsGraph.modules) {
    const id = moduleNodeId(module.name);
    addNode(nodes, {
      id,
      kind: 'module',
      label: module.name,
      metadata: {
        controllers: module.controllers.length,
        exports: module.exports.length,
        global: module.global,
        providers: module.providers.length,
        root: module.name === diagnosticsGraph.rootModule,
      },
      status: module.name === diagnosticsGraph.rootModule ? 'active' : 'idle',
    });
  }

  for (const relationship of diagnosticsGraph.relationships.moduleImports) {
    const from = moduleNodeId(relationship.from);
    const to = moduleNodeId(relationship.to);
    addEdge(edges, {
      from,
      id: edgeId('imports', from, to),
      kind: 'imports',
      to,
    });
  }

  for (const compiledModule of input.modules) {
    const moduleName = labelModule(compiledModule.type);
    const ownerId = moduleNodeId(moduleName);

    for (const provider of compiledModule.definition.providers ?? []) {
      const tokenLabel = labelToken(providerToken(provider));
      const id = providerNodeId(moduleName, tokenLabel);
      providerByModuleAndToken.set(`${moduleName}:${tokenLabel}`, id);
      if (!firstProviderByToken.has(tokenLabel)) {
        firstProviderByToken.set(tokenLabel, id);
      }

      addNode(nodes, {
        id,
        kind: 'provider',
        label: tokenLabel,
        metadata: {
          module: moduleName,
          providerType: providerShape(provider),
          scope: providerScope(provider),
        },
      });
      addEdge(edges, {
        from: ownerId,
        id: edgeId('owns_provider', ownerId, id),
        kind: 'owns_provider',
        to: id,
      });
    }

    for (const controller of compiledModule.definition.controllers ?? []) {
      const controllerName = controller.name || '<anonymous-controller>';
      const id = controllerNodeId(moduleName, controllerName);
      controllerByModuleAndName.set(`${moduleName}:${controllerName}`, id);
      addNode(nodes, {
        id,
        kind: 'controller',
        label: controllerName,
        metadata: {
          module: moduleName,
        },
      });
      addEdge(edges, {
        from: ownerId,
        id: edgeId('owns_controller', ownerId, id),
        kind: 'owns_controller',
        to: id,
      });
    }
  }

  for (const compiledModule of input.modules) {
    const moduleName = labelModule(compiledModule.type);

    for (const provider of compiledModule.definition.providers ?? []) {
      const from = providerByModuleAndToken.get(`${moduleName}:${labelToken(providerToken(provider))}`);
      if (!from) {
        continue;
      }

      for (const dependency of providerDependencies(provider)) {
        const tokenLabel = labelToken(resolveInjectionToken(dependency));
        const to = createDependencyEdgeTarget(tokenLabel, moduleName, providerByModuleAndToken, firstProviderByToken, nodes);
        addEdge(edges, {
          from,
          id: edgeId('depends_on', from, to),
          kind: 'depends_on',
          label: tokenLabel,
          to,
        });
      }
    }

    for (const controller of compiledModule.definition.controllers ?? []) {
      const controllerName = controller.name || '<anonymous-controller>';
      const from = controllerByModuleAndName.get(`${moduleName}:${controllerName}`);
      if (!from) {
        continue;
      }

      for (const dependency of controllerDependencies(controller)) {
        const tokenLabel = labelToken(resolveInjectionToken(dependency));
        const to = createDependencyEdgeTarget(tokenLabel, moduleName, providerByModuleAndToken, firstProviderByToken, nodes);
        addEdge(edges, {
          from,
          id: edgeId('depends_on', from, to),
          kind: 'depends_on',
          label: tokenLabel,
          to,
        });
      }
    }

    for (const token of compiledModule.exportedTokens) {
      const tokenLabel = labelToken(token);
      const from = moduleNodeId(moduleName);
      const to = createDependencyEdgeTarget(tokenLabel, moduleName, providerByModuleAndToken, firstProviderByToken, nodes);
      addEdge(edges, {
        from,
        id: edgeId('exports', from, to),
        kind: 'exports',
        label: tokenLabel,
        to,
      });
    }
  }

  const routes = (input.routes ?? []).map((descriptor) => handlerToStudioRouteDescriptor(descriptor));
  for (const route of routes) {
    const id = routeNodeId(route);
    addNode(nodes, {
      id,
      kind: 'route',
      label: `${route.method} ${route.path}`,
      metadata: {
        controller: route.controller,
        handler: route.handler,
        module: route.module,
        version: route.version,
      },
    });

    if (route.module) {
      const controllerId = controllerByModuleAndName.get(`${route.module}:${route.controller}`);
      if (controllerId) {
        addEdge(edges, {
          from: controllerId,
          id: edgeId('exposes_route', controllerId, id),
          kind: 'exposes_route',
          to: id,
        });
      }
    }
  }

  const snapshot: StudioLiveSnapshot = {
    appId: input.appId,
    diagnostics: [...(input.diagnostics ?? [])],
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    graph: {
      edges: [...edges.values()],
      nodes: [...nodes.values()],
    },
    requests: [...(input.requests ?? [])],
    routes,
    version: 1,
  };

  if (input.timing) {
    snapshot.timing = input.timing;
  }

  return snapshot;
}
