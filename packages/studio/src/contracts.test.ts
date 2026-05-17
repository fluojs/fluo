// @vitest-environment happy-dom

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PlatformShellSnapshot } from '@fluojs/runtime';
import { describe, expect, it, vi } from 'vitest';
import { applyFilters, parseStudioPayload, renderMermaid } from './contracts.js';
import * as studio from './index.js';
import { renderDiagnosticDocsUrl, renderDiagnostics, renderGraphSvg } from './viewer-rendering.js';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageCommandTimeoutMs = 120_000;
const packageCommandKillSignal: NodeJS.Signals = 'SIGTERM';

function runPackageCommand(args: string[]): void {
  const result = spawnSync('pnpm', ['exec', ...args], {
    cwd: packageDir,
    encoding: 'utf8',
    killSignal: packageCommandKillSignal,
    timeout: packageCommandTimeoutMs,
  });

  expect(result.status, [result.stdout, result.stderr].filter(Boolean).join('\n')).toBe(0);
}

function runIsolatedBuild(outputDirectory: string): void {
  runPackageCommand(['vite', 'build', '--outDir', outputDirectory, '--emptyOutDir']);
  runPackageCommand([
    'babel',
    'src/contracts.ts',
    'src/index.ts',
    '--extensions',
    '.ts',
    '--out-dir',
    outputDirectory,
    '--config-file',
    '../../tooling/babel/babel.config.cjs',
  ]);
}

const snapshotFixture: PlatformShellSnapshot = {
  components: [
    {
      dependencies: [],
      details: {
        host: 'localhost',
      },
      health: {
        status: 'healthy',
      },
      id: 'redis.default',
      kind: 'redis',
      ownership: {
        externallyManaged: false,
        ownsResources: true,
      },
      readiness: {
        critical: true,
        status: 'ready',
      },
      state: 'ready',
      telemetry: {
        namespace: 'fluo.redis',
        tags: {
          env: 'test',
        },
      },
    },
    {
      dependencies: ['redis.default'],
      details: {
        workers: 2,
      },
      health: {
        reason: 'Redis reconnect backoff active',
        status: 'degraded',
      },
      id: 'queue.default',
      kind: 'queue',
      ownership: {
        externallyManaged: false,
        ownsResources: true,
      },
      readiness: {
        critical: false,
        reason: 'Queue running in degraded mode',
        status: 'degraded',
      },
      state: 'degraded',
      telemetry: {
        namespace: 'fluo.queue',
        tags: {
          env: 'test',
        },
      },
    },
  ],
  diagnostics: [
    {
      code: 'QUEUE_DEPENDENCY_NOT_READY',
      componentId: 'queue.default',
      dependsOn: ['redis.default'],
      fixHint: 'Verify Redis connectivity and queue configuration.',
      message: 'Queue startup requires a ready Redis component.',
      severity: 'warning',
    },
  ],
  generatedAt: '2026-04-02T00:00:00.000Z',
  health: {
    status: 'degraded',
  },
  readiness: {
    critical: true,
    status: 'degraded',
  },
};

async function loadStudioViewer(): Promise<void> {
  vi.resetModules();
  document.body.innerHTML = '<div id="app"></div>';

  await import('./main.js');
}

describe('parseStudioPayload', () => {
  it('publishes contract helpers from the root package entrypoint', () => {
    expect(studio.parseStudioPayload).toBeTypeOf('function');
    expect(studio.applyFilters).toBeTypeOf('function');
    expect(studio.renderMermaid).toBeTypeOf('function');
  });

  it('publishes snapshot contract types from the root package entrypoint', () => {
    const snapshot: studio.PlatformShellSnapshot = snapshotFixture;
    const issue: studio.PlatformDiagnosticIssue = snapshotFixture.diagnostics[0];

    expect(snapshot.components).toHaveLength(2);
    expect(issue.code).toBe('QUEUE_DEPENDENCY_NOT_READY');
  });

  it('parses platform snapshot payload', () => {
    const rawJson = JSON.stringify(snapshotFixture);
    const parsed = parseStudioPayload(rawJson);
    expect(parsed.payload.snapshot?.components[0]?.id).toBe('redis.default');
    expect(parsed.payload.snapshot?.diagnostics[0]?.code).toBe('QUEUE_DEPENDENCY_NOT_READY');
    expect(parsed.rawJson).toBe(rawJson);
  });

  it('rejects arbitrary JSON objects that are not Studio inspect artifacts', () => {
    expect(() =>
      parseStudioPayload(
        JSON.stringify({
          components: 'not-a-component-list',
          generatedAt: '2026-04-02T00:00:00.000Z',
          random: true,
        }),
      )
    ).toThrow('Invalid platform snapshot payload.');
  });

  it('rejects malformed snapshot component and diagnostics payloads', () => {
    expect(() =>
      parseStudioPayload(
        JSON.stringify({
          ...snapshotFixture,
          components: [
            {
              ...snapshotFixture.components[0],
              dependencies: ['redis.default', 42],
            },
          ],
        }),
      )
    ).toThrow('Invalid component shape in platform snapshot payload.');

    expect(() =>
      parseStudioPayload(
        JSON.stringify({
          ...snapshotFixture,
          diagnostics: [
            {
              ...snapshotFixture.diagnostics[0],
              dependsOn: ['redis.default', { id: 'queue.default' }],
            },
          ],
        }),
      )
    ).toThrow('Invalid optional diagnostics issue fields in platform snapshot payload.');
  });

  it('parses envelope with snapshot and timing', () => {
    const parsed = parseStudioPayload(
      JSON.stringify({
        snapshot: snapshotFixture,
        timing: {
          phases: [{ durationMs: 1.23, name: 'bootstrap_module' }],
          totalMs: 1.23,
          version: 1,
        },
      }),
    );
    expect(parsed.payload.snapshot?.components).toHaveLength(2);
    expect(parsed.payload.timing?.phases).toHaveLength(1);
  });

  it('parses standalone timing diagnostics without requiring a snapshot', () => {
    const parsed = parseStudioPayload(
      JSON.stringify({
        phases: [{ durationMs: 1.23, name: 'bootstrap_module' }],
        totalMs: 1.23,
        version: 1,
      }),
    );

    expect(parsed.payload.snapshot).toBeUndefined();
    expect(parsed.payload.timing).toEqual({
      phases: [{ durationMs: 1.23, name: 'bootstrap_module' }],
      totalMs: 1.23,
      version: 1,
    });
  });

  it('rejects unsupported and malformed timing diagnostics before rendering', () => {
    expect(() =>
      parseStudioPayload(
        JSON.stringify({
          phases: [{ durationMs: 1.23, name: 'bootstrap_module' }],
          totalMs: 1.23,
          version: 2,
        }),
      )
    ).toThrow('Unsupported bootstrap timing version. Expected version: 1.');

    expect(() =>
      parseStudioPayload(
        JSON.stringify({
          phases: [{ durationMs: 'slow', name: 'bootstrap_module' }],
          totalMs: 1.23,
          version: 1,
        }),
      )
    ).toThrow('Invalid phase entry in bootstrap timing payload.');

    expect(() =>
      parseStudioPayload(
        JSON.stringify({
          snapshot: snapshotFixture,
          timing: {
            phases: [],
            totalMs: '1.23',
            version: 1,
          },
        }),
      )
    ).toThrow('Invalid bootstrap timing payload.');
  });

  it('preserves inspect report artifacts with summary, snapshot, and timing', () => {
    const parsed = parseStudioPayload(
      JSON.stringify({
        generatedAt: snapshotFixture.generatedAt,
        snapshot: snapshotFixture,
        summary: {
          componentCount: 2,
          diagnosticCount: 1,
          errorCount: 0,
          healthStatus: 'degraded',
          readinessStatus: 'degraded',
          timingTotalMs: 4.56,
          warningCount: 1,
        },
        timing: {
          phases: [{ durationMs: 4.56, name: 'bootstrap_module' }],
          totalMs: 4.56,
          version: 1,
        },
        version: 1,
      }),
    );

    expect(parsed.payload.report).toEqual({
      generatedAt: snapshotFixture.generatedAt,
      snapshot: snapshotFixture,
      summary: {
        componentCount: 2,
        diagnosticCount: 1,
        errorCount: 0,
        healthStatus: 'degraded',
        readinessStatus: 'degraded',
        timingTotalMs: 4.56,
        warningCount: 1,
      },
      timing: {
        phases: [{ durationMs: 4.56, name: 'bootstrap_module' }],
        totalMs: 4.56,
        version: 1,
      },
      version: 1,
    });
    expect(parsed.payload.snapshot).toBe(parsed.payload.report?.snapshot);
    expect(parsed.payload.timing).toBe(parsed.payload.report?.timing);
  });

  it('rejects malformed inspect report summaries before automation consumes them', () => {
    expect(() =>
      parseStudioPayload(
        JSON.stringify({
          generatedAt: snapshotFixture.generatedAt,
          snapshot: snapshotFixture,
          summary: {
            componentCount: 2,
            diagnosticCount: 1,
            errorCount: 0,
            healthStatus: 'degraded',
            readinessStatus: 'degraded',
            warningCount: 1,
          },
          timing: {
            phases: [{ durationMs: 4.56, name: 'bootstrap_module' }],
            totalMs: 4.56,
            version: 1,
          },
          version: 1,
        }),
      )
    ).toThrow('Invalid inspect report summary payload.');
  });

  it('rejects inspect report summaries that disagree with snapshot and timing payloads', () => {
    expect(() =>
      parseStudioPayload(
        JSON.stringify({
          generatedAt: snapshotFixture.generatedAt,
          snapshot: snapshotFixture,
          summary: {
            componentCount: 1,
            diagnosticCount: 1,
            errorCount: 0,
            healthStatus: 'degraded',
            readinessStatus: 'degraded',
            timingTotalMs: 4.56,
            warningCount: 1,
          },
          timing: {
            phases: [{ durationMs: 4.56, name: 'bootstrap_module' }],
            totalMs: 4.56,
            version: 1,
          },
          version: 1,
        }),
      )
    ).toThrow('Inspect report summary does not match snapshot and timing payload data.');

    expect(() =>
      parseStudioPayload(
        JSON.stringify({
          generatedAt: snapshotFixture.generatedAt,
          snapshot: snapshotFixture,
          summary: {
            componentCount: 2,
            diagnosticCount: 1,
            errorCount: 0,
            healthStatus: 'degraded',
            readinessStatus: 'degraded',
            timingTotalMs: 1,
            warningCount: 1,
          },
          timing: {
            phases: [{ durationMs: 4.56, name: 'bootstrap_module' }],
            totalMs: 4.56,
            version: 1,
          },
          version: 1,
        }),
      )
    ).toThrow('Inspect report summary does not match snapshot and timing payload data.');
  });

  it('rejects inspect report artifacts missing the required summary', () => {
    expect(() =>
      parseStudioPayload(
        JSON.stringify({
          generatedAt: snapshotFixture.generatedAt,
          snapshot: snapshotFixture,
          timing: {
            phases: [{ durationMs: 4.56, name: 'bootstrap_module' }],
            totalMs: 4.56,
            version: 1,
          },
          version: 1,
        }),
      )
    ).toThrow('Invalid inspect report artifact payload.');
  });

  it('keeps the Studio release contract aligned across manifest and README docs', () => {
    const packageManifest = JSON.parse(readFileSync(resolve(packageDir, 'package.json'), 'utf8')) as {
      name: string;
      private?: boolean;
      main?: string;
      types?: string;
      exports?: Record<string, unknown>;
      publishConfig?: { access?: string };
    };
    const readme = readFileSync(resolve(packageDir, 'README.md'), 'utf8');
    const readmeKo = readFileSync(resolve(packageDir, 'README.ko.md'), 'utf8');
    const releaseGovernance = readFileSync(resolve(packageDir, '../../docs/contracts/release-governance.md'), 'utf8');

    expect(packageManifest.name).toBe('@fluojs/studio');
    expect(packageManifest.private).toBe(false);
    expect(packageManifest.main).toBe('./dist/index.js');
    expect(packageManifest.types).toBe('./dist/index.d.ts');
    expect(packageManifest.publishConfig?.access).toBe('public');
    expect(packageManifest.exports).toEqual({
      '.': {
        types: './dist/index.d.ts',
        import: './dist/index.js',
      },
      './contracts': {
        types: './dist/contracts.d.ts',
        import: './dist/contracts.js',
      },
      './viewer': './dist/index.html',
    });
    expect(releaseGovernance).toContain('- `@fluojs/studio`');
    expect(readme).toContain('pnpm add @fluojs/studio');
    expect(readme).toContain('@fluojs/studio/contracts');
    expect(readme).toContain('@fluojs/studio/viewer');
    expect(readme).toContain('report artifacts');
    expect(readme).toContain('node -p "require.resolve(\'@fluojs/studio/viewer\')"');
    expect(readme).toContain('pnpm --dir packages/studio dev');
    expect(readme).toContain('preserve focus');
    expect(readme).toContain('intended public publish surface');
    expect(readmeKo).toContain('pnpm add @fluojs/studio');
    expect(readmeKo).toContain('@fluojs/studio/contracts');
    expect(readmeKo).toContain('@fluojs/studio/viewer');
    expect(readmeKo).toContain('report artifact');
    expect(readmeKo).toContain('node -p "require.resolve(\'@fluojs/studio/viewer\')"');
    expect(readmeKo).toContain('pnpm --dir packages/studio dev');
    expect(readmeKo).toContain('focus를 유지');
    expect(readmeKo).toContain('공개 배포 패키지');
  });

  it('keeps viewer filter controls focused across search, readiness, and severity rerenders', async () => {
    await loadStudioViewer();

    const fileInput = document.querySelector<HTMLInputElement>('#file-input');
    expect(fileInput).not.toBeNull();

    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      value: [new File([JSON.stringify(snapshotFixture)], 'snapshot.json', { type: 'application/json' })],
    });
    fileInput?.dispatchEvent(new Event('change', { bubbles: true }));

    await vi.waitFor(() => {
      expect(document.querySelector('#graph-host')?.textContent).toContain('redis.default');
    });

    const searchInput = document.querySelector<HTMLInputElement>('#search');
    expect(searchInput).not.toBeNull();
    searchInput!.value = 'redis.default';
    searchInput?.focus();
    searchInput?.setSelectionRange(2, 7);
    searchInput?.dispatchEvent(new Event('input', { bubbles: true }));

    const restoredSearchInput = document.querySelector<HTMLInputElement>('#search');
    expect(document.activeElement).toBe(restoredSearchInput);
    expect(restoredSearchInput?.value).toBe('redis.default');
    expect(restoredSearchInput?.selectionStart).toBe(2);
    expect(restoredSearchInput?.selectionEnd).toBe(7);

    const readinessInput = document.querySelector<HTMLInputElement>('#readiness-ready');
    expect(readinessInput).not.toBeNull();
    readinessInput?.focus();
    readinessInput!.checked = true;
    readinessInput?.dispatchEvent(new Event('change', { bubbles: true }));

    const restoredReadinessInput = document.querySelector<HTMLInputElement>('#readiness-ready');
    expect(document.activeElement).toBe(restoredReadinessInput);
    expect(restoredReadinessInput?.checked).toBe(true);

    const severityInput = document.querySelector<HTMLInputElement>('#severity-warning');
    expect(severityInput).not.toBeNull();
    severityInput?.focus();
    severityInput!.checked = true;
    severityInput?.dispatchEvent(new Event('change', { bubbles: true }));

    const restoredSeverityInput = document.querySelector<HTMLInputElement>('#severity-warning');
    expect(document.activeElement).toBe(restoredSeverityInput);
    expect(restoredSeverityInput?.checked).toBe(true);
  });

  it('loads a dropped Studio JSON file into graph, summary, and diagnostics views', async () => {
    await loadStudioViewer();

    const dropZone = document.querySelector<HTMLElement>('#drop-zone');
    expect(dropZone).not.toBeNull();

    const dropEvent = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(dropEvent, 'dataTransfer', {
      configurable: true,
      value: {
        files: [new File([JSON.stringify(snapshotFixture)], 'snapshot.json', { type: 'application/json' })],
      },
    });

    dropZone?.dispatchEvent(dropEvent);

    await vi.waitFor(() => {
      expect(document.querySelector('#graph-host')?.textContent).toContain('redis.default');
    });

    expect(document.querySelector('#drop-zone')?.textContent).toContain('Diagnostics file loaded successfully.');
    expect(document.querySelector('section:nth-of-type(2)')?.textContent).toContain('components: 2');
    expect(document.querySelector('section:nth-of-type(2)')?.textContent).toContain('diagnostics: 1');
    expect(document.body.textContent).toContain('QUEUE_DEPENDENCY_NOT_READY');
  });

  it('build emits isolated published helper and file-first viewer entrypoints', () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), 'fluo-studio-dist-'));

    try {
      runIsolatedBuild(outputDirectory);

      const html = readFileSync(resolve(outputDirectory, 'index.html'), 'utf8');

      expect(existsSync(resolve(outputDirectory, 'index.html')), 'viewer HTML entrypoint is missing').toBe(true);
      expect(existsSync(resolve(outputDirectory, 'index.js')), 'root helper barrel output is missing').toBe(true);
      expect(existsSync(resolve(outputDirectory, 'contracts.js')), 'contracts helper output is missing').toBe(true);
      expect(html).toContain('src="./assets/');
      expect(html).toContain('href="./assets/');
      expect(html).not.toContain('src="/assets/');
      expect(html).not.toContain('href="/assets/');
    } finally {
      rmSync(outputDirectory, { force: true, recursive: true });
    }
  }, 300_000);
});

describe('applyFilters', () => {
  it('filters by readiness and severity', () => {
    const filtered = applyFilters(snapshotFixture, {
      query: '',
      readinessStatuses: ['degraded'],
      severities: ['warning'],
    });

    expect(filtered.components.map((component: { id: string }) => component.id)).toEqual(['queue.default']);
    expect(filtered.diagnostics.map((issue: { code: string }) => issue.code)).toEqual(['QUEUE_DEPENDENCY_NOT_READY']);
  });

  it('applies query filters across component ids, kinds, and dependencies', () => {
    const filtered = applyFilters(snapshotFixture, {
      query: ' REDIS.DEFAULT ',
      readinessStatuses: [],
      severities: [],
    });

    expect(filtered.components.map((component: { id: string }) => component.id)).toEqual(['redis.default', 'queue.default']);
    expect(filtered.diagnostics.map((issue: { code: string }) => issue.code)).toEqual(['QUEUE_DEPENDENCY_NOT_READY']);
    expect(snapshotFixture.components).toHaveLength(2);
  });

  it('applies query filters across diagnostic metadata and blockers', () => {
    const filteredByHint = applyFilters(snapshotFixture, {
      query: 'connectivity',
      readinessStatuses: [],
      severities: [],
    });
    const filteredByBlocker = applyFilters(snapshotFixture, {
      query: 'redis.default',
      readinessStatuses: [],
      severities: ['warning'],
    });

    expect(filteredByHint.components).toEqual([]);
    expect(filteredByHint.diagnostics.map((issue: { code: string }) => issue.code)).toEqual(['QUEUE_DEPENDENCY_NOT_READY']);
    expect(filteredByBlocker.diagnostics.map((issue: { componentId: string }) => issue.componentId)).toEqual(['queue.default']);
  });

  it('returns empty component and diagnostic lists when filters match nothing', () => {
    const filtered = applyFilters(snapshotFixture, {
      query: 'missing-component',
      readinessStatuses: ['ready'],
      severities: ['error'],
    });

    expect(filtered.components).toEqual([]);
    expect(filtered.diagnostics).toEqual([]);
    expect(filtered.readiness).toBe(snapshotFixture.readiness);
  });
});

describe('renderMermaid', () => {
  it('renders component nodes and dependency edges', () => {
    const output = renderMermaid(snapshotFixture);
    expect(output).toContain('graph TD');
    expect(output).toContain('queue.default');
    expect(output).toContain('  C2 --> C1');
    expect(output).toContain('degraded');
  });

  it('renders external dependency nodes from snapshot dependencies', () => {
    const output = renderMermaid({
      ...snapshotFixture,
      components: [
        {
          ...snapshotFixture.components[0],
          dependencies: ['aws.sqs.orders'],
          id: 'queue.consumer',
        },
      ],
      diagnostics: [],
    });

    const externalNodeId = output.match(/ {2}(EXT_[A-Za-z0-9_]+)\["aws\.sqs\.orders"\]/)?.[1];

    expect(externalNodeId).toBeDefined();
    expect(output).toContain(`  C1 --> ${externalNodeId}`);
  });

  it('renders an explicit empty graph placeholder for empty snapshots', () => {
    const output = renderMermaid({
      ...snapshotFixture,
      components: [],
      diagnostics: [],
    });

    expect(output).toBe('graph TD\n  EMPTY["No registered platform components"]');
  });

  it('marks not-ready components while escaping Mermaid labels', () => {
    const output = renderMermaid({
      ...snapshotFixture,
      components: [
        {
          ...snapshotFixture.components[0],
          health: {
            status: 'unhealthy',
          },
          id: 'api."gateway"',
          readiness: {
            critical: true,
            status: 'not-ready',
          },
        },
      ],
      diagnostics: [],
      health: {
        status: 'unhealthy',
      },
      readiness: {
        critical: true,
        status: 'not-ready',
      },
    });

    expect(output).toContain('api.\\"gateway\\"');
    expect(output).toContain('readiness: not-ready');
    expect(output).toContain('  class C1 notReady');
    expect(output).toContain('  classDef notReady stroke:#ef4444,stroke-width:2px');
  });

  it('escapes Mermaid label control characters without changing graph edges', () => {
    const output = renderMermaid({
      ...snapshotFixture,
      components: [
        {
          ...snapshotFixture.components[0],
          dependencies: ['cache\\primary'],
          id: 'api\\gateway\nprimary',
          kind: 'http "adapter"',
        },
      ],
      diagnostics: [],
    });

    expect(output).toContain('api\\\\gateway\\nprimary');
    expect(output).toContain('kind: http \\"adapter\\"');
    expect(output).toContain('cache\\\\primary');
    expect(output).not.toContain('api\\gateway\nprimary');
  });

  it('uses distinct external node ids when dependency names sanitize to the same base', () => {
    const output = renderMermaid({
      ...snapshotFixture,
      components: [
        {
          ...snapshotFixture.components[0],
          dependencies: ['cache.one', 'cache-one'],
          id: 'api.gateway',
        },
      ],
      diagnostics: [],
    });

    const dotNodeId = output.match(/ {2}(EXT_[A-Za-z0-9_]+)\["cache\.one"\]/)?.[1];
    const dashNodeId = output.match(/ {2}(EXT_[A-Za-z0-9_]+)\["cache-one"\]/)?.[1];

    expect(dotNodeId).toBeDefined();
    expect(dashNodeId).toBeDefined();
    expect(dotNodeId).not.toBe(dashNodeId);
    expect(output).toContain(`  C1 --> ${dotNodeId}`);
    expect(output).toContain(`  C1 --> ${dashNodeId}`);
  });
});

describe('viewer rendering helpers', () => {
  it('renders only http and https diagnostic docsUrl values as links', () => {
    expect(renderDiagnosticDocsUrl('https://fluo.dev/docs/runtime')).toContain('href="https://fluo.dev/docs/runtime"');
    expect(renderDiagnosticDocsUrl('javascript:alert(1)')).toBe('<p><strong>docs:</strong> <span>javascript:alert(1)</span></p>');
    expect(renderDiagnosticDocsUrl('docs/runtime')).toBe('<p><strong>docs:</strong> <span>docs/runtime</span></p>');
  });

  it('escapes diagnostic docsUrl text even when no link is rendered', () => {
    expect(renderDiagnosticDocsUrl('javascript:<script>alert(1)</script>')).toContain('javascript:&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(renderDiagnosticDocsUrl('javascript:<script>alert(1)</script>')).not.toContain('<script>');
  });

  it('uses sanitized docsUrl rendering inside diagnostic cards', () => {
    const html = renderDiagnostics({
      ...snapshotFixture,
      diagnostics: [
        {
          code: 'UNSAFE_DOCS_URL',
          componentId: 'queue.default',
          docsUrl: 'javascript:alert(1)',
          message: 'Invalid docs URL should not be clickable.',
          severity: 'warning',
        },
      ],
    });

    expect(html).toContain('<span>javascript:alert(1)</span>');
    expect(html).not.toContain('href="javascript:alert(1)"');
  });

  it('renders browser graph edges and nodes for external dependencies', () => {
    const html = renderGraphSvg({
      ...snapshotFixture,
      components: [
        {
          ...snapshotFixture.components[0],
          dependencies: ['aws.sqs.orders'],
          id: 'queue.consumer',
        },
      ],
      diagnostics: [],
    }, undefined);

    expect(html).toContain('aws.sqs.orders');
    expect(html).toContain('component-external');
    expect(html).toContain('class="edge-line"');
  });
});
