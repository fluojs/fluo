import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const nodeEngineDeclaration = /"engines"\s*:\s*\{\s*"node"\s*:\s*">=20\.0\.0"/u;
const mandatoryFluoDependencyManifests = [
  '../../core/package.json',
  '../../di/package.json',
  '../../http/package.json',
  '../../runtime/package.json',
  '../../validation/package.json',
] as const;

describe('@fluojs/graphql runtime support metadata', () => {
  it('declares the Node.js floor required by the published package contract', () => {
    const manifest = readFileSync(new URL('../package.json', import.meta.url), 'utf8');

    expect(manifest).toMatch(nodeEngineDeclaration);
  });

  it('matches the Node.js floor declared by every mandatory fluo dependency', () => {
    for (const relativePath of mandatoryFluoDependencyManifests) {
      const manifest = readFileSync(new URL(relativePath, import.meta.url), 'utf8');

      expect(manifest).toMatch(nodeEngineDeclaration);
    }
  });
});
