import { describe, expect, it } from 'vitest';

import { applyFilters, parseStudioPayload, renderMermaid } from './contracts.js';
import type { PlatformShellSnapshot } from '@fluojs/runtime';

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
        namespace: 'konekti.redis',
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
        namespace: 'konekti.queue',
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
