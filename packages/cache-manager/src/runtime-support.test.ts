import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const nodeListenerEngine = '>=24.0.0 <27';

describe('@fluojs/cache-manager runtime support metadata', () => {
  it('omits a package-wide Node installation gate for memory and custom stores', () => {
    const manifest = readFileSync(new URL('../package.json', import.meta.url), 'utf8');

    expect(JSON.parse(manifest).engines?.node).toBeUndefined();
  });

  it('keeps mandatory first-party dependencies free of transitive Node installation gates', () => {
    const cacheManagerManifest: { readonly dependencies: Readonly<Record<string, string>> } = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    );

    for (const dependency of Object.keys(cacheManagerManifest.dependencies).filter((name) => name.startsWith('@fluojs/'))) {
      const manifest = readFileSync(new URL(`../../${dependency.slice(8)}/package.json`, import.meta.url), 'utf8');

      expect(JSON.parse(manifest).engines?.node, dependency).toBeUndefined();
    }
  });

  it('documents the supported Node.js range in both README mirrors', () => {
    for (const relativePath of ['../README.md', '../README.ko.md'] as const) {
      const readme = readFileSync(new URL(relativePath, import.meta.url), 'utf8');

      expect(readme).toContain(`Node.js \`${nodeListenerEngine}\``);
    }
  });
});
