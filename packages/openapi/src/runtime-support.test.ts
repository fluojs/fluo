import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const nodeListenerEngine = '>=24.0.0 <27';

describe('@fluojs/openapi runtime support metadata', () => {
  it('omits a package-wide Node installation gate for shared document generation', () => {
    // Given: the published @fluojs/openapi manifest.
    // When: its installation metadata is read.
    // Then: selecting the shared HTTP path does not impose a Node gate.
    const manifest = readFileSync(new URL('../package.json', import.meta.url), 'utf8');

    expect(JSON.parse(manifest).engines?.node).toBeUndefined();
  });

  it('keeps mandatory first-party dependencies free of transitive Node installation gates', () => {
    // Given: every mandatory @fluojs dependency of the root entrypoint.
    // When: their installation metadata is read.
    // Then: no shared dependency reintroduces a package-wide Node gate.
    const openapiManifest: { readonly dependencies: Readonly<Record<string, string>> } = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    );

    for (const dependency of Object.keys(openapiManifest.dependencies).filter((name) => name.startsWith('@fluojs/'))) {
      const manifest = readFileSync(new URL(`../../${dependency.slice(8)}/package.json`, import.meta.url), 'utf8');

      expect(JSON.parse(manifest).engines?.node, dependency).toBeUndefined();
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
