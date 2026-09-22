import {
  applyFilters,
  isStudioLiveEvent,
  parseStudioPayload,
  renderMermaid,
  validateStudioLiveEvent,
} from '@fluojs/studio';
import { describe, expect, it } from 'vitest';

/**
 * @fluojs/studio guide evidence: static snapshot/report parsing with route
 * normalization, non-mutating filters, deterministic Mermaid rendering, and
 * the live event contract (including the body-like field rejection).
 */

const inspectionSnapshot = {
  generatedAt: '2026-09-21T00:00:00.000Z',
  readiness: { status: 'degraded', critical: false },
  health: { status: 'degraded' },
  components: [
    {
      id: 'redis.default',
      kind: 'redis',
      state: 'ready',
      readiness: { status: 'ready', critical: true },
      health: { status: 'healthy' },
      dependencies: [],
      telemetry: { namespace: 'fluo.redis', tags: { env: 'test' } },
      ownership: { ownsResources: false, externallyManaged: true },
      details: {},
    },
    {
      id: 'queue.default',
      kind: 'queue',
      state: 'degraded',
      readiness: { status: 'degraded', critical: false, reason: 'Queue running in degraded mode' },
      health: { status: 'degraded', reason: 'Redis reconnect backoff active' },
      dependencies: ['redis.default'],
      telemetry: { namespace: 'fluo.queue', tags: { env: 'test' } },
      ownership: { ownsResources: true, externallyManaged: false },
      details: { workers: 2 },
    },
  ],
  diagnostics: [
    {
      code: 'QUEUE_BACKOFF',
      severity: 'warning',
      componentId: 'queue.default',
      message: 'Queue is retrying with backoff.',
      fixHint: 'Check Redis connectivity.',
    },
  ],
  routes: [
    {
      id: 'GET /catalog/:sku CatalogRouter show',
      kind: 'react-page',
      method: 'GET',
      path: '/catalog/:sku',
      controller: 'CatalogRouter',
      handler: 'show',
      params: ['sku'],
    },
    {
      id: 'GET /health HealthController check',
      method: 'GET',
      path: '/health',
      controller: 'HealthController',
      handler: 'check',
    },
  ],
};

function requestTraceEnvelope(payload: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'request',
    version: 1,
    sequence: 1,
    epoch: 'epoch-1',
    eventId: 'event-1',
    emittedAt: '2026-09-21T00:00:01.000Z',
    source: { appId: 'guide-app', runtime: 'node' },
    payload,
  };
}

const validTrace = {
  method: 'GET',
  path: '/catalog/sku-42',
  requestId: 'request-1',
  startedAt: '2026-09-21T00:00:00.500Z',
  status: 'succeeded',
  statusCode: 200,
  durationMs: 12,
  url: '/catalog/sku-42',
};

describe('@fluojs/studio guide examples', () => {
  it('parses static snapshots and normalizes legacy route defaults', () => {
    const rawJson = JSON.stringify({ snapshot: inspectionSnapshot });
    const { payload, rawJson: echoed } = parseStudioPayload(rawJson);

    expect(echoed).toBe(rawJson);
    const routes = payload.snapshot?.routes ?? [];
    expect(routes).toHaveLength(2);
    expect(routes[0]?.kind).toBe('react-page');
    expect(routes[0]?.graphNodeId).toContain('route:');
    expect(routes[1]?.kind).toBe('http');
    expect(routes[1]?.params).toEqual([]);
    expect(routes[1]?.graphNodeId).toMatch(/^route:/);
  });

  it('parses the versioned report artifact with its summary and timing', () => {
    const report = {
      generatedAt: '2026-09-21T00:00:00.000Z',
      snapshot: inspectionSnapshot,
      summary: {
        componentCount: 2,
        diagnosticCount: 1,
        errorCount: 0,
        healthStatus: 'degraded',
        readinessStatus: 'degraded',
        timingTotalMs: 12,
        warningCount: 1,
      },
      timing: {
        phases: [
          { name: 'bootstrap_module', durationMs: 4 },
          { name: 'create_dispatcher', durationMs: 8 },
        ],
        totalMs: 12,
        version: 1,
      },
      version: 1,
    };

    const { payload } = parseStudioPayload(JSON.stringify(report));
    expect(payload.report?.summary).toEqual(report.summary);
    expect(payload.report?.timing.phases).toHaveLength(2);
  });

  it('rejects unsupported bootstrap timing phase names', () => {
    const call = () =>
      parseStudioPayload(
        JSON.stringify({ timing: { phases: [{ name: 'bogus', durationMs: 1 }], totalMs: 1, version: 1 } }),
      );

    expect(call).toThrow(/Invalid/);
  });

  it('applies readiness, severity, and query filters without mutating the source', () => {
    const { payload } = parseStudioPayload(JSON.stringify({ snapshot: inspectionSnapshot }));
    const snapshot = payload.snapshot;
    if (!snapshot) {
      throw new Error('expected the parsed snapshot');
    }

    const filtered = applyFilters(snapshot, {
      query: 'queue',
      readinessStatuses: ['degraded'],
      severities: ['error', 'warning'],
    });

    expect(filtered.components.map((component) => component.id)).toEqual(['queue.default']);
    expect(filtered.diagnostics.map((issue) => issue.code)).toEqual(['QUEUE_BACKOFF']);
    expect(snapshot.components).toHaveLength(2);
  });

  it('renders deterministic Mermaid text across JSON round-trips', () => {
    const { payload } = parseStudioPayload(JSON.stringify({ snapshot: inspectionSnapshot }));
    const snapshot = payload.snapshot;
    if (!snapshot) {
      throw new Error('expected the parsed snapshot');
    }

    const reparsed = parseStudioPayload(JSON.stringify({ snapshot })).payload.snapshot;
    if (!reparsed) {
      throw new Error('expected the reparsed snapshot');
    }

    expect(renderMermaid(reparsed)).toBe(renderMermaid(snapshot));
  });

  it('accepts live request traces without body-like payload fields', () => {
    const event = validateStudioLiveEvent(requestTraceEnvelope(validTrace));
    expect(event.type).toBe('request');
    if (event.type === 'request') {
      expect(event.payload.status).toBe('succeeded');
      expect(event.payload.statusCode).toBe(200);
    }

    expect(isStudioLiveEvent(requestTraceEnvelope(validTrace))).toBe(true);
  });

  it('rejects request traces carrying body-like fields before UI state retains them', () => {
    const leaking = requestTraceEnvelope({ ...validTrace, body: { secret: 'value' } });

    expect(() => validateStudioLiveEvent(leaking)).toThrow(/body payload fields/);
    expect(isStudioLiveEvent(leaking)).toBe(false);
  });

  it('normalizes live snapshot routes and rejects non-string kinds', () => {
    const liveSnapshot = {
      type: 'snapshot',
      version: 1,
      sequence: 2,
      epoch: 'epoch-1',
      eventId: 'event-2',
      emittedAt: '2026-09-21T00:00:02.000Z',
      source: { appId: 'guide-app', runtime: 'node' },
      payload: {
        appId: 'guide-app',
        generatedAt: '2026-09-21T00:00:02.000Z',
        version: 1,
        graph: { nodes: [{ id: 'module:app', kind: 'module', label: 'App' }], edges: [] },
        requests: [],
        diagnostics: [],
        routes: [
          { id: 'GET /catalog/:sku CatalogRouter show', kind: 'react-page', method: 'GET', path: '/catalog/:sku', controller: 'CatalogRouter', handler: 'show', params: ['sku'] },
          { id: 'GET /health HealthController check', method: 'GET', path: '/health', controller: 'HealthController', handler: 'check' },
        ],
      },
    };

    const event = validateStudioLiveEvent(liveSnapshot);
    if (event.type !== 'snapshot') {
      throw new Error('expected the snapshot event');
    }

    expect(event.payload.routes[0]?.kind).toBe('react-page');
    expect(event.payload.routes[0]?.graphNodeId).toMatch(/^route:/);
    expect(event.payload.routes[1]?.kind).toBe('http');
    expect(event.payload.routes[1]?.graphNodeId).toMatch(/^route:/);

    expect(() =>
      validateStudioLiveEvent({
        ...liveSnapshot,
        payload: {
          ...liveSnapshot.payload,
          routes: [{ id: 'r1', kind: 42, method: 'GET', path: '/x', controller: 'C', handler: 'h' }],
        },
      }),
    ).toThrow(/kind/);
  });
});
