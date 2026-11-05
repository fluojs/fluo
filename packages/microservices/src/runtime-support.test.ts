import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { enforceMandatoryFirstPartyDependencyEngineAlignment } from '../../../tooling/governance/verify-platform-consistency-governance.mjs';

const nodeListenerEngine = '>=24.0.0 <27';

describe('@fluojs/microservices runtime support metadata', () => {
  it('declares the Node.js range required by the published package contract', () => {
    // Given: the published @fluojs/microservices manifest.
    // When: its declared Node.js engine range is read.
    // Then: it keeps the package-owned Node runtime range.
    const manifest = readFileSync(new URL('../package.json', import.meta.url), 'utf8');

    expect(JSON.parse(manifest)).toMatchObject({ engines: { node: nodeListenerEngine } });
  });

  it('matches the canonical Node platform support range', () => {
    const microservicesManifest = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
    const nodePlatformManifest = readFileSync(new URL('../../platform-nodejs/package.json', import.meta.url), 'utf8');

    expect(JSON.parse(microservicesManifest).engines.node).toBe(JSON.parse(nodePlatformManifest).engines.node);
  });

  it('covers the highest Node.js floor in the mandatory fluo dependency graph', () => {
    // Given: every mandatory @fluojs dependency of the root entrypoint.
    // When: their engine floors are compared with the microservices floor.
    // Then: no dependency requires a newer Node.js release than microservices advertises.
    expect(() => enforceMandatoryFirstPartyDependencyEngineAlignment(
      undefined, new Set(['@fluojs/microservices']),
    )).not.toThrow();
  });

  it('documents the supported Node.js range in both README mirrors', () => {
    // Given: the bilingual package README mirrors.
    // When: each mirror is read.
    // Then: both state the same supported Node.js range.
    for (const relativePath of ['../README.md', '../README.ko.md'] as const) {
      const readme = readFileSync(new URL(relativePath, import.meta.url), 'utf8');

      expect(readme).toContain(`Node.js \`${nodeListenerEngine}\``);
    }
  });
});
