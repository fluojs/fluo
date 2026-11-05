import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const supportedNodeRange = '>=24.0.0 <27';

function readPackageManifest(packageName: 'cqrs' | 'platform-nodejs') {
  return JSON.parse(readFileSync(fileURLToPath(new URL(
    packageName === 'cqrs' ? '../package.json' : '../../platform-nodejs/package.json',
    import.meta.url,
  )), 'utf8'));
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
  it('omits a CQRS Node installation gate while the Node listener retains its support window', () => {
    const cqrsManifest = readPackageManifest('cqrs');
    const nodePlatformManifest = readPackageManifest('platform-nodejs');

    expect(cqrsManifest.engines?.node).toBeUndefined();
    expect(nodePlatformManifest.engines.node).toBe(supportedNodeRange);
  });

  it('keeps the supported Node window documented independently of installation metadata', () => {
    // Given: the supported Node runtime range remains unchanged.
    // When: documentation surfaces describe CQRS runtime support.
    const documentedScopes = documentationScopes.map(readDocumentationScope);

    // Then: every CQRS-specific scope retains the supported runtime range.
    for (const documentedScope of documentedScopes) {
      expect(documentedScope).toContain(supportedNodeRange);
    }
  });
});
