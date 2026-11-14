import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PlatformComponent, PlatformReadinessReport } from './platform-contract.js';
import { RuntimePlatformShell } from './platform-shell.js';
import { FluoFactory, defineModule } from './bootstrap.js';

function component(id: string): PlatformComponent {
  return {
    id,
    kind: 'test',
    state: () => 'ready',
    validate: () => ({ ok: true, issues: [] }),
    start: async () => {},
    stop: async () => {},
    ready: async () => ({ critical: true, status: 'ready' }),
    health: async () => ({ status: 'healthy' }),
    snapshot: () => ({
      id, kind: 'test', state: 'ready', dependencies: [], details: {},
      readiness: { critical: true, status: 'ready' },
      health: { status: 'healthy' },
      ownership: { ownsResources: false, externallyManaged: true },
      telemetry: { namespace: 'test', tags: {} },
    }),
  };
}

afterEach(() => vi.useRealTimers());

describe('platform probe deadlines', () => {
  it.each([true, false])('snapshot: timeout critical=%s -> retains identity and bounded phase diagnostics', async (critical) => {
    vi.useFakeTimers();
    const stuck = component('stuck');
    let reject!: (reason: Error) => void;
    let resolve!: (value: PlatformReadinessReport) => void;
    stuck.ready = () => new Promise((done) => { resolve = done; });
    stuck.health = () => new Promise((_, fail) => { reject = fail; });
    const shell = RuntimePlatformShell.fromInputs([
      { component: stuck, dependencies: ['later'], readiness: { critical, timeoutMs: 12.9 } },
      component('later'),
    ]);
    const pending = shell.snapshot();

    await vi.advanceTimersByTimeAsync(12);
    const snapshot = await pending;
    resolve({ critical: false, status: 'ready' });
    reject(new Error('late health error'));
    await vi.advanceTimersByTimeAsync(0);

    expect(snapshot.readiness.status).toBe(critical ? 'not-ready' : 'degraded');
    expect(snapshot.health.status).toBe('unhealthy');
    expect(snapshot.components.map((entry) => entry.id)).toEqual(['stuck', 'later']);
    expect(snapshot.components[0]).toMatchObject({
      dependencies: ['later'],
      ownership: { ownsResources: false, externallyManaged: true },
    });
    expect(snapshot.diagnostics).toHaveLength(2);
    expect(snapshot.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ componentId: 'stuck', cause: expect.stringContaining('ready probe timed out after 12 ms') }),
      expect.objectContaining({ componentId: 'stuck', cause: expect.stringContaining('health probe timed out after 12 ms') }),
    ]));
    const again = shell.snapshot();
    await vi.advanceTimersByTimeAsync(12);
    expect((await again).diagnostics).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ready and health: custom budgets -> preserves registration order and continues after timeout', async () => {
    vi.useFakeTimers();
    const stuck = component('stuck');
    stuck.ready = () => new Promise(() => {});
    stuck.health = () => new Promise(() => {});
    const later = component('later');
    const ready = vi.spyOn(later, 'ready');
    const health = vi.spyOn(later, 'health');
    const shell = RuntimePlatformShell.fromInputs([
      { component: stuck, readiness: { critical: false, timeoutMs: 0.5 } },
      later,
    ]);
    const readiness = shell.ready();
    const healthReport = shell.health();
    await vi.advanceTimersByTimeAsync(0);
    expect(ready).not.toHaveBeenCalled();
    expect(health).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect((await readiness).status).toBe('degraded');
    expect((await healthReport).status).toBe('unhealthy');
    expect(ready).toHaveBeenCalledOnce();
    expect(health).toHaveBeenCalledOnce();
  });

  it.each(['ready', 'listen'] as const)('Application.%s: critical never-settling probe -> rejects within budget', async (method) => {
    const stuck = component('stuck');
    class AppModule {}
    defineModule(AppModule, {});
    const listen = vi.fn(async () => {});
    const app = await FluoFactory.create(AppModule, {
      adapter: { listen, close: async () => {} },
      platform: { components: [{ component: stuck, readiness: { timeoutMs: 10 } }] },
    });
    stuck.ready = () => new Promise(() => {});
    vi.useFakeTimers();
    const outcome = expect(app[method]()).rejects.toThrow('ready probe timed out after 10 ms');
    try {
      await vi.advanceTimersByTimeAsync(10);

      await outcome;
      expect(listen).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      await app.close();
    }
  });

  it('ready: never-settling component -> returns not-ready and checks later components', async () => {
    vi.useFakeTimers();
    const stuck = component('stuck');
    stuck.ready = () => new Promise(() => {});
    const later = component('later');
    const laterReady = vi.spyOn(later, 'ready');
    const shell = RuntimePlatformShell.fromInputs([stuck, later]);
    let report: PlatformReadinessReport | undefined;
    void shell.ready().then((value) => { report = value; });

    await vi.advanceTimersByTimeAsync(5000);

    expect(report?.status).toBe('not-ready');
    expect(laterReady).toHaveBeenCalledOnce();
  });
});
