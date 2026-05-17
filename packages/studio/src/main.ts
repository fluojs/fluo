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

import type { PlatformShellSnapshot, PlatformSnapshot } from '@fluojs/runtime';
import {
  escapeHtml,
  inspectComponentConnections,
  renderDiagnostics,
  renderGraphSvg,
} from './viewer-rendering.js';

interface StudioState {
  payload?: StudioPayload;
  filteredSnapshot?: PlatformShellSnapshot;
  selectedComponentId?: string;
  filter: FilterState;
  rawJson?: string;
}

type FocusSnapshot = GraphFocusSnapshot | TextFocusSnapshot;

interface GraphFocusSnapshot {
  componentId: string;
  kind: 'graph-node';
}

interface TextFocusSnapshot {
  id: string;
  kind: 'text-control';
  selectionEnd: number | null;
  selectionStart: number | null;
}

interface RenderAppOptions {
  message?: string;
  preserveFocus?: boolean;
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

function isTextControl(element: Element | null): element is HTMLInputElement | HTMLTextAreaElement {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
}

function isFocusableElement(element: Element | null): element is HTMLElement | SVGElement {
  return element instanceof HTMLElement || element instanceof SVGElement;
}

function captureFocusSnapshot(): FocusSnapshot | undefined {
  const activeElement = document.activeElement;

  if (!isTextControl(activeElement) || !activeElement.id) {
    if (activeElement instanceof SVGElement && activeElement.dataset.component) {
      return {
        componentId: activeElement.dataset.component,
        kind: 'graph-node',
      };
    }

    return undefined;
  }

  return {
    id: activeElement.id,
    kind: 'text-control',
    selectionEnd: activeElement.selectionEnd,
    selectionStart: activeElement.selectionStart,
  };
}

function restoreFocusSnapshot(snapshot: FocusSnapshot | undefined): void {
  if (!snapshot) {
    return;
  }

  if (snapshot.kind === 'graph-node') {
    const target = Array.from(document.querySelectorAll<Element>('[data-component]')).find(
      (element) => element instanceof SVGElement && element.dataset.component === snapshot.componentId,
    );

    const focusTarget = target ?? null;
    if (isFocusableElement(focusTarget)) {
      focusTarget.focus({ preventScroll: true });
    }

    return;
  }

  const target = document.getElementById(snapshot.id);
  if (!isTextControl(target)) {
    return;
  }

  target.focus({ preventScroll: true });

  if (snapshot.selectionStart !== null && snapshot.selectionEnd !== null) {
    target.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
  }
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

function renderConnectionButton(component: PlatformSnapshot, relation: string): string {
  return `<button class="connection-button" data-select-component="${escapeHtml(component.id)}" type="button">
    <span>${escapeHtml(component.id)}</span>
    <small>${escapeHtml(relation)} · ${escapeHtml(component.kind)} · ${escapeHtml(component.readiness.status)}</small>
  </button>`;
}

function renderConnectionList(heading: string, emptyText: string, content: string): string {
  return `
    <section class="connection-group">
      <h4>${escapeHtml(heading)}</h4>
      ${content || `<p class="muted">${escapeHtml(emptyText)}</p>`}
    </section>
  `;
}

function renderConnectionExplorer(snapshot: PlatformShellSnapshot | undefined, selectedId: string | undefined): string {
  const summary = inspectComponentConnections(snapshot, selectedId);
  if (!summary) {
    return '<p class="muted">Load a platform snapshot to explore component connections.</p>';
  }

  const outgoing = summary.outgoing.map((component) => renderConnectionButton(component, 'dependency')).join('');
  const incoming = summary.incoming.map((component) => renderConnectionButton(component, 'dependent')).join('');
  const external = summary.externalDependencies
    .map((dependency) => `<span class="connection-pill external-pill">${escapeHtml(dependency)}</span>`)
    .join('');
  const diagnostics = summary.diagnostics
    .map((issue) => `<article class="connection-diagnostic severity-${escapeHtml(issue.severity)}">
      <strong>${escapeHtml(issue.code)}</strong>
      <span>${escapeHtml(issue.severity)} · ${escapeHtml(issue.componentId)}</span>
      <p>${escapeHtml(issue.message)}</p>
    </article>`)
    .join('');

  return `
    <div class="connection-hero">
      <div>
        <p class="eyebrow">Selected component</p>
        <h3>${escapeHtml(summary.component.id)}</h3>
        <p class="muted">${escapeHtml(summary.component.kind)} · state ${escapeHtml(summary.component.state)}</p>
      </div>
      <div class="connection-metrics" aria-label="Selected component connection counts">
        <span><strong>${String(summary.outgoing.length)}</strong> internal deps</span>
        <span><strong>${String(summary.externalDependencies.length)}</strong> external deps</span>
        <span><strong>${String(summary.incoming.length)}</strong> dependents</span>
      </div>
    </div>
    <div class="connection-grid">
      ${renderConnectionList('Depends on', 'No internal component dependencies.', outgoing)}
      ${renderConnectionList('Required by', 'No components depend on this selection.', incoming)}
      ${renderConnectionList('External dependencies', 'No external dependencies.', external)}
      ${renderConnectionList('Related diagnostics', 'No related diagnostics.', diagnostics)}
    </div>
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

function renderApp(options: RenderAppOptions | string = {}): void {
  const message = typeof options === 'string' ? options : options.message;
  const focusSnapshot = typeof options === 'string' || !options.preserveFocus ? undefined : captureFocusSnapshot();
  const snapshot = state.filteredSnapshot;
  const selectedComponent = getSelectedComponent(snapshot, state.selectedComponentId);
  const mermaidText = snapshot ? renderMermaid(snapshot) : '';
  const graphSvg = snapshot && snapshot.components.length > 0
    ? renderGraphSvg(snapshot, selectedComponent?.id)
    : '<p class="muted">No platform components loaded.</p>';

  root.innerHTML = `
    <main>
      <header>
        <h1>Fluo Studio Platform Snapshot Viewer</h1>
        <p>Load JSON exported by <code>fluo inspect --json</code> (shared platform snapshot/diagnostic schema) and optionally timing JSON from <code>--timing</code>.</p>
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
              .map((status) => `<label><input type="checkbox" id="readiness-${status}" data-readiness="${status}" ${state.filter.readinessStatuses.includes(status) ? 'checked' : ''}/> ${status}</label>`)
              .join('')}
          </div>

          <div class="filter-row">
            <span>Diagnostic severity</span>
            ${severityOptions
              .map((severity) => `<label><input type="checkbox" id="severity-${severity}" data-severity="${severity}" ${state.filter.severities.includes(severity) ? 'checked' : ''}/> ${severity}</label>`)
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
        <p class="muted">Component dependencies are rendered directly from the shared platform snapshot schema. Select a node to inspect its dependency neighborhood.</p>
        <div id="graph-host">${graphSvg}</div>
      </section>

      <section class="card inspector-card">
        <h2>Connection explorer</h2>
        <p class="muted">Studio owns snapshot inspection and rendering: use this panel to inspect incoming and outgoing component relationships without changing CLI export semantics.</p>
        ${renderConnectionExplorer(snapshot, selectedComponent?.id)}
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
    renderApp({ preserveFocus: true });
  });

  document.querySelectorAll<HTMLInputElement>('input[data-readiness]').forEach((input) => {
    input.addEventListener('change', () => {
      state.filter.readinessStatuses = toggleValue(state.filter.readinessStatuses, input.dataset.readiness as PlatformReadinessStatus);
      computeFilteredSnapshot();
      renderApp({ preserveFocus: true });
    });
  });

  document.querySelectorAll<HTMLInputElement>('input[data-severity]').forEach((input) => {
    input.addEventListener('change', () => {
      state.filter.severities = toggleValue(state.filter.severities, input.dataset.severity as PlatformDiagnosticSeverity);
      computeFilteredSnapshot();
      renderApp({ preserveFocus: true });
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
    downloadTextFile('fluo-diagnostics.json', state.rawJson);
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
      renderApp({ preserveFocus: true });
    });
    circle.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }

      event.preventDefault();
      const componentId = circle.dataset.component;
      if (!componentId) {
        return;
      }
      state.selectedComponentId = componentId;
      renderApp();
    });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-select-component]').forEach((button) => {
    button.addEventListener('click', () => {
      const componentId = button.dataset.selectComponent;
      if (!componentId) {
        return;
      }
      state.selectedComponentId = componentId;
      renderApp();
    });
  });

  restoreFocusSnapshot(focusSnapshot);
}

computeFilteredSnapshot();
renderApp();
