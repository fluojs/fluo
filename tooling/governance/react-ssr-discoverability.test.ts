import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

describe('React Web Streams SSR discoverability', () => {
  it('keeps SSR core docs aligned across README, package surface, and context docs', () => {
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

    for (const source of englishDocs) {
      expect(source).toContain('ReactServerEntry');
      expect(source).toContain('createReactServerEntry(...)');
      expect(source).toContain('renderReactResponse(...)');
      expect(source).toContain('react-dom/server');
      expect(source).toContain('renderToReadableStream(...)');
    }

    for (const source of koreanDocs) {
      expect(source).toContain('ReactServerEntry');
      expect(source).toContain('createReactServerEntry(...)');
      expect(source).toContain('renderReactResponse(...)');
      expect(source).toContain('react-dom/server');
      expect(source).toContain('renderToReadableStream(...)');
    }

    expect(englishDocs.join('\n')).toContain('hydration asset injection');
    expect(koreanDocs.join('\n')).toContain('hydration asset injection');
  });
});
