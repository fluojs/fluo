import { describe, expect, it } from 'vitest';

import {
  enforceMicroservicesSafetyGuidanceParity,
  enforceMicroservicesSafetyRuntimeEvidence,
} from './verify-platform-consistency-governance.mjs';

describe('Microservices safety guidance governance', () => {
  it('keeps the four transport safety contracts discoverable in every governed locale and companion', () => {
    expect(() => enforceMicroservicesSafetyGuidanceParity()).not.toThrow();
  });

  it('keeps package source and regression evidence behind the documented safety contracts', () => {
    expect(() => enforceMicroservicesSafetyRuntimeEvidence()).not.toThrow();
  });
});
