import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { enforceEmailLifecycleDocsContract } from './email-lifecycle-docs-contract.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('Email lifecycle documentation contract', () => {
  it('distinguishes terminal rejection from opt-in startup verification across canonical EN/KO docs', () => {
    expect(() => enforceEmailLifecycleDocsContract()).not.toThrow();
  });

  it('rejects a package-surface summary that omits the opt-in startup boundary', () => {
    const readText = (relativePath: string): string => {
      if (relativePath === 'docs/reference/package-surface.md') {
        return '- **`@fluojs/email`**: `stopping`, `stopped`, and `failed` reject with `EmailLifecycleError`.';
      }

      return readFileSync(join(repoRoot, relativePath), 'utf8');
    };

    expect(() => enforceEmailLifecycleDocsContract(readText)).toThrowError(/docs\/reference\/package-surface\.md/);
  });
});
