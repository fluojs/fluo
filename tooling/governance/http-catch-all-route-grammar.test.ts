import { describe, expect, it } from 'vitest';

import { enforceHttpCatchAllRouteGrammarDecision } from './verify-platform-consistency-governance.mjs';

describe('HTTP catch-all route grammar decision', () => {
  it('keeps the deferred decision and adoption gates discoverable', () => {
    expect(() => enforceHttpCatchAllRouteGrammarDecision()).not.toThrow();
  });
});
