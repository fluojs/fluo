import { Module } from '@fluojs/core';
import type { BootstrapTimingDiagnostics as CoreTiming, StudioRouteDescriptor as CoreRoute } from '@fluojs/core/internal';
import type { BootstrapTimingDiagnostics, PlatformShellSnapshot, RuntimeDiagnosticsGraph } from '@fluojs/diagnostics';
import { parseStudioLiveEvent, parseStudioPayload } from '@fluojs/studio';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { bootstrapModule, FluoFactory } from './bootstrap.js';
import { createStudioLiveSnapshot } from './devtools/snapshot.js';
import { StudioDevtoolsRuntime } from './devtools/studio-runtime.js';
import type { StudioLiveEvent, StudioRouteDescriptor as RuntimeRoute } from './devtools/contracts.js';
import { createBootstrapTimingDiagnostics, createRuntimeDiagnosticsGraph } from './health/diagnostics.js';
import type { BootstrapTimingDiagnostics as RuntimeTiming, PlatformShellSnapshot as RuntimeSnapshot, RuntimeDiagnosticsGraph as RuntimeGraph } from './index.js';
import { RuntimePlatformShell } from './platform-shell.js';
import { createRuntimeInspectionSnapshot } from './route-inspection.js';

@Module()
class DiagnosticsAppModule {}

describe('diagnostics producer consumer conformance', () => {
  it('round-trips a real platform shell static snapshot and rounded bootstrap timing', async () => {
    const shell = new RuntimePlatformShell([]);
    await shell.start();
    try {
      const snapshot = createRuntimeInspectionSnapshot(await shell.snapshot(), []);
      const timing = createBootstrapTimingDiagnostics([{ durationMs: 1.234567, name: 'bootstrap_module' }], 1.234567);

      const parsed = parseStudioPayload(JSON.stringify({ snapshot, timing }));

      expect(parsed.payload.snapshot).toEqual(snapshot);
      expect(parsed.payload.timing).toEqual({ phases: [{ durationMs: 1.235, name: 'bootstrap_module' }], totalMs: 1.235, version: 1 });
      expect(parsed.payload.snapshot).not.toHaveProperty('graph');
      expectTypeOf<RuntimeSnapshot>().toEqualTypeOf<PlatformShellSnapshot>();
      expectTypeOf<RuntimeTiming>().toEqualTypeOf<BootstrapTimingDiagnostics>();
      expectTypeOf<CoreTiming>().toEqualTypeOf<BootstrapTimingDiagnostics>();
      expectTypeOf<CoreRoute['kind']>().toEqualTypeOf<string | undefined>();
      expectTypeOf<RuntimeRoute['kind']>().toEqualTypeOf<string>();
      expectTypeOf<RuntimeRoute['graphNodeId']>().toEqualTypeOf<string>();
      expectTypeOf<RuntimeRoute['params']>().toEqualTypeOf<string[]>();
    } finally {
      await shell.stop();
    }
  });

  it('round-trips actual runtime live graph timing and every event variant', async () => {
    const context = await FluoFactory.createApplicationContext(DiagnosticsAppModule, { diagnostics: { timing: true } });
    try {
      const modules = bootstrapModule(DiagnosticsAppModule).modules;
      const timing = context.bootstrapTiming;
      if (!timing) {
        throw new Error('Expected bootstrap timing from timing-enabled context.');
      }
      const snapshot = createStudioLiveSnapshot({ appId: 'conformance', modules, rootModule: DiagnosticsAppModule, timing });
      const events: StudioLiveEvent[] = [];
      const runtime = new StudioDevtoolsRuntime({
        appId: 'conformance',
        epoch: 'epoch-test',
        transport: { publish(event) { events.push(event); } },
      });
      runtime.publish('snapshot', snapshot);
      runtime.publish('timing', timing);
      runtime.publish('diagnostic', { code: 'EXAMPLE', message: 'example', severity: 'info' });
      runtime.publish('heartbeat', { uptimeMs: 0 });
      runtime.publish('restart', { phase: 'starting' });
      runtime.publish('disconnect', { reason: 'closed' });
      runtime.publish('request', { method: 'GET', path: '/', requestId: 'req-1', startedAt: snapshot.generatedAt, status: 'started', url: '/' });

      const parsed = events.map((event) => parseStudioLiveEvent(JSON.stringify(event)));

      expect(parsed).toEqual(events);
      expect(parsed.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7]);
      expect(snapshot.graph.nodes).toContainEqual(expect.objectContaining({ kind: 'module', label: 'DiagnosticsAppModule' }));
      const graph: RuntimeDiagnosticsGraph = createRuntimeDiagnosticsGraph(modules, DiagnosticsAppModule);
      expect(graph.rootModule).toBe('DiagnosticsAppModule');
      expectTypeOf<RuntimeGraph>().toEqualTypeOf<RuntimeDiagnosticsGraph>();
    } finally {
      await context.close();
    }
  });
});
