import { describe, expect, it } from 'vitest';

import type {
  PlatformDiagnosticIssue,
  PlatformShellSnapshot,
  PlatformSnapshot,
  PlatformValidationResult,
} from './platform-contract.js';

describe('platform contract spine', () => {
  it('freezes the shared platform snapshot shape for tooling consumers', () => {
    const snapshot: PlatformSnapshot = {
      dependencies: ['redis.default'],
      details: {
        queueDepth: 3,
      },
      health: {
        reason: 'Redis ping latency within threshold.',
        status: 'healthy',
      },
      id: 'queue.default',
      kind: 'queue',
      ownership: {
        externallyManaged: false,
        ownsResources: true,
      },
      readiness: {
        critical: true,
        reason: 'Worker and enqueue path are serving traffic.',
        status: 'ready',
      },
      state: 'ready',
      telemetry: {
        namespace: 'konekti.queue',
        tags: {
          env: 'test',
          instance: 'local',
        },
      },
    };

    expect(Object.keys(snapshot).sort()).toEqual([
      'dependencies',
      'details',
      'health',
      'id',
      'kind',
      'ownership',
      'readiness',
      'state',
      'telemetry',
    ]);
    expect(Object.keys(snapshot.readiness).sort()).toEqual(['critical', 'reason', 'status']);
    expect(Object.keys(snapshot.health).sort()).toEqual(['reason', 'status']);
    expect(Object.keys(snapshot.telemetry).sort()).toEqual(['namespace', 'tags']);
    expect(Object.keys(snapshot.ownership).sort()).toEqual(['externallyManaged', 'ownsResources']);
  });

  it('freezes the shared diagnostic issue and validation payload shapes', () => {
    const issue: PlatformDiagnosticIssue = {
      cause: 'redis.default readiness check failed during startup.',
      code: 'QUEUE_DEPENDENCY_NOT_READY',
      componentId: 'queue.default',
      dependsOn: ['redis.default'],
      docsUrl: 'https://github.com/konektijs/konekti/tree/main/docs/concepts/platform-consistency-design.md',
      fixHint: 'Verify Redis connectivity or disable queue for this environment.',
      message: 'Queue startup requires a ready Redis component.',
      severity: 'error',
    };

    const validation: PlatformValidationResult = {
      issues: [issue],
      ok: false,
      warnings: [
        {
          code: 'QUEUE_DEGRADED_FALLBACK_ACTIVE',
          componentId: 'queue.default',
          message: 'Queue is running in degraded mode.',
          severity: 'warning',
        },
      ],
    };

    expect(Object.keys(issue).sort()).toEqual([
      'cause',
      'code',
      'componentId',
      'dependsOn',
      'docsUrl',
      'fixHint',
      'message',
      'severity',
    ]);
    expect(Object.keys(validation).sort()).toEqual(['issues', 'ok', 'warnings']);
    expect(validation.issues[0]).toEqual(issue);
  });

  it('freezes the runtime-owned platform shell snapshot envelope', () => {
    const shellSnapshot: PlatformShellSnapshot = {
      components: [
        {
          dependencies: ['redis.default'],
          details: {},
          health: {
            status: 'healthy',
          },
          id: 'queue.default',
          kind: 'queue',
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
            namespace: 'konekti.queue',
            tags: {},
          },
        },
      ],
      diagnostics: [],
      generatedAt: '2026-04-02T00:00:00.000Z',
      health: {
        status: 'healthy',
      },
      readiness: {
        critical: true,
        status: 'ready',
      },
    };

    expect(Object.keys(shellSnapshot).sort()).toEqual([
      'components',
      'diagnostics',
      'generatedAt',
      'health',
      'readiness',
    ]);
  });
});
