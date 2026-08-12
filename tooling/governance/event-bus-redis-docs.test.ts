import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('Event Bus Redis documentation', () => {
  it('documents the ioredis peer and dedicated publisher/subscriber clients across canonical surfaces', () => {
    // Given
    const manifest = readFileSync(join(repoRoot, 'packages/event-bus/package.json'), 'utf8');
    const installationGuides = [
      readFileSync(join(repoRoot, 'packages/event-bus/README.md'), 'utf8'),
      readFileSync(join(repoRoot, 'packages/event-bus/README.ko.md'), 'utf8'),
      readFileSync(join(repoRoot, 'book/intermediate/ch09-event-bus.md'), 'utf8'),
      readFileSync(join(repoRoot, 'book/intermediate/ch09-event-bus.ko.md'), 'utf8'),
    ];
    const canonicalReferences = [
      readFileSync(join(repoRoot, 'docs/CONTEXT.md'), 'utf8'),
      readFileSync(join(repoRoot, 'docs/CONTEXT.ko.md'), 'utf8'),
      readFileSync(join(repoRoot, 'docs/reference/package-chooser.md'), 'utf8'),
      readFileSync(join(repoRoot, 'docs/reference/package-chooser.ko.md'), 'utf8'),
      readFileSync(join(repoRoot, 'docs/reference/package-surface.md'), 'utf8'),
      readFileSync(join(repoRoot, 'docs/reference/package-surface.ko.md'), 'utf8'),
    ];

    // When / Then
    expect(manifest).toContain('"ioredis": "^5.0.0"');
    for (const guide of installationGuides) {
      expect(guide).toContain('npm install @fluojs/event-bus ioredis');
      expect(guide).toContain('const publishClient = new Redis(');
      expect(guide).toContain('const subscribeClient = new Redis(');
    }
    for (const reference of canonicalReferences) {
      expect(reference).toContain('ioredis');
      expect(reference).toContain('publishClient');
      expect(reference).toContain('subscribeClient');
    }
  });
});
