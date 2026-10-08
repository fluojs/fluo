import { parseStudioPayload, type StudioInspectionSnapshot } from '@fluojs/diagnostics';
import { parseStudioPayload as parseStudioFacade } from '@fluojs/studio';
import { describe, expect, it } from 'vitest';

const snapshot: StudioInspectionSnapshot = {
  generatedAt: '2026-10-08T00:00:00.000Z',
  readiness: { status: 'ready', critical: false },
  health: { status: 'healthy' },
  components: [],
  diagnostics: [],
  routes: [{ id: 'GET /posts', controller: 'Posts', handler: 'list', method: 'GET', path: '/posts' }],
};

describe('diagnostics guide composition', () => {
  it('normalizes the legacy wire route identically through the Studio facade', () => {
    const rawJson = JSON.stringify(snapshot);

    const parsed = parseStudioPayload(rawJson);

    expect(parsed).toEqual(parseStudioFacade(rawJson));
    expect(parsed.rawJson).toBe(rawJson);
    expect(parsed.payload.snapshot?.routes).toEqual([
      { ...snapshot.routes?.[0], graphNodeId: 'route:GET__posts', kind: 'http', params: [] },
    ]);
  });

  it('reads a versioned report and rejects inconsistent producer summary data', () => {
    const report = {
      generatedAt: snapshot.generatedAt,
      snapshot,
      timing: { phases: [], totalMs: 0, version: 1 },
      version: 1,
      summary: {
        componentCount: 0,
        diagnosticCount: 0,
        errorCount: 0,
        healthStatus: 'healthy',
        readinessStatus: 'ready',
        timingTotalMs: 0,
        warningCount: 0,
      },
    };

    const parsed = parseStudioPayload(JSON.stringify(report));

    expect(parsed.payload.report?.summary).toEqual(report.summary);
    expect(() => parseStudioPayload(JSON.stringify({
      ...report,
      summary: { ...report.summary, componentCount: 1 },
    }))).toThrow('Inspect report summary does not match');
  });
});
