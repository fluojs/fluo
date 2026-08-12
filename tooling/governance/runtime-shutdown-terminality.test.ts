import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(import.meta.dirname, '../..');

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

describe('runtime shutdown terminality documentation', () => {
  it.each([
    'packages/runtime/README.md',
    'packages/runtime/README.ko.md',
    'docs/architecture/lifecycle-and-shutdown.md',
    'docs/architecture/lifecycle-and-shutdown.ko.md',
    'docs/CONTEXT.md',
    'docs/CONTEXT.ko.md',
  ])('keeps the terminal closed state discoverable in %s', (relativePath) => {
    const content = read(relativePath);

    expect(content).toContain('terminal');
    expect(content).toContain('closed');
    expect(content).toContain('retry');
  });
});
