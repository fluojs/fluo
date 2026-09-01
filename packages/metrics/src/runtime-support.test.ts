import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('@fluojs/metrics runtime support metadata', () => {
  it('matches the Node.js range required by its mandatory runtime dependency', () => {
    // Given: the published metrics manifest and its mandatory runtime dependency manifest.
    const metricsManifest = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
    const runtimeManifest = readFileSync(new URL('../../runtime/package.json', import.meta.url), 'utf8');

    // When: their declared Node.js engine ranges are read.
    const metricsNodeEngine = JSON.parse(metricsManifest).engines.node;
    const runtimeNodeEngine = JSON.parse(runtimeManifest).engines.node;

    // Then: metrics does not advertise support outside the runtime requirement.
    expect(metricsNodeEngine).toBe(runtimeNodeEngine);
  });
});
