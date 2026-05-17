import type { PlatformDiagnosticIssue, PlatformShellSnapshot, PlatformSnapshot } from '@fluojs/runtime';

export interface ComponentConnectionSummary {
  component: PlatformSnapshot;
  diagnostics: PlatformDiagnosticIssue[];
  externalDependencies: string[];
  incoming: PlatformSnapshot[];
  outgoing: PlatformSnapshot[];
}

/**
 * Escapes caller-provided text before inserting it into Studio-owned HTML templates.
 *
 * @param value - Raw text to render in an HTML text or attribute context.
 * @returns The escaped HTML text.
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function safeDiagnosticDocsHref(docsUrl: string): string | undefined {
  try {
    const parsed = new URL(docsUrl);

    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.href;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

/**
 * Renders a diagnostic documentation URL without turning unsafe schemes into clickable links.
 *
 * @param docsUrl - Diagnostic documentation URL from a loaded platform snapshot.
 * @returns HTML for the docs field, using a link only for `http:` and `https:` URLs.
 */
export function renderDiagnosticDocsUrl(docsUrl: string): string {
  const safeHref = safeDiagnosticDocsHref(docsUrl);
  const label = escapeHtml(docsUrl);

  if (!safeHref) {
    return `<p><strong>docs:</strong> <span>${label}</span></p>`;
  }

  return `<p><strong>docs:</strong> <a href="${escapeHtml(safeHref)}" target="_blank" rel="noopener noreferrer">${label}</a></p>`;
}

function collectExternalDependencies(components: PlatformSnapshot[]): string[] {
  const componentIds = new Set(components.map((component) => component.id));
  const externalDependencies: string[] = [];
  const seen = new Set<string>();

  for (const component of components) {
    for (const dependency of component.dependencies) {
      if (componentIds.has(dependency) || seen.has(dependency)) {
        continue;
      }

      seen.add(dependency);
      externalDependencies.push(dependency);
    }
  }

  return externalDependencies;
}

/**
 * Builds the selected component's dependency neighborhood for the Studio inspector panel.
 *
 * @param snapshot - Filtered platform snapshot currently shown in the viewer.
 * @param selectedComponentId - Component id selected by the user, or `undefined` to select the first component.
 * @returns The selected component plus incoming, outgoing, external, and diagnostic context.
 */
export function inspectComponentConnections(
  snapshot: PlatformShellSnapshot | undefined,
  selectedComponentId: string | undefined,
): ComponentConnectionSummary | undefined {
  if (!snapshot || snapshot.components.length === 0) {
    return undefined;
  }

  const componentById = new Map(snapshot.components.map((component) => [component.id, component]));
  const component = selectedComponentId ? componentById.get(selectedComponentId) ?? snapshot.components[0] : snapshot.components[0];

  if (!component) {
    return undefined;
  }

  const outgoing: PlatformSnapshot[] = [];
  const externalDependencies: string[] = [];

  for (const dependency of component.dependencies) {
    const dependencyComponent = componentById.get(dependency);
    if (dependencyComponent) {
      outgoing.push(dependencyComponent);
    } else {
      externalDependencies.push(dependency);
    }
  }

  const incoming = snapshot.components.filter((candidate) => candidate.id !== component.id && candidate.dependencies.includes(component.id));
  const diagnostics = snapshot.diagnostics.filter(
    (issue) => issue.componentId === component.id || (issue.dependsOn?.includes(component.id) ?? false),
  );

  return {
    component,
    diagnostics,
    externalDependencies,
    incoming,
    outgoing,
  };
}

function resolveNodePositions(snapshot: PlatformShellSnapshot, width: number, height: number): Map<string, { x: number; y: number }> {
  const radius = Math.min(width, height) / 2 - 70;
  const centerX = width / 2;
  const centerY = height / 2;
  const positions = new Map<string, { x: number; y: number }>();
  const externalDependencies = collectExternalDependencies(snapshot.components);
  const nodeIds = [
    ...snapshot.components.map((component) => component.id),
    ...externalDependencies,
  ];

  nodeIds.forEach((id, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(nodeIds.length, 1);
    positions.set(id, {
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    });
  });

  return positions;
}

/**
 * Renders Studio's browser graph SVG with the same internal and external dependency semantics as Mermaid output.
 *
 * @param snapshot - Filtered platform snapshot currently shown in the viewer.
 * @param selectedComponentId - Optional selected component id to highlight.
 * @returns SVG markup for the browser graph panel.
 */
export function renderGraphSvg(snapshot: PlatformShellSnapshot, selectedComponentId: string | undefined): string {
  const width = 900;
  const height = 460;
  const components = snapshot.components;
  const positions = resolveNodePositions(snapshot, width, height);
  const externalDependencies = collectExternalDependencies(components);
  const selectedComponent = selectedComponentId ? components.find((component) => component.id === selectedComponentId) : undefined;
  const selectedDependencyIds = new Set(selectedComponent?.dependencies ?? []);
  const selectedIncomingIds = new Set(
    selectedComponentId
      ? components.filter((component) => component.dependencies.includes(selectedComponentId)).map((component) => component.id)
      : [],
  );

  const edgeLines = components
    .flatMap((component: PlatformSnapshot) =>
      component.dependencies.map((dependency: string) => {
        const from = positions.get(component.id);
        const to = positions.get(dependency);
        if (!from || !to) {
          return '';
        }

        const isSelectedEdge = component.id === selectedComponentId || dependency === selectedComponentId;
        return `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" class="edge-line${isSelectedEdge ? ' edge-selected' : ''}" marker-end="url(#arrow)" />`;
      }))
    .join('');

  const componentNodes = components
    .map((component: PlatformSnapshot) => {
      const point = positions.get(component.id);
      if (!point) {
        return '';
      }

      const readinessClass = component.readiness.status === 'not-ready'
        ? 'component-not-ready'
        : component.readiness.status === 'degraded'
        ? 'component-degraded'
        : 'component-ready';

      const classes = [
        'module-node',
        readinessClass,
        component.id === selectedComponentId ? 'module-selected' : '',
        selectedDependencyIds.has(component.id) ? 'module-neighbor' : '',
        selectedIncomingIds.has(component.id) ? 'module-dependent' : '',
      ]
        .filter(Boolean)
        .join(' ');

      return `<g>
  <circle cx="${point.x}" cy="${point.y}" r="34" class="${classes}" data-component="${escapeHtml(component.id)}" tabindex="0" role="button" aria-label="Inspect ${escapeHtml(component.id)}" />
  <text x="${point.x}" y="${point.y + 4}" text-anchor="middle" class="module-label">${escapeHtml(component.id)}</text>
</g>`;
    })
    .join('');

  const externalNodes = externalDependencies
    .map((dependency) => {
      const point = positions.get(dependency);
      if (!point) {
        return '';
      }

      const classes = [
        'module-node',
        'component-external',
        selectedDependencyIds.has(dependency) ? 'module-neighbor' : '',
      ]
        .filter(Boolean)
        .join(' ');

      return `<g>
  <rect x="${point.x - 42}" y="${point.y - 20}" width="84" height="40" rx="10" class="${classes}" />
  <text x="${point.x}" y="${point.y + 4}" text-anchor="middle" class="module-label">${escapeHtml(dependency)}</text>
</g>`;
    })
    .join('');

  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Platform component dependency graph">
  <defs>
    <marker id="arrow" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" class="edge-arrow" />
    </marker>
  </defs>
  ${edgeLines}
  ${componentNodes}
  ${externalNodes}
</svg>`;
}

/**
 * Renders diagnostic issue cards for the Studio browser viewer.
 *
 * @param snapshot - Loaded platform snapshot, if one is available.
 * @returns HTML markup for the diagnostics section.
 */
export function renderDiagnostics(snapshot: PlatformShellSnapshot | undefined): string {
  if (!snapshot) {
    return '<p class="muted">No platform snapshot loaded.</p>';
  }

  if (snapshot.diagnostics.length === 0) {
    return '<p class="muted">No diagnostics issues.</p>';
  }

  return `<div class="diagnostics-list">
    ${snapshot.diagnostics
      .map((issue: PlatformDiagnosticIssue) => {
        const dependsOn = issue.dependsOn && issue.dependsOn.length > 0
          ? `<div class="chips">${issue.dependsOn.map((dependency: string) => `<span class="chip">dependsOn: ${escapeHtml(dependency)}</span>`).join('')}</div>`
          : '';

        return `<article class="card issue severity-${escapeHtml(issue.severity)}">
          <h3>${escapeHtml(issue.code)}</h3>
          <p><strong>severity:</strong> ${escapeHtml(issue.severity)} · <strong>component:</strong> ${escapeHtml(issue.componentId)}</p>
          <p>${escapeHtml(issue.message)}</p>
          ${issue.cause ? `<p><strong>cause:</strong> ${escapeHtml(issue.cause)}</p>` : ''}
          ${issue.fixHint ? `<p><strong>fix hint:</strong> ${escapeHtml(issue.fixHint)}</p>` : ''}
          ${issue.docsUrl ? renderDiagnosticDocsUrl(issue.docsUrl) : ''}
          ${dependsOn}
        </article>`;
      })
      .join('')}
  </div>`;
}
