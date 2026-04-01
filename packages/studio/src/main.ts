import './styles.css';

import {
  applyFilters,
  parseStudioPayload,
  renderMermaid,
  type FilterState,
  type ProviderType,
  type RuntimeDiagnosticsGraph,
  type RuntimeDiagnosticsModule,
  type Scope,
  type StudioPayload,
} from './contracts.js';

interface StudioState {
  payload?: StudioPayload;
  filteredGraph?: RuntimeDiagnosticsGraph;
  selectedModuleName?: string;
  filter: FilterState;
  rawJson?: string;
}

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('App root not found.');
}

const root = app;

const scopeOptions: Scope[] = ['singleton', 'request', 'transient'];
const typeOptions: ProviderType[] = ['class', 'factory', 'value', 'existing'];

const state: StudioState = {
  filter: {
    globalsOnly: false,
    query: '',
    scopes: [],
    types: [],
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

function getSelectedModule(graph: RuntimeDiagnosticsGraph | undefined, selectedName: string | undefined): RuntimeDiagnosticsModule | undefined {
  if (!graph || graph.modules.length === 0) {
    return undefined;
  }

  const selected = selectedName ? graph.modules.find((module) => module.name === selectedName) : undefined;
  return selected ?? graph.modules[0];
}

function computeFilteredGraph(): void {
  const graph = state.payload?.graph;
  if (!graph) {
    state.filteredGraph = undefined;
    state.selectedModuleName = undefined;
    return;
  }

  state.filteredGraph = applyFilters(graph, state.filter);
  const selected = getSelectedModule(state.filteredGraph, state.selectedModuleName);
  state.selectedModuleName = selected?.name;
}

function renderGraphSvg(graph: RuntimeDiagnosticsGraph, selectedModuleName: string | undefined): string {
  const width = 900;
  const height = 460;
  const radius = Math.min(width, height) / 2 - 70;
  const centerX = width / 2;
  const centerY = height / 2;
  const modules = graph.modules;
  const positions = new Map<string, { x: number; y: number }>();

  modules.forEach((module, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(modules.length, 1);
    positions.set(module.name, {
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    });
  });

  const edgeLines = graph.relationships.moduleImports
    .map((edge) => {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      if (!from || !to) {
        return '';
      }
      return `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" class="edge-line" marker-end="url(#arrow)" />`;
    })
    .join('');

  const nodeCircles = modules
    .map((module) => {
      const point = positions.get(module.name);
      if (!point) {
        return '';
      }

      const classes = [
        'module-node',
        module.name === graph.rootModule ? 'module-root' : '',
        module.global ? 'module-global' : '',
        module.name === selectedModuleName ? 'module-selected' : '',
      ]
        .filter(Boolean)
        .join(' ');

      return `<g>
  <circle cx="${point.x}" cy="${point.y}" r="34" class="${classes}" data-module="${escapeHtml(module.name)}" />
  <text x="${point.x}" y="${point.y + 4}" text-anchor="middle" class="module-label">${escapeHtml(module.name)}</text>
</g>`;
    })
    .join('');

  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Module graph">
  <defs>
    <marker id="arrow" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" class="edge-arrow" />
    </marker>
  </defs>
  ${edgeLines}
  ${nodeCircles}
</svg>`;
}

function renderDetails(module: RuntimeDiagnosticsModule | undefined): string {
  if (!module) {
    return '<p class="muted">No module selected.</p>';
  }

  const providers = module.providers.map((provider) => `<tr>
<td>${escapeHtml(provider.token)}</td>
<td>${escapeHtml(provider.type)}</td>
<td>${escapeHtml(provider.scope)}</td>
<td>${provider.multi ? 'true' : 'false'}</td>
</tr>`).join('');

  return `
    <h3>${escapeHtml(module.name)}</h3>
    <p class="muted">global: <strong>${module.global ? 'true' : 'false'}</strong></p>
    <div class="chips">${module.imports.map((entry) => `<span class="chip">import: ${escapeHtml(entry)}</span>`).join('')}</div>
    <div class="chips">${module.exports.map((entry) => `<span class="chip">export: ${escapeHtml(entry)}</span>`).join('')}</div>
    <div class="chips">${module.controllers.map((entry) => `<span class="chip">controller: ${escapeHtml(entry)}</span>`).join('')}</div>
    <table>
      <thead>
        <tr><th>token</th><th>type</th><th>scope</th><th>multi</th></tr>
      </thead>
      <tbody>${providers}</tbody>
    </table>
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
          .map((phase) => `<tr><td>${escapeHtml(phase.name)}</td><td>${phase.durationMs.toFixed(3)}</td></tr>`)
          .join('')}
      </tbody>
    </table>
  `;
}

function renderApp(message?: string): void {
  const graph = state.filteredGraph;
  const selectedModule = getSelectedModule(graph, state.selectedModuleName);
  const mermaidText = graph ? renderMermaid(graph) : '';
  const graphSvg = graph && graph.modules.length > 0
    ? renderGraphSvg(graph, selectedModule?.name)
    : '<p class="muted">No diagnostics graph loaded.</p>';

  root.innerHTML = `
    <main>
      <header>
        <h1>Konekti Studio Diagnostics Viewer</h1>
        <p>Load JSON exported by <code>konekti inspect --json</code> and optionally timing JSON from <code>--timing</code>.</p>
      </header>

      <section class="card uploader" id="drop-zone">
        <h2>Diagnostics file input</h2>
        <p>Drag & drop a JSON file, or choose one manually.</p>
        <input type="file" id="file-input" accept="application/json" />
        <div class="actions">
          <button id="download-json" ${state.rawJson ? '' : 'disabled'}>Download loaded JSON</button>
          <button id="copy-json" ${state.rawJson ? '' : 'disabled'}>Copy loaded JSON</button>
          <button id="copy-mermaid" ${graph ? '' : 'disabled'}>Copy Mermaid</button>
        </div>
        ${message ? `<p class="notice">${escapeHtml(message)}</p>` : ''}
      </section>

      <section class="split-grid">
        <div class="card">
          <h2>Search and filtering</h2>
          <label>
            Search module/provider
            <input type="text" id="search" value="${escapeHtml(state.filter.query)}" placeholder="e.g. AppModule or UserService" />
          </label>

          <div class="filter-row">
            <span>Provider scope</span>
            ${scopeOptions
              .map((scope) => `<label><input type="checkbox" data-scope="${scope}" ${state.filter.scopes.includes(scope) ? 'checked' : ''}/> ${scope}</label>`)
              .join('')}
          </div>

          <div class="filter-row">
            <span>Provider type</span>
            ${typeOptions
              .map((type) => `<label><input type="checkbox" data-type="${type}" ${state.filter.types.includes(type) ? 'checked' : ''}/> ${type}</label>`)
              .join('')}
          </div>

          <label><input type="checkbox" id="globals-only" ${state.filter.globalsOnly ? 'checked' : ''} /> Globals only</label>
        </div>

        <div class="card">
          <h2>Timing</h2>
          ${renderTiming()}
        </div>
      </section>

      <section class="card">
        <h2>Module graph</h2>
        <p class="muted">Root module is highlighted in blue, global modules in green.</p>
        <div id="graph-host">${graphSvg}</div>
      </section>

      <section class="split-grid">
        <div class="card" id="details-panel">
          <h2>Details panel</h2>
          ${renderDetails(selectedModule)}
        </div>
        <div class="card">
          <h2>Mermaid output</h2>
          <pre>${escapeHtml(mermaidText || 'No graph loaded.')}</pre>
        </div>
      </section>
    </main>
  `;

  const fileInput = document.querySelector<HTMLInputElement>('#file-input');
  const dropZone = document.querySelector<HTMLElement>('#drop-zone');
  const searchInput = document.querySelector<HTMLInputElement>('#search');
  const globalsOnlyInput = document.querySelector<HTMLInputElement>('#globals-only');
  const copyJsonButton = document.querySelector<HTMLButtonElement>('#copy-json');
  const downloadJsonButton = document.querySelector<HTMLButtonElement>('#download-json');
  const copyMermaidButton = document.querySelector<HTMLButtonElement>('#copy-mermaid');

  const handleFile = async (file: File) => {
    const raw = await file.text();
    try {
      const parsed = parseStudioPayload(raw);
      state.payload = parsed.payload;
      state.rawJson = parsed.rawJson;
      computeFilteredGraph();
      renderApp('Diagnostics file loaded successfully.');
    } catch (error) {
      state.payload = undefined;
      state.filteredGraph = undefined;
      state.selectedModuleName = undefined;
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
    computeFilteredGraph();
    renderApp();
  });

  globalsOnlyInput?.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    state.filter.globalsOnly = target.checked;
    computeFilteredGraph();
    renderApp();
  });

  document.querySelectorAll<HTMLInputElement>('input[data-scope]').forEach((input) => {
    input.addEventListener('change', () => {
      state.filter.scopes = toggleValue(state.filter.scopes, input.dataset.scope as Scope);
      computeFilteredGraph();
      renderApp();
    });
  });

  document.querySelectorAll<HTMLInputElement>('input[data-type]').forEach((input) => {
    input.addEventListener('change', () => {
      state.filter.types = toggleValue(state.filter.types, input.dataset.type as ProviderType);
      computeFilteredGraph();
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
    if (!graph) {
      return;
    }
    try {
      await copyToClipboard(renderMermaid(graph));
      renderApp('Mermaid copied to clipboard.');
    } catch (error) {
      renderApp(error instanceof Error ? error.message : 'Failed to copy Mermaid text.');
    }
  });

  document.querySelectorAll<SVGCircleElement>('.module-node').forEach((circle) => {
    circle.addEventListener('click', () => {
      const moduleName = circle.dataset.module;
      if (!moduleName) {
        return;
      }
      state.selectedModuleName = moduleName;
      renderApp();
    });
  });
}

computeFilteredGraph();
renderApp();
