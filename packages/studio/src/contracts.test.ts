import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { applyFilters, parseStudioPayload, renderMermaid } from './contracts.js';
import type { PlatformShellSnapshot } from '@fluojs/runtime';

const packageDir = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));

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

describe('parseStudioPayload', () => {
  it('parses platform snapshot payload', () => {
    const parsed = parseStudioPayload(JSON.stringify(snapshotFixture));
    expect(parsed.payload.snapshot?.components[0]?.id).toBe('redis.default');
    expect(parsed.payload.snapshot?.diagnostics[0]?.code).toBe('QUEUE_DEPENDENCY_NOT_READY');
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

  it('keeps the Studio release contract aligned across manifest and README docs', () => {
    const packageManifest = JSON.parse(readFileSync(resolve(packageDir, 'package.json'), 'utf8')) as {
      name: string;
      private?: boolean;
      publishConfig?: { access?: string };
    };
    const readme = readFileSync(resolve(packageDir, 'README.md'), 'utf8');
    const readmeKo = readFileSync(resolve(packageDir, 'README.ko.md'), 'utf8');
    const releaseGovernance = readFileSync(resolve(packageDir, '../../docs/operations/release-governance.md'), 'utf8');

    expect(packageManifest.name).toBe('@fluojs/studio');
    expect(packageManifest.private).toBe(false);
    expect(packageManifest.publishConfig?.access).toBe('public');
    expect(releaseGovernance).toContain('- `@fluojs/studio`');
    expect(readme).toContain('pnpm add @fluojs/studio');
    expect(readme).toContain('intended public publish surface');
    expect(readmeKo).toContain('pnpm add @fluojs/studio');
    expect(readmeKo).toContain('공개 배포 패키지');
  });
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
});

describe('renderMermaid', () => {
  it('renders component nodes and dependency edges', () => {
    const output = renderMermaid(snapshotFixture);
    expect(output).toContain('graph TD');
    expect(output).toContain('queue.default');
    expect(output).toContain('-->');
    expect(output).toContain('degraded');
  });
});
