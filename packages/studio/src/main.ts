import './styles.css';

import {
  applyFilters,
  parseStudioPayload,
  renderMermaid,
  type FilterState,
  type PlatformDiagnosticSeverity,
  type PlatformReadinessStatus,
  type StudioPayload,
} from './contracts.js';

import type { PlatformDiagnosticIssue, PlatformShellSnapshot, PlatformSnapshot } from '@fluojs/runtime';

interface StudioState {
  payload?: StudioPayload;
  filteredSnapshot?: PlatformShellSnapshot;
  selectedComponentId?: string;
  filter: FilterState;
  rawJson?: string;
}

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('App root not found.');
}

const root = app;

const readinessOptions: PlatformReadinessStatus[] = ['ready', 'degraded', 'not-ready'];
const severityOptions: PlatformDiagnosticSeverity[] = ['error', 'warning', 'info'];

const state: StudioState = {
  filter: {
    query: '',
    readinessStatuses: [],
    severities: [],
  },
};

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function copyToClipboard(text: string): Promise<void> {
  if (!navigator.clipboard) {
    throw new Error('Clipboard API is unavailable.');
  }

  await navigator.clipboard.writeText(text);
}

function toggleValue<T extends string>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
}

function getSelectedComponent(snapshot: PlatformShellSnapshot | undefined, selectedId: string | undefined): PlatformSnapshot | undefined {
  if (!snapshot || snapshot.components.length === 0) {
    return undefined;
  }

  const selected = selectedId ? snapshot.components.find((component: PlatformSnapshot) => component.id === selectedId) : undefined;
  return selected ?? snapshot.components[0];
}

function computeFilteredSnapshot(): void {
  const snapshot = state.payload?.snapshot;
  if (!snapshot) {
    state.filteredSnapshot = undefined;
    state.selectedComponentId = undefined;
    return;
  }

  state.filteredSnapshot = applyFilters(snapshot, state.filter);
  const selected = getSelectedComponent(state.filteredSnapshot, state.selectedComponentId);
  state.selectedComponentId = selected?.id;
}

function renderGraphSvg(snapshot: PlatformShellSnapshot, selectedComponentId: string | undefined): string {
  const width = 900;
  const height = 460;
  const radius = Math.min(width, height) / 2 - 70;
  const centerX = width / 2;
  const centerY = height / 2;
  const components = snapshot.components;
  const positions = new Map<string, { x: number; y: number }>();

  components.forEach((component: PlatformSnapshot, index: number) => {
    const angle = (Math.PI * 2 * index) / Math.max(components.length, 1);
    positions.set(component.id, {
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    });
  });

  const edgeLines = components
    .flatMap((component: PlatformSnapshot) =>
      component.dependencies.map((dependency: string) => {
        const from = positions.get(component.id);
        const to = positions.get(dependency);
        if (!from || !to) {
          return '';
        }

        return `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" class="edge-line" marker-end="url(#arrow)" />`;
      }))
    .join('');

  const nodeCircles = components
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
      ]
        .filter(Boolean)
        .join(' ');

      return `<g>
  <circle cx="${point.x}" cy="${point.y}" r="34" class="${classes}" data-component="${escapeHtml(component.id)}" />
  <text x="${point.x}" y="${point.y + 4}" text-anchor="middle" class="module-label">${escapeHtml(component.id)}</text>
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
  ${nodeCircles}
</svg>`;
}

function renderDetails(component: PlatformSnapshot | undefined): string {
  if (!component) {
    return '<p class="muted">No component selected.</p>';
  }

  const dependencies = component.dependencies.length > 0
    ? component.dependencies.map((entry: string) => `<span class="chip">dependsOn: ${escapeHtml(entry)}</span>`).join('')
    : '<span class="chip">dependsOn: none</span>';

  return `
    <h3>${escapeHtml(component.id)}</h3>
    <p class="muted">kind: <strong>${escapeHtml(component.kind)}</strong> · state: <strong>${escapeHtml(component.state)}</strong></p>
    <div class="chips">
      <span class="chip">readiness: ${escapeHtml(component.readiness.status)}</span>
      <span class="chip">critical: ${component.readiness.critical ? 'true' : 'false'}</span>
      <span class="chip">health: ${escapeHtml(component.health.status)}</span>
      <span class="chip">ownership: owns=${component.ownership.ownsResources ? 'true' : 'false'}/external=${component.ownership.externallyManaged ? 'true' : 'false'}</span>
      ${dependencies}
    </div>
    <p class="muted">telemetry namespace: <code>${escapeHtml(component.telemetry.namespace)}</code></p>
    <h4>Sanitized details</h4>
    <pre>${escapeHtml(JSON.stringify(component.details, null, 2))}</pre>
  `;
}

function renderTiming(): string {
  const timing = state.payload?.timing;
  if (!timing) {
    return '<p class="muted">Timing not collected.</p>';
  }

  return `
    <p><strong>Total:</strong> ${timing.totalMs.toFixed(3)}ms</p>
    <table>
      <thead>
        <tr><th>phase</th><th>duration (ms)</th></tr>
      </thead>
      <tbody>
        ${timing.phases
          .map((phase: { durationMs: number; name: string }) => `<tr><td>${escapeHtml(phase.name)}</td><td>${phase.durationMs.toFixed(3)}</td></tr>`)
          .join('')}
      </tbody>
    </table>
  `;
}

function renderSnapshotSummary(snapshot: PlatformShellSnapshot | undefined): string {
  if (!snapshot) {
    return '<p class="muted">No platform snapshot loaded.</p>';
  }

  const counts = {
    degraded: snapshot.components.filter((component: PlatformSnapshot) => component.readiness.status === 'degraded').length,
    notReady: snapshot.components.filter((component: PlatformSnapshot) => component.readiness.status === 'not-ready').length,
    ready: snapshot.components.filter((component: PlatformSnapshot) => component.readiness.status === 'ready').length,
  };

  return `
    <div class="chips">
      <span class="chip">generatedAt: ${escapeHtml(snapshot.generatedAt)}</span>
      <span class="chip">aggregate readiness: ${escapeHtml(snapshot.readiness.status)}</span>
      <span class="chip">aggregate health: ${escapeHtml(snapshot.health.status)}</span>
      <span class="chip">components: ${String(snapshot.components.length)}</span>
      <span class="chip">diagnostics: ${String(snapshot.diagnostics.length)}</span>
      <span class="chip">ready/degraded/not-ready: ${counts.ready}/${counts.degraded}/${counts.notReady}</span>
    </div>
  `;
}

function renderDiagnostics(snapshot: PlatformShellSnapshot | undefined): string {
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
          ${issue.docsUrl ? `<p><strong>docs:</strong> <a href="${escapeHtml(issue.docsUrl)}" target="_blank" rel="noreferrer">${escapeHtml(issue.docsUrl)}</a></p>` : ''}
          ${dependsOn}
        </article>`;
      })
      .join('')}
  </div>`;
}

function renderApp(message?: string): void {
  const snapshot = state.filteredSnapshot;
  const selectedComponent = getSelectedComponent(snapshot, state.selectedComponentId);
  const mermaidText = snapshot ? renderMermaid(snapshot) : '';
  const graphSvg = snapshot && snapshot.components.length > 0
    ? renderGraphSvg(snapshot, selectedComponent?.id)
    : '<p class="muted">No platform components loaded.</p>';

  root.innerHTML = `
    <main>
      <header>
        <h1>Konekti Studio Platform Snapshot Viewer</h1>
        <p>Load JSON exported by <code>konekti inspect --json</code> (shared platform snapshot/diagnostic schema) and optionally timing JSON from <code>--timing</code>.</p>
      </header>

      <section class="card uploader" id="drop-zone">
        <h2>Diagnostics file input</h2>
        <p>Drag & drop a JSON file, or choose one manually.</p>
        <input type="file" id="file-input" accept="application/json" />
        <div class="actions">
          <button id="download-json" ${state.rawJson ? '' : 'disabled'}>Download loaded JSON</button>
          <button id="copy-json" ${state.rawJson ? '' : 'disabled'}>Copy loaded JSON</button>
          <button id="copy-mermaid" ${snapshot ? '' : 'disabled'}>Copy Mermaid</button>
        </div>
        ${message ? `<p class="notice">${escapeHtml(message)}</p>` : ''}
      </section>

      <section class="card">
        <h2>Snapshot summary</h2>
        ${renderSnapshotSummary(snapshot)}
      </section>

      <section class="split-grid">
        <div class="card">
          <h2>Search and filtering</h2>
          <label>
            Search component/diagnostic
            <input type="text" id="search" value="${escapeHtml(state.filter.query)}" placeholder="e.g. redis.default or QUEUE_DEPENDENCY_NOT_READY" />
          </label>

          <div class="filter-row">
            <span>Component readiness</span>
            ${readinessOptions
              .map((status) => `<label><input type="checkbox" data-readiness="${status}" ${state.filter.readinessStatuses.includes(status) ? 'checked' : ''}/> ${status}</label>`)
              .join('')}
          </div>

          <div class="filter-row">
            <span>Diagnostic severity</span>
            ${severityOptions
              .map((severity) => `<label><input type="checkbox" data-severity="${severity}" ${state.filter.severities.includes(severity) ? 'checked' : ''}/> ${severity}</label>`)
              .join('')}
          </div>
        </div>

        <div class="card">
          <h2>Timing</h2>
          ${renderTiming()}
        </div>
      </section>

      <section class="card">
        <h2>Platform dependency graph</h2>
        <p class="muted">Component dependencies are rendered directly from the shared platform snapshot schema.</p>
        <div id="graph-host">${graphSvg}</div>
      </section>

      <section class="split-grid">
        <div class="card" id="details-panel">
          <h2>Component details</h2>
          ${renderDetails(selectedComponent)}
        </div>
        <div class="card">
          <h2>Mermaid output</h2>
          <pre>${escapeHtml(mermaidText || 'No snapshot loaded.')}</pre>
        </div>
      </section>

      <section class="card">
        <h2>Diagnostics issues</h2>
        <p class="muted">Fix hints and dependency chains are rendered from <code>diagnostics.fixHint</code> and <code>diagnostics.dependsOn</code>.</p>
        ${renderDiagnostics(snapshot)}
      </section>
    </main>
  `;

  const fileInput = document.querySelector<HTMLInputElement>('#file-input');
  const dropZone = document.querySelector<HTMLElement>('#drop-zone');
  const searchInput = document.querySelector<HTMLInputElement>('#search');
  const copyJsonButton = document.querySelector<HTMLButtonElement>('#copy-json');
  const downloadJsonButton = document.querySelector<HTMLButtonElement>('#download-json');
  const copyMermaidButton = document.querySelector<HTMLButtonElement>('#copy-mermaid');

  const handleFile = async (file: File) => {
    const raw = await file.text();
    try {
      const parsed = parseStudioPayload(raw);
      state.payload = parsed.payload;
      state.rawJson = parsed.rawJson;
      computeFilteredSnapshot();
      renderApp('Diagnostics file loaded successfully.');
    } catch (error) {
      state.payload = undefined;
      state.filteredSnapshot = undefined;
      state.selectedComponentId = undefined;
      state.rawJson = undefined;
      renderApp(error instanceof Error ? error.message : 'Failed to parse diagnostics file.');
    }
  };

  fileInput?.addEventListener('change', async (event) => {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (file) {
      await handleFile(file);
    }
  });

  dropZone?.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropZone.classList.add('drag-active');
  });
  dropZone?.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-active');
  });
  dropZone?.addEventListener('drop', async (event) => {
    event.preventDefault();
    dropZone.classList.remove('drag-active');
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      await handleFile(file);
    }
  });

  searchInput?.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement;
    state.filter.query = target.value;
    computeFilteredSnapshot();
    renderApp();
  });

  document.querySelectorAll<HTMLInputElement>('input[data-readiness]').forEach((input) => {
    input.addEventListener('change', () => {
      state.filter.readinessStatuses = toggleValue(state.filter.readinessStatuses, input.dataset.readiness as PlatformReadinessStatus);
      computeFilteredSnapshot();
      renderApp();
    });
  });

  document.querySelectorAll<HTMLInputElement>('input[data-severity]').forEach((input) => {
    input.addEventListener('change', () => {
      state.filter.severities = toggleValue(state.filter.severities, input.dataset.severity as PlatformDiagnosticSeverity);
      computeFilteredSnapshot();
      renderApp();
    });
  });

  copyJsonButton?.addEventListener('click', async () => {
    if (!state.rawJson) {
      return;
    }
    try {
      await copyToClipboard(state.rawJson);
      renderApp('Loaded JSON copied to clipboard.');
    } catch (error) {
      renderApp(error instanceof Error ? error.message : 'Failed to copy JSON.');
    }
  });

  downloadJsonButton?.addEventListener('click', () => {
    if (!state.rawJson) {
      return;
    }
    downloadTextFile('konekti-diagnostics.json', state.rawJson);
    renderApp('Loaded JSON downloaded.');
  });

  copyMermaidButton?.addEventListener('click', async () => {
    if (!snapshot) {
      return;
    }
    try {
      await copyToClipboard(renderMermaid(snapshot));
      renderApp('Mermaid copied to clipboard.');
    } catch (error) {
      renderApp(error instanceof Error ? error.message : 'Failed to copy Mermaid text.');
    }
  });

  document.querySelectorAll<SVGCircleElement>('[data-component]').forEach((circle) => {
    circle.addEventListener('click', () => {
      const componentId = circle.dataset.component;
      if (!componentId) {
        return;
      }
      state.selectedComponentId = componentId;
      renderApp();
    });
  });
}

computeFilteredSnapshot();
renderApp();
