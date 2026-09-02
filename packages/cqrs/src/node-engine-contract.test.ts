import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const supportedNodeRange = '>=20.19.3 <21 || >=22.2.0 <27';

function readPackageManifest(packageName: 'cqrs' | 'runtime') {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`../${packageName === 'cqrs' ? '' : `../${packageName}/`}package.json`, import.meta.url)), 'utf8'));
}

const documentationScopes = [
  ['../README.md', '### Node.js Support', '\n## '],
  ['../README.ko.md', '### Node.js 지원', '\n## '],
  ['../../../docs/reference/package-surface.md', '- **`@fluojs/cqrs`**:', '\n- **'],
  ['../../../docs/reference/package-surface.ko.md', '- **`@fluojs/cqrs`**:', '\n- **'],
  ['../../../docs/CONTEXT.md', '## Node.js Support', '\n## '],
  ['../../../docs/CONTEXT.ko.md', '## Node.js 지원', '\n## '],
] as const;

function readDocumentationScope([documentPath, scopeStart, scopeEnd]: (typeof documentationScopes)[number]) {
  const document = readFileSync(fileURLToPath(new URL(documentPath, import.meta.url)), 'utf8');
  const scopeStartIndex = document.indexOf(scopeStart);
  const scopeEndIndex = document.indexOf(scopeEnd, scopeStartIndex + scopeStart.length);

  expect(scopeStartIndex).toBeGreaterThanOrEqual(0);
  expect(scopeEndIndex).toBeGreaterThanOrEqual(0);

  return document.slice(scopeStartIndex, scopeEndIndex);
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

  it('keeps the manifest Node engine token in every scoped CQRS documentation surface', () => {
    // Given: CQRS manifests its Node.js support contract for package consumers.
    const cqrsManifest = readPackageManifest('cqrs');

    // When: documentation surfaces describe CQRS runtime support.
    const documentedScopes = documentationScopes.map(readDocumentationScope);

    // Then: every CQRS-specific scope contains the exact published engine token.
    for (const documentedScope of documentedScopes) {
      expect(documentedScope).toContain(cqrsManifest.engines.node);
    }
  });
});
