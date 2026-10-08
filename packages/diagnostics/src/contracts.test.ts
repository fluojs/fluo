import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  parseStudioLiveEvent,
  parseStudioPayload,
  type PlatformShellSnapshot,
  type StudioLiveEventBase,
  type StudioNormalizedRouteDescriptor,
  type StudioRouteDescriptor,
} from './index.js';

const snapshot: PlatformShellSnapshot = {
  components: [],
  diagnostics: [],
  generatedAt: '2026-10-08T00:00:00.000Z',
  health: { status: 'healthy' },
  readiness: { critical: false, status: 'ready' },
};

const timing = {
  phases: [{ durationMs: 1.234, name: 'bootstrap_module' }],
  totalMs: 1.234,
  version: 1,
} as const;

describe('portable diagnostic readers', () => {
  it('normalizes omitted legacy route fields while preserving explicit custom markers', () => {
    const route: StudioRouteDescriptor = {
      controller: 'Legacy',
      handler: 'list',
      id: 'GET /legacy',
      method: 'GET',
      path: '/legacy',
    };

    const parsed = parseStudioPayload(JSON.stringify({
      ...snapshot,
      routes: [route, { ...route, graphNodeId: 'custom-node', kind: 'custom', params: ['id'] }],
    }));

    expect(parsed.payload.snapshot?.routes).toEqual([
      { ...route, graphNodeId: 'route:GET__legacy', kind: 'http', params: [] },
      { ...route, graphNodeId: 'custom-node', kind: 'custom', params: ['id'] },
    ]);
    expectTypeOf<StudioRouteDescriptor['params']>().toEqualTypeOf<string[] | undefined>();
    expectTypeOf<StudioNormalizedRouteDescriptor['params']>().toEqualTypeOf<string[]>();
  });

  it('keeps raw snapshot standalone timing and report envelope readers compatible', () => {
    const report = {
      generatedAt: snapshot.generatedAt,
      snapshot,
      summary: {
        componentCount: 0,
        diagnosticCount: 0,
        errorCount: 0,
        healthStatus: 'healthy',
        readinessStatus: 'ready',
        timingTotalMs: timing.totalMs,
        warningCount: 0,
      },
      timing,
      version: 1,
    };

    const parsed = [snapshot, timing, { snapshot, timing }, report]
      .map((value) => parseStudioPayload(JSON.stringify(value)).payload);

    expect(parsed).toEqual([
      { snapshot },
      { timing },
      { snapshot, timing },
      { report, snapshot, timing },
    ]);
    expect(() => parseStudioPayload(JSON.stringify({
      ...report,
      summary: { ...report.summary, componentCount: 1 },
    }))).toThrow('Inspect report summary does not match');
  });

  it.each([
    { ...timing, version: 2 },
    { ...timing, totalMs: null },
    { ...timing, phases: [{ durationMs: 1, name: 'unknown' }] },
  ])('rejects malformed timing rather than treating it as omitted: %j', (malformed) => {
    const envelope = { snapshot, timing: malformed };

    expect(() => parseStudioPayload(JSON.stringify(envelope))).toThrow();
    expect(parseStudioPayload(JSON.stringify(snapshot)).payload.timing).toBeUndefined();
  });

  it('preserves live envelope identity and rejects body-like request fields', () => {
    const event: StudioLiveEventBase<'request', Record<string, unknown>> = {
      emittedAt: snapshot.generatedAt,
      epoch: 'epoch-1',
      eventId: 'event-1',
      payload: {
        method: 'GET',
        path: '/',
        requestId: 'req-1',
        startedAt: snapshot.generatedAt,
        status: 'started',
        url: '/',
      },
      sequence: 1,
      source: { appId: 'app-1', runtime: 'node' },
      type: 'request',
      version: 1,
    };

    const parsed = parseStudioLiveEvent(JSON.stringify(event));

    expect(parsed).toEqual(event);
    expect(() => parseStudioLiveEvent(JSON.stringify({
      ...event,
      payload: { ...event.payload, body: 'private' },
    }))).toThrow('must not include');
    expect(() => parseStudioLiveEvent(JSON.stringify({ ...event, version: 2 }))).toThrow();
  });
});
