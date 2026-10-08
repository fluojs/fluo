import type { PlatformDiagnosticIssue, PlatformDiagnosticSeverity, PlatformReadinessStatus, PlatformShellSnapshot, PlatformSnapshot } from '@fluojs/diagnostics';

export * from '@fluojs/diagnostics';

/**
 * Filter state applied to the loaded platform snapshot inside Studio.
 */
export interface FilterState {
  query: string;
  readinessStatuses: PlatformReadinessStatus[];
  severities: PlatformDiagnosticSeverity[];
}

/**
 * Applies Studio filter state to a platform snapshot without mutating the input.
 *
 * @param snapshot - The loaded platform snapshot.
 * @param filter - Active readiness, severity, and query filters.
 * @returns A filtered snapshot containing only the matching components and diagnostics.
 */
export function applyFilters<TSnapshot extends PlatformShellSnapshot>(snapshot: TSnapshot, filter: FilterState): TSnapshot {
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
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\r\n', '\\n')
    .replaceAll('\r', '\\n')
    .replaceAll('\n', '\\n');
}

function sanitizeMermaidNodeIdSegment(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9_]/g, '_');
}

function hashMermaidNodeId(value: string): string {
  let hash = 2_166_136_261;

  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }

  return hash.toString(16).padStart(8, '0');
}

function createExternalMermaidNodeId(value: string): string {
  return `EXT_${sanitizeMermaidNodeIdSegment(value)}_${hashMermaidNodeId(value)}`;
}

/**
 * Renders the loaded platform snapshot as a Mermaid dependency graph.
 *
 * @remarks
 * `@fluojs/studio` owns the snapshot consumption and graph rendering contract. Runtime packages remain the
 * snapshot producers, while automation and viewer callers use this helper to turn a loaded snapshot into a
 * stable Mermaid graph.
 *
 * @param snapshot - The platform snapshot to render.
 * @returns Mermaid graph text suitable for docs or clipboard export.
 */
export function renderMermaid(snapshot: PlatformShellSnapshot): string {
  const lines: string[] = ['graph TD'];
  const nodeByComponent = new Map<string, string>();
  const externalNodeByDependency = new Map<string, string>();
  const internalComponentIds = new Set(snapshot.components.map((component) => component.id));

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

      if (internalComponentIds.has(dependency)) {
        continue;
      }

      let externalNode = externalNodeByDependency.get(dependency);

      if (!externalNode) {
        externalNode = createExternalMermaidNodeId(dependency);
        externalNodeByDependency.set(dependency, externalNode);
        lines.push(`  ${externalNode}["${escapeMermaidText(dependency)}"]`);
      }

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
