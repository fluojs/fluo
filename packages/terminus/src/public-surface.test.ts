import { describe, expect, it } from 'vitest';

import * as terminus from './index.js';

describe('terminus public surface', () => {
  it('keeps health-indicator seams public while internalizing options wiring', () => {
    expect(terminus).toHaveProperty('TERMINUS_HEALTH_INDICATORS');
    expect(terminus).toHaveProperty('TERMINUS_INDICATOR_PROVIDER_TOKENS');
    expect(terminus).toHaveProperty('TerminusHealthService');
    expect(terminus).not.toHaveProperty('TERMINUS_OPTIONS');
  });

  it('exposes Nest-style canonical module entrypoint', () => {
    expect(terminus).toHaveProperty('TerminusModule');
    expect((terminus as { TerminusModule: { forRoot: unknown } }).TerminusModule).toHaveProperty('forRoot');
  });
});
