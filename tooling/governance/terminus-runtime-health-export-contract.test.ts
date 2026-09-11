import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

type TerminusContractGuard = {
  enforceTerminusRuntimeHealthContract: (readText?: (path: string) => string) => void;
};

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { enforceTerminusRuntimeHealthContract } =
  (await import('./verify-platform-consistency-governance.mjs')) as unknown as TerminusContractGuard;

function readWithMutation(
  targetPath: string,
  mutate: (source: string) => string,
): (relativePath: string) => string {
  return (relativePath: string): string => {
    const source = readFileSync(join(repoRoot, relativePath), 'utf8');

    return relativePath === targetPath ? mutate(source) : source;
  };
}

describe('Terminus runtime health export contract governance', () => {
  it.each([
    [
      'restored root MemoryHealthIndicator export',
      './indicators/memory.js',
      'MemoryHealthIndicator',
    ],
    [
      'restored root DiskHealthIndicator export',
      './indicators/disk.js',
      'DiskHealthIndicator',
    ],
  ])('rejects %s', (_scenario, moduleSpecifier, symbol) => {
    const readText = readWithMutation(
      'packages/terminus/src/index.ts',
      (source) => `${source}\nexport { ${symbol} } from "${moduleSpecifier}";\n`,
    );

    expect(() => enforceTerminusRuntimeHealthContract(readText)).toThrow(
      'memory and disk indicators must remain outside the Terminus root export boundary.',
    );
  });

  it.each([
    ['MemoryHealthIndicator', './indicators/memory.js'],
    ['DiskHealthIndicator', './indicators/disk.js'],
  ])('rejects removal of the node %s export', (symbol, moduleSpecifier) => {
    const readText = readWithMutation(
      'packages/terminus/src/node.ts',
      (source) => source.replace(
        `export * from '${moduleSpecifier}';`,
        `// export * from '${moduleSpecifier}';`,
      ),
    );

    expect(() => enforceTerminusRuntimeHealthContract(readText)).toThrow(
      `${symbol} must remain available from the Terminus node subpath.`,
    );
  });

  it('rejects a restored runtime createHealthModule export', () => {
    const readText = readWithMutation(
      'packages/runtime/src/health/health.ts',
      (source) => `${source}\nexport function createHealthModule() {}\n`,
    );

    expect(() => enforceTerminusRuntimeHealthContract(readText)).toThrow(
      'runtime health registration must remain owned by HealthModule.forRoot without a createHealthModule compatibility export.',
    );
  });
});
