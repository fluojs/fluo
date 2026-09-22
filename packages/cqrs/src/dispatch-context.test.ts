import { describe, expect, it, vi } from 'vitest';

describe('opaque CQRS dispatch provenance', () => {
  it('recognizes compatible copy-A provenance through copy B', async () => {
    // Given
    vi.resetModules();
    const copyA = await import('./dispatch-context.js');
    vi.resetModules();
    const copyB = await import('./dispatch-context.js');
    const publishDrainToken = Symbol('publish-drain');
    const context = copyA.createInternalCqrsDispatchContext({
      publishDrainToken,
      sagaContinuationScope: undefined,
      sagaTopology: undefined,
    });

    // When
    const state = copyB.getInternalCqrsDispatchContextState(context);

    // Then
    expect(state).toEqual({
      publishDrainToken,
      sagaContinuationScope: undefined,
      sagaTopology: undefined,
    });
    expect(Object.keys(context)).toEqual([]);
  });
});
