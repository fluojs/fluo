import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('Studio runtime bridge discoverability', () => {
  it('keeps the public host bridge boundary linked from both context hubs', () => {
    // Given
    const contextPaths = ['docs/CONTEXT.md', 'docs/CONTEXT.ko.md'];

    // When
    const contexts = contextPaths.map((path) => readFileSync(join(repoRoot, path), 'utf8'));

    // Then
    for (const context of contexts) {
      expect(context).toContain('@fluojs/runtime/devtools');
      expect(context).toContain('Studio host bridge');
      expect(context).toContain('docs/reference/package-surface');
    }
  });
});
