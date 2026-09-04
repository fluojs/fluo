import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

const supportedBuildModules = [
  'decorators',
  'errors',
  'index',
  'internal',
  'metadata',
  'request-pipeline',
  'types',
  'utils',
] as const;
const expectedDistEntries = supportedBuildModules
  .flatMap((moduleName) => [
    `${moduleName}.d.ts`,
    `${moduleName}.d.ts.map`,
    `${moduleName}.js`,
  ])
  .concat('metadata')
  .sort();
const repoRootPath = fileURLToPath(new URL('../../..', import.meta.url));
const workspaceBuildClosurePath = fileURLToPath(
  new URL('../../../tooling/scripts/run-workspace-build-closure.mjs', import.meta.url),
);

it('keeps published build output limited to supported modules', () => {
  // Given
  const buildResult = spawnSync(
    process.execPath,
    [workspaceBuildClosurePath, '@fluojs/core'],
    {
      cwd: repoRootPath,
      encoding: 'utf8',
    },
  );

  // When
  const distEntries = readdirSync(new URL('../dist/', import.meta.url)).sort();

  // Then
  expect(buildResult.status, [buildResult.stdout, buildResult.stderr].filter(Boolean).join('\n')).toBe(0);
  expect(distEntries).toEqual(expectedDistEntries);
}, 300_000);
