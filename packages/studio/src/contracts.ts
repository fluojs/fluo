export type Scope = 'singleton' | 'request' | 'transient';
export type ProviderType = 'class' | 'factory' | 'value' | 'existing';

export interface RuntimeDiagnosticsProvider {
  token: string;
  type: ProviderType;
  scope: Scope;
  multi: boolean;
}

export interface RuntimeDiagnosticsModule {
  name: string;
  global: boolean;
  imports: string[];
  controllers: string[];
  providers: RuntimeDiagnosticsProvider[];
  exports: string[];
}

export interface RuntimeDiagnosticsRelationships {
  moduleImports: Array<{ from: string; to: string }>;
  moduleExports: Array<{ module: string; token: string }>;
  moduleProviders: Array<{ module: string; token: string; providerType: ProviderType; scope: Scope; multi: boolean }>;
  moduleControllers: Array<{ controller: string; module: string }>;
}

export interface RuntimeDiagnosticsGraph {
  version: 1;
  rootModule: string;
  modules: RuntimeDiagnosticsModule[];
  relationships: RuntimeDiagnosticsRelationships;
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

export interface StudioPayload {
  graph?: RuntimeDiagnosticsGraph;
  timing?: BootstrapTimingDiagnostics;
}

export interface FilterState {
  query: string;
  scopes: Scope[];
  types: ProviderType[];
  globalsOnly: boolean;
}

export interface ParsedPayload {
  payload: StudioPayload;
  rawJson: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function validateGraph(value: unknown): RuntimeDiagnosticsGraph | null {
  if (!isRecord(value)) {
    return null;
  }

  if (value.version !== 1) {
    throw new Error('Unsupported diagnostics graph version. Expected version: 1.');
  }

  if (typeof value.rootModule !== 'string' || !Array.isArray(value.modules) || !isRecord(value.relationships)) {
    throw new Error('Invalid diagnostics graph payload.');
  }

  for (const module of value.modules) {
    if (!isRecord(module)) {
      throw new Error('Invalid module entry in diagnostics graph.');
    }

    if (
      typeof module.name !== 'string'
      || typeof module.global !== 'boolean'
      || !isStringArray(module.imports)
      || !isStringArray(module.controllers)
      || !isStringArray(module.exports)
      || !Array.isArray(module.providers)
    ) {
      throw new Error('Invalid module shape in diagnostics graph.');
    }
  }

  return value as unknown as RuntimeDiagnosticsGraph;
}

function validateTiming(value: unknown): BootstrapTimingDiagnostics | null {
  if (!isRecord(value)) {
    return null;
  }

  if (value.version !== 1) {
    throw new Error('Unsupported bootstrap timing version. Expected version: 1.');
  }

  if (typeof value.totalMs !== 'number' || !Array.isArray(value.phases)) {
    throw new Error('Invalid bootstrap timing payload.');
  }

  for (const phase of value.phases) {
    if (!isRecord(phase) || typeof phase.name !== 'string' || typeof phase.durationMs !== 'number') {
      throw new Error('Invalid phase entry in bootstrap timing payload.');
    }
  }

  return value as unknown as BootstrapTimingDiagnostics;
}

export function parseStudioPayload(rawJson: string): ParsedPayload {
  const parsed = JSON.parse(rawJson) as unknown;
  const envelope = isRecord(parsed) ? parsed : undefined;

  const graph = validateGraph(envelope?.graph ?? parsed);
  const timing = validateTiming(envelope?.timing ?? (!graph ? parsed : undefined));

  if (!graph && !timing) {
    throw new Error('Unsupported file format. Expected diagnostics graph JSON or timing JSON.');
  }

  return {
    payload: {
      ...(graph ? { graph } : {}),
      ...(timing ? { timing } : {}),
    },
    rawJson,
  };
}

export function applyFilters(graph: RuntimeDiagnosticsGraph, filter: FilterState): RuntimeDiagnosticsGraph {
  const query = filter.query.trim().toLowerCase();

  const modules = graph.modules.filter((module) => {
    if (filter.globalsOnly && !module.global) {
      return false;
    }

    const scopeMatch = filter.scopes.length === 0
      || module.providers.some((provider) => filter.scopes.includes(provider.scope));
    if (!scopeMatch) {
      return false;
    }

    const typeMatch = filter.types.length === 0
      || module.providers.some((provider) => filter.types.includes(provider.type));
    if (!typeMatch) {
      return false;
    }

    if (!query) {
      return true;
    }

    return module.name.toLowerCase().includes(query)
      || module.providers.some((provider) => provider.token.toLowerCase().includes(query));
  });

  const moduleNames = new Set(modules.map((module) => module.name));

  return {
    ...graph,
    modules,
    relationships: {
      ...graph.relationships,
      moduleImports: graph.relationships.moduleImports.filter((edge) => moduleNames.has(edge.from) && moduleNames.has(edge.to)),
      moduleExports: graph.relationships.moduleExports.filter((edge) => moduleNames.has(edge.module)),
      moduleProviders: graph.relationships.moduleProviders.filter((edge) => moduleNames.has(edge.module)),
      moduleControllers: graph.relationships.moduleControllers.filter((edge) => moduleNames.has(edge.module)),
    },
  };
}

export function renderMermaid(graph: RuntimeDiagnosticsGraph): string {
  const lines: string[] = ['graph TD'];
  const nodeByModule = new Map<string, string>();

  for (const [index, module] of graph.modules.entries()) {
    const nodeId = `M${String(index + 1)}`;
    nodeByModule.set(module.name, nodeId);
    lines.push(`  ${nodeId}["${module.name}\\nproviders: ${String(module.providers.length)}\\ncontrollers: ${String(module.controllers.length)}\\nexports: ${String(module.exports.length)}"]`);
  }

  for (const relation of graph.relationships.moduleImports) {
    const from = nodeByModule.get(relation.from);
    const to = nodeByModule.get(relation.to);

    if (from && to) {
      lines.push(`  ${from} --> ${to}`);
    }
  }

  const rootNodeId = nodeByModule.get(graph.rootModule);
  if (rootNodeId) {
    lines.push(`  class ${rootNodeId} rootModule`);
    lines.push('  classDef rootModule stroke:#2563eb,stroke-width:2px');
  }

  return lines.join('\n');
}
