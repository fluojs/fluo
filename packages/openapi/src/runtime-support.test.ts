import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const nodeEngineFloorPattern = /"engines"\s*:\s*\{\s*"node"\s*:\s*">=(\d+)\.(\d+)\.(\d+)(?=\s|")/u;
const nodeListenerEngine = '>=20.19.3 <21 || >=22.2.0 <27';
const mandatoryFluoDependencyManifests = [
  '../../core/package.json',
  '../../http/package.json',
  '../../runtime/package.json',
  '../../validation/package.json',
] as const;

function extractNodeEngineFloor(manifest: string): readonly [number, number, number] {
  const match = nodeEngineFloorPattern.exec(manifest);
  if (match === null) {
    throw new TypeError('Expected the package manifest to declare a >=x.y.z Node.js engine floor.');
  }

  return [
    Number.parseInt(match[1] ?? '', 10),
    Number.parseInt(match[2] ?? '', 10),
    Number.parseInt(match[3] ?? '', 10),
  ];
}

function compareNodeEngineFloors(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number {
  for (const index of [0, 1, 2] as const) {
    const difference = left[index] - right[index];
    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}

describe('@fluojs/openapi runtime support metadata', () => {
  it('declares the Node.js range required by the published package contract', () => {
    // Given: the published @fluojs/openapi manifest.
    // When: its declared Node.js engine range is read.
    // Then: it matches the Node listener range owned by @fluojs/runtime.
    const manifest = readFileSync(new URL('../package.json', import.meta.url), 'utf8');

    expect(JSON.parse(manifest)).toMatchObject({ engines: { node: nodeListenerEngine } });
  });

  it('covers the highest Node.js floor in the mandatory fluo dependency graph', () => {
    // Given: every mandatory @fluojs dependency of the root entrypoint.
    // When: their engine floors are compared with the openapi floor.
    // Then: no dependency requires a newer Node.js release than openapi advertises.
    const openapiManifest = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
    const openapiFloor = extractNodeEngineFloor(openapiManifest);

    for (const relativePath of mandatoryFluoDependencyManifests) {
      const manifest = readFileSync(new URL(relativePath, import.meta.url), 'utf8');

      expect(compareNodeEngineFloors(extractNodeEngineFloor(manifest), openapiFloor)).toBeLessThanOrEqual(0);
    }
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

  it('keeps the official multi-document example aligned with the package range', () => {
    // Given: the official openapi example manifest that consumes this package.
    // When: its declared Node.js engine range is read.
    // Then: it advertises the same support boundary rather than a broader one.
    const manifest = readFileSync(
      new URL('../../../examples/openapi-multiple-documents/package.json', import.meta.url),
      'utf8',
    );

    expect(JSON.parse(manifest)).toMatchObject({ engines: { node: nodeListenerEngine } });
  });
});
