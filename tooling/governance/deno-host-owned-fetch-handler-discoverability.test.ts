import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

describe('Deno host-owned fetch handler discoverability', () => {
  it('keeps the public handler and lifecycle ownership aligned across governed English and Korean docs', () => {
    const englishDocs = [
      read('packages/platform-deno/README.md'),
      read('docs/reference/package-surface.md'),
      read('docs/CONTEXT.md'),
      read('book/intermediate/ch23-deno.md'),
      read('apps/docs/content/docs/guides/runtime-adapters.mdx'),
    ];
    const koreanDocs = [
      read('packages/platform-deno/README.ko.md'),
      read('docs/reference/package-surface.ko.md'),
      read('docs/CONTEXT.ko.md'),
      read('book/intermediate/ch23-deno.ko.md'),
      read('apps/docs/content/docs/guides/runtime-adapters.ko.mdx'),
    ];

    for (const source of [...englishDocs, ...koreanDocs]) {
      expect(source).toContain('createDenoFetchHandler(...)');
      expect(source).toContain('Deno.serve');
    }

    for (const source of [englishDocs[0], englishDocs[3], englishDocs[4], koreanDocs[0], koreanDocs[3], koreanDocs[4]]) {
      expect(source).toContain('app.dispatcher');
      expect(source).toContain('rawBody');
    }

    expect(englishDocs.join('\n')).toContain('never starts a server');
    expect(englishDocs.join('\n')).toContain('websocket upgrades');
    expect(koreanDocs.join('\n')).toContain('server를 시작');
    expect(koreanDocs.join('\n')).toContain('websocket upgrade');
  });
});
