import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const nodeEngineFloorPattern = /"engines"\s*:\s*\{\s*"node"\s*:\s*">=(\d+)\.(\d+)\.(\d+)"/u;
const mandatoryFluoDependencyManifests = [
  '../../core/package.json',
  '../../config/package.json',
  '../../di/package.json',
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

describe('@fluojs/graphql runtime support metadata', () => {
  it('declares the Node.js floor required by the published package contract', () => {
    const manifest = readFileSync(new URL('../package.json', import.meta.url), 'utf8');

    expect(extractNodeEngineFloor(manifest)).toEqual([20, 16, 0]);
  });

  it('covers the highest Node.js floor in the mandatory fluo dependency graph', () => {
    const graphqlManifest = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
    const graphqlFloor = extractNodeEngineFloor(graphqlManifest);

    for (const relativePath of mandatoryFluoDependencyManifests) {
      const manifest = readFileSync(new URL(relativePath, import.meta.url), 'utf8');

      expect(compareNodeEngineFloors(extractNodeEngineFloor(manifest), graphqlFloor)).toBeLessThanOrEqual(0);
    }
  });
});
