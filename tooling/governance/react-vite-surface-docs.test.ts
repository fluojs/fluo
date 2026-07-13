import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const governedDocs = [
  'docs/CONTEXT.md',
  'docs/CONTEXT.ko.md',
  'docs/reference/package-chooser.md',
  'docs/reference/package-chooser.ko.md',
  'docs/reference/package-surface.md',
  'docs/reference/package-surface.ko.md',
] as const;
const staleReactViteSurfacePattern =
  /future `@fluojs\/react\/vite`|Future `@fluojs\/react\/vite`|Manifest discovery belongs to future `@fluojs\/react\/vite`|`@fluojs\/react\/vite`, React Server Components|`@fluojs\/react\/vite`, React Server Components|Future `@fluojs\/react\/vite`/u;

function readGovernedDoc(path: (typeof governedDocs)[number]): string {
  return readFileSync(resolve(repoRoot, path), 'utf8');
}

describe('React Vite surface docs', () => {
  it('documents @fluojs/react/vite as a current hydration manifest subpath', () => {
    for (const docPath of governedDocs) {
      const content = readGovernedDoc(docPath);

      expect(content, docPath).toContain('@fluojs/react/vite');
      expect(content, docPath).not.toMatch(staleReactViteSurfacePattern);
    }
  });
});
