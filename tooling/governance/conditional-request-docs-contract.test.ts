import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { enforceConditionalRequestDocsContract } from './conditional-request-docs-contract.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('Conditional request documentation contract', () => {
  it('preserves lifecycle, exists, HEAD, and conformance discoverability in EN/KO', () => {
    expect(() => enforceConditionalRequestDocsContract()).not.toThrow();
  });

  it('rejects a lifecycle contract that omits custom-writer ownership', () => {
    const readText = (relativePath: string): string => {
      if (relativePath === 'docs/architecture/http-runtime.md') {
        return [
          '{ exists: false }',
          '{ exists: true, validators? }',
          'middleware, and guards',
          'independent route',
          'framework-managed response writing suppresses its body',
        ].join(' ');
      }

      return readFileSync(join(repoRoot, relativePath), 'utf8');
    };

    expect(() => enforceConditionalRequestDocsContract(readText)).toThrowError(
      /docs\/architecture\/http-runtime\.md is missing custom response writers own body emission/,
    );
  });
});
