import type {
  BootstrapTimingDiagnostics,
  PlatformDiagnosticIssue,
  PlatformShellSnapshot,
  PlatformSnapshot,
} from '@konekti/runtime';

export type PlatformReadinessStatus = PlatformSnapshot['readiness']['status'];
export type PlatformDiagnosticSeverity = PlatformDiagnosticIssue['severity'];

export interface StudioPayload {
  snapshot?: PlatformShellSnapshot;
  timing?: BootstrapTimingDiagnostics;
}

export interface FilterState {
  query: string;
  readinessStatuses: PlatformReadinessStatus[];
  severities: PlatformDiagnosticSeverity[];
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

function isReadinessStatus(value: unknown): value is PlatformReadinessStatus {
  return value === 'ready' || value === 'not-ready' || value === 'degraded';
}

function isHealthStatus(value: unknown): value is PlatformSnapshot['health']['status'] {
  return value === 'healthy' || value === 'unhealthy' || value === 'degraded';
}

function isDiagnosticSeverity(value: unknown): value is PlatformDiagnosticSeverity {
  return value === 'error' || value === 'warning' || value === 'info';
}

function validateSnapshot(value: unknown): PlatformShellSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.generatedAt !== 'string'
    || !isRecord(value.readiness)
    || !isRecord(value.health)
    || !Array.isArray(value.components)
    || !Array.isArray(value.diagnostics)
  ) {
    throw new Error('Invalid platform snapshot payload.');
  }

  if (!isReadinessStatus(value.readiness.status) || typeof value.readiness.critical !== 'boolean') {
    throw new Error('Invalid aggregate readiness in platform snapshot payload.');
  }

  if (!isHealthStatus(value.health.status)) {
    throw new Error('Invalid aggregate health in platform snapshot payload.');
  }

  for (const component of value.components) {
    if (!isRecord(component)) {
      throw new Error('Invalid component entry in platform snapshot payload.');
    }

    if (
      typeof component.id !== 'string'
      || typeof component.kind !== 'string'
      || typeof component.state !== 'string'
      || !isRecord(component.readiness)
      || !isRecord(component.health)
      || !isStringArray(component.dependencies)
      || !isRecord(component.telemetry)
      || !isRecord(component.ownership)
      || !isRecord(component.details)
    ) {
      throw new Error('Invalid component shape in platform snapshot payload.');
    }

    if (!isReadinessStatus(component.readiness.status) || typeof component.readiness.critical !== 'boolean') {
      throw new Error('Invalid component readiness in platform snapshot payload.');
    }

    if (!isHealthStatus(component.health.status)) {
      throw new Error('Invalid component health in platform snapshot payload.');
    }

    if (
      typeof component.telemetry.namespace !== 'string'
      || !isRecord(component.telemetry.tags)
      || typeof component.ownership.ownsResources !== 'boolean'
      || typeof component.ownership.externallyManaged !== 'boolean'
    ) {
      throw new Error('Invalid component telemetry/ownership in platform snapshot payload.');
    }
  }

  for (const issue of value.diagnostics) {
    if (!isRecord(issue)) {
      throw new Error('Invalid diagnostics issue entry in platform snapshot payload.');
    }

    if (
      typeof issue.code !== 'string'
      || !isDiagnosticSeverity(issue.severity)
      || typeof issue.componentId !== 'string'
      || typeof issue.message !== 'string'
    ) {
      throw new Error('Invalid diagnostics issue shape in platform snapshot payload.');
    }

    if (
      (issue.cause !== undefined && typeof issue.cause !== 'string')
      || (issue.fixHint !== undefined && typeof issue.fixHint !== 'string')
      || (issue.docsUrl !== undefined && typeof issue.docsUrl !== 'string')
      || (issue.dependsOn !== undefined && !isStringArray(issue.dependsOn))
    ) {
      throw new Error('Invalid optional diagnostics issue fields in platform snapshot payload.');
    }
  }

  return value as unknown as PlatformShellSnapshot;
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

  const snapshot = validateSnapshot(envelope?.snapshot ?? parsed);
  const timing = validateTiming(envelope?.timing ?? (!snapshot ? parsed : undefined));

  if (!snapshot && !timing) {
    throw new Error('Unsupported file format. Expected platform snapshot JSON or timing JSON.');
  }

  return {
    payload: {
      ...(snapshot ? { snapshot } : {}),
      ...(timing ? { timing } : {}),
    },
    rawJson,
  };
}

export function applyFilters(snapshot: PlatformShellSnapshot, filter: FilterState): PlatformShellSnapshot {
  const query = filter.query.trim().toLowerCase();

  const components = snapshot.components.filter((component: PlatformSnapshot) => {
    if (filter.readinessStatuses.length > 0 && !filter.readinessStatuses.includes(component.readiness.status)) {
      return false;
    }

    if (!query) {
      return true;
    }

    return component.id.toLowerCase().includes(query)
      || component.kind.toLowerCase().includes(query)
      || component.dependencies.some((dependency: string) => dependency.toLowerCase().includes(query));
  });

  const diagnostics = snapshot.diagnostics.filter((issue: PlatformDiagnosticIssue) => {
    if (filter.severities.length > 0 && !filter.severities.includes(issue.severity)) {
      return false;
    }

    if (!query) {
      return true;
    }

    return issue.code.toLowerCase().includes(query)
      || issue.componentId.toLowerCase().includes(query)
      || issue.message.toLowerCase().includes(query)
      || (issue.cause?.toLowerCase().includes(query) ?? false)
      || (issue.fixHint?.toLowerCase().includes(query) ?? false)
      || (issue.docsUrl?.toLowerCase().includes(query) ?? false)
      || (issue.dependsOn?.some((dependency: string) => dependency.toLowerCase().includes(query)) ?? false);
  });

  return {
    ...snapshot,
    components,
    diagnostics,
  };
}

function escapeMermaidText(value: string): string {
  return value.replaceAll('"', '\\"');
}

export function renderMermaid(snapshot: PlatformShellSnapshot): string {
  const lines: string[] = ['graph TD'];
  const nodeByComponent = new Map<string, string>();

  if (snapshot.components.length === 0) {
    lines.push('  EMPTY["No registered platform components"]');
    return lines.join('\n');
  }

  for (const [index, component] of snapshot.components.entries()) {
    const nodeId = `C${String(index + 1)}`;
    nodeByComponent.set(component.id, nodeId);
    lines.push(`  ${nodeId}["${escapeMermaidText(component.id)}\\nkind: ${escapeMermaidText(component.kind)}\\nreadiness: ${component.readiness.status}\\nhealth: ${component.health.status}"]`);
  }

  for (const component of snapshot.components) {
    const from = nodeByComponent.get(component.id);
    if (!from) {
      continue;
    }

    for (const dependency of component.dependencies) {
      const to = nodeByComponent.get(dependency);

      if (to) {
        lines.push(`  ${from} --> ${to}`);
        continue;
      }

      const externalNode = `EXT_${dependency.replaceAll(/[^a-zA-Z0-9_]/g, '_')}`;
      lines.push(`  ${externalNode}["${escapeMermaidText(dependency)}"]`);
      lines.push(`  ${from} --> ${externalNode}`);
    }
  }

  const degradedNodes: string[] = [];
  const notReadyNodes: string[] = [];
  for (const component of snapshot.components) {
    const nodeId = nodeByComponent.get(component.id);
    if (!nodeId) {
      continue;
    }

    if (component.readiness.status === 'degraded') {
      degradedNodes.push(nodeId);
    }

    if (component.readiness.status === 'not-ready') {
      notReadyNodes.push(nodeId);
    }
  }

  if (degradedNodes.length > 0) {
    lines.push(`  class ${degradedNodes.join(',')} degraded`);
    lines.push('  classDef degraded stroke:#f59e0b,stroke-width:2px');
  }

  if (notReadyNodes.length > 0) {
    lines.push(`  class ${notReadyNodes.join(',')} notReady`);
    lines.push('  classDef notReady stroke:#ef4444,stroke-width:2px');
  }

  return lines.join('\n');
}
