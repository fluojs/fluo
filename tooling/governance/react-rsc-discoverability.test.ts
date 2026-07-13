import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

describe('experimental React RSC discoverability', () => {
  it('keeps the unstable version, manifest, HTTP dispatch, and root-isolation contracts aligned', () => {
    const englishDocs = [
      read('packages/react/README.md'),
      read('docs/reference/package-surface.md'),
      read('docs/CONTEXT.md'),
    ];
    const koreanDocs = [
      read('packages/react/README.ko.md'),
      read('docs/reference/package-surface.ko.md'),
      read('docs/CONTEXT.ko.md'),
    ];

    for (const source of [...englishDocs, ...koreanDocs]) {
      expect(source).toContain('@fluojs/react/experimental/rsc');
      expect(source).toContain('19.2.6');
      expect(source).toContain('createReactRscManifest(...)');
      expect(source).toContain('createReactFlightResponse(...)');
      expect(source).toContain('server-to-client module map');
      expect(source).toContain('HTTP dispatch');
      expect(source).toContain('Server Functions');
    }

    const packageManifest = read('packages/react/package.json');
    const rootEntrypoint = read('packages/react/src/index.ts');

    expect(packageManifest).toContain('"./experimental/rsc"');
    expect(packageManifest).toContain('"./dist/experimental/rsc.js"');
    expect(rootEntrypoint).not.toContain('./experimental/rsc.js');
  });
});
