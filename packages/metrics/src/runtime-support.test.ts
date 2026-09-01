import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const PROM_CLIENT_PRIVATE_SEAM_VERSION = '15.1.3';

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

  it('pins the prom-client private collector metadata seam to the installed contract', () => {
    // Given: the published metrics manifest and the installed prom-client package.
    const metricsManifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const promClientManifest: { version: string } = require('prom-client/package.json');
    const promClient: { collectDefaultMetrics: { metricsList: readonly string[] } } = require('prom-client');

    // When: each default collector's private metadata is loaded without invoking registration.
    const collectorMetricNames = promClient.collectDefaultMetrics.metricsList.map((collectorName) => {
      const collector: { metricNames?: unknown } = require(`prom-client/lib/metrics/${collectorName}`);
      return collector.metricNames;
    });

    // Then: the private paths and metadata are bounded to the exact dependency release.
    expect(metricsManifest.dependencies['prom-client']).toBe(PROM_CLIENT_PRIVATE_SEAM_VERSION);
    expect(promClientManifest.version).toBe(PROM_CLIENT_PRIVATE_SEAM_VERSION);
    for (const metricNames of collectorMetricNames) {
      expect(Array.isArray(metricNames)).toBe(true);
      if (Array.isArray(metricNames)) {
        expect(metricNames.every((metricName) => typeof metricName === 'string')).toBe(true);
      }
    }
  });
});
