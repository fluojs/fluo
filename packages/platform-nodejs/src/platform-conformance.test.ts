import type { Dispatcher } from '@fluojs/http';
import type {
  PlatformComponent,
  PlatformHealthReport,
  PlatformReadinessReport,
  PlatformSnapshot,
  PlatformState,
  PlatformValidationResult,
} from '@fluojs/runtime';
import { createPlatformConformanceHarness } from '@fluojs/testing/platform-conformance';
import { describe, expect, it } from 'vitest';

import { createNodejsAdapter, type NodejsHttpApplicationAdapter } from './index.js';

const noopDispatcher: Dispatcher = {
  async dispatch() {},
};

class NodeAdapterPlatformComponentFixture implements PlatformComponent {
  readonly id = 'http.nodejs';
  readonly kind = 'http-adapter';
  private readonly adapter: NodejsHttpApplicationAdapter;
  private currentState: PlatformState;

  constructor(initialState: PlatformState = 'created') {
    this.adapter = createNodejsAdapter({ port: 0 });
    this.currentState = initialState;
  }

  async health(): Promise<PlatformHealthReport> {
    if (this.currentState === 'failed') {
      return { reason: 'Node adapter startup failed.', status: 'unhealthy' };
    }

    return { status: 'healthy' };
  }

  async ready(): Promise<PlatformReadinessReport> {
    if (this.currentState === 'failed') {
      return { critical: true, reason: 'Node adapter startup failed.', status: 'not-ready' };
    }

    if (this.currentState === 'degraded') {
      return { critical: true, reason: 'Node adapter is degraded.', status: 'degraded' };
    }

    return {
      critical: true,
      status: this.currentState === 'ready' ? 'ready' : 'not-ready',
    };
  }

  snapshot(): PlatformSnapshot {
    const failed = this.currentState === 'failed';
    const degraded = this.currentState === 'degraded';

    return {
      dependencies: [],
      details: {
        listenUrl: this.adapter.getListenTarget().url,
        listening: this.adapter.getServer().listening,
      },
      health: failed
        ? { reason: 'Node adapter startup failed.', status: 'unhealthy' }
        : { status: 'healthy' },
      id: this.id,
      kind: this.kind,
      ownership: {
        externallyManaged: false,
        ownsResources: true,
      },
      readiness: failed
        ? { critical: true, reason: 'Node adapter startup failed.', status: 'not-ready' }
        : degraded
          ? { critical: true, reason: 'Node adapter is degraded.', status: 'degraded' }
          : { critical: true, status: this.currentState === 'ready' ? 'ready' : 'not-ready' },
      state: this.currentState,
      telemetry: {
        namespace: 'fluo.platform.nodejs',
        tags: {},
      },
    };
  }

  async start(): Promise<void> {
    if (this.currentState === 'ready') {
      return;
    }

    this.currentState = 'starting';

    try {
      await this.adapter.listen(noopDispatcher);
      this.currentState = 'ready';
    } catch (error) {
      this.currentState = 'failed';
      throw error;
    }
  }

  state(): PlatformState {
    return this.currentState;
  }

  async stop(): Promise<void> {
    if (this.currentState === 'stopped') {
      return;
    }

    this.currentState = 'stopping';

    try {
      await this.adapter.close();
      this.currentState = 'stopped';
    } catch (error) {
      this.currentState = 'failed';
      throw error;
    }
  }

  validate(): PlatformValidationResult {
    return { issues: [], ok: true };
  }
}

describe('@fluojs/platform-nodejs platform conformance', () => {
  it('satisfies the shared platform lifecycle, diagnostics, and snapshot contract', async () => {
    const harness = createPlatformConformanceHarness({
      captureValidationSideEffects: (component: PlatformComponent) => component.snapshot().details,
      createComponent: () => new NodeAdapterPlatformComponentFixture(),
      diagnostics: {
        expectedCodes: [],
      },
      scenarios: {
        degraded: {
          createComponent: () => new NodeAdapterPlatformComponentFixture('degraded'),
          enterState: () => undefined,
          expectedState: 'degraded',
          name: 'degraded Node adapter',
        },
        failed: {
          createComponent: () => new NodeAdapterPlatformComponentFixture('failed'),
          enterState: () => undefined,
          expectedState: 'failed',
          name: 'failed Node adapter',
        },
      },
    });

    await expect(harness.assertAll()).resolves.toBeUndefined();
  });
});
