import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = join(import.meta.dirname, '..', '..');

describe('GraphQL object field resolver contract governance', () => {
  it('keeps field resolver discovery and standard method bindings explicit across bilingual surfaces', () => {
    const contractSurfaces = [
      'packages/graphql/README.md',
      'packages/graphql/README.ko.md',
      'packages/graphql/field-resolver-rfc.md',
      'packages/graphql/field-resolver-rfc.ko.md',
      'docs/CONTEXT.md',
      'docs/CONTEXT.ko.md',
      'docs/getting-started/migrate-from-nestjs.md',
      'docs/getting-started/migrate-from-nestjs.ko.md',
      'book/intermediate/ch18-graphql.md',
      'book/intermediate/ch18-graphql.ko.md',
    ].map((path) => readFileSync(join(repoRoot, path), 'utf8'));

    for (const content of contractSurfaces) {
      expect(content).toContain('@FieldResolver');
      expect(content).toContain('@Parent');
      expect(content).toContain('@Context');
    }

    const decorators = readFileSync(join(repoRoot, 'packages/graphql/src/decorators.ts'), 'utf8');
    const regressionTest = readFileSync(join(repoRoot, 'packages/graphql/src/field-resolver.test.ts'), 'utf8');

    expect(decorators).toContain('export function FieldResolver');
    expect(decorators).toContain('export function Parent');
    expect(decorators).toContain('export function Context');
    expect(regressionTest).toContain('discovers and executes a field resolver with parent and context bindings');
  });
});
