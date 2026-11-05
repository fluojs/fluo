import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { enforceMandatoryFirstPartyDependencyEngineAlignment } from '../../../tooling/governance/verify-platform-consistency-governance.mjs';

const nodeListenerEngine = '>=24.0.0 <27';

describe('@fluojs/graphql runtime support metadata', () => {
  it('declares the patched ws dependency floor', () => {
    const manifest = readFileSync(new URL('../package.json', import.meta.url), 'utf8');

    expect(manifest).toContain('"ws": "^8.21.0"');
  });

  it('declares the Node.js range required by the published package contract', () => {
    const manifest = readFileSync(new URL('../package.json', import.meta.url), 'utf8');

    expect(JSON.parse(manifest)).toMatchObject({ engines: { node: nodeListenerEngine } });
  });

  it('covers the highest Node.js floor in the mandatory fluo dependency graph', () => {
    expect(() => enforceMandatoryFirstPartyDependencyEngineAlignment(
      undefined, new Set(['@fluojs/graphql']),
    )).not.toThrow();
  });
});
