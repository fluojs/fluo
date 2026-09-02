import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const supportedNodeRange = '>=20.19.3 <21 || >=22.2.0 <27';

function readPackageManifest(packageName: 'cqrs' | 'runtime') {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`../${packageName === 'cqrs' ? '' : `../${packageName}/`}package.json`, import.meta.url)), 'utf8'));
}

describe('@fluojs/cqrs Node engine contract', () => {
  it('matches its mandatory runtime dependency support window', () => {
    // Given: CQRS depends on the published Runtime package at install time.
    const cqrsManifest = readPackageManifest('cqrs');
    const runtimeManifest = readPackageManifest('runtime');

    // When: package-manager engines metadata evaluates the dependency closure.
    // Then: CQRS never admits a Node.js version Runtime excludes.
    expect(cqrsManifest.engines.node).toBe(supportedNodeRange);
    expect(runtimeManifest.engines.node).toBe(supportedNodeRange);
  });
});
